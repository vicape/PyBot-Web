# BLE UART stream + os.dupterm: el REPL de MicroPython usa BLE como transporte.
# IRQ: solo copia bytes al ring y llama dupterm_notify. Sin FS/import/sleep/JSON/print.
#
# TX (contrato dupterm, extmod/os_dupterm.c en MicroPython 1.27.0):
# - write() que retorna 0 => mp_os_dupterm_tx_strn trata 0 bytes escritos (perdida).
# - write() que lanza => desactiva el stream ("Exception in write() method").
# - write() solo encola el buffer completo y agenda _drain_tx. Sin sleep, sin
#   busy-loop, sin gatts_notify, sin inspeccionar Ctrl+C.
# Drain: gatts_notify fuera de write(), en orden, sin consumir hasta notify OK.
# Sigue enviando mientras NimBLE acepte; si no puede, conserva el chunk y reintenta
# en el proximo schedule. No monopoliza: sale al primer backpressure.
#
# Errores gatts_notify (extmod/nimble/modbluetooth_nimble.c 1.27.0):
#   BLE_HS_EAGAIN -> EAGAIN (11), BLE_HS_ENOMEM -> ENOMEM (12),
#   BLE_HS_EBUSY -> EBUSY (16), BLE_HS_ENOTCONN -> ENOTCONN (107).
#   mbuf_from_flat fallido -> ENOMEM. BLE inactivo -> ENODEV (19).
# Clasificacion: saturacion temporal / desconexion / inesperado.
#
# ESP32 MicroPython 1.27.0: un solo slot dupterm valido para este caso (slot 0).

import io
from micropython import const

try:
    import os
except ImportError:
    os = None

try:
    import micropython
except ImportError:
    micropython = None

_IOCTL_POLL = const(3)
_POLL_RD = const(1)
_POLL_WR = const(4)
_TX_CHUNK = const(20)
_RING = const(512)

# py/mperrno.h (MICROPY_USE_INTERNAL_ERRNO, valores Linux).
_EAGAIN = const(11)
_ENOMEM = const(12)
_EBUSY = const(16)
_ENODEV = const(19)
_ENOTCONN = const(107)

_KIND_TEMPORAL = const(0)
_KIND_DISCONNECT = const(1)
_KIND_UNEXPECTED = const(2)

_rx = bytearray(_RING)
_rx_h = 0
_rx_t = 0
_rx_n = 0
_tx_q = []
_tx_off = 0
_tx_n = 0
_tx_scheduled = False
_tx_draining = False
_ble = None
_tx_handle = 0
_get_conn = None
_stream = None
_slot = None

_rx_bytes = 0
_tx_bytes = 0
_rx_overflow = 0
_notify_fail = 0
_notify_retries = 0
_notify_unexpected = 0
_dupterm_notify_count = 0


def stats():
    return {
        "rx_bytes": _rx_bytes,
        "tx_bytes": _tx_bytes,
        "rx_overflow": _rx_overflow,
        "tx_pending": _tx_n,
        "notify_fail": _notify_fail,
        "notify_retries": _notify_retries,
        "notify_unexpected": _notify_unexpected,
        "dupterm_notify_count": _dupterm_notify_count,
        "rx_pending": _rx_n,
        "slot": _slot,
    }


def _ring_put(data):
    global _rx_t, _rx_n, _rx_overflow, _rx_bytes
    for c in data:
        if _rx_n >= _RING:
            _rx_overflow += 1
            return
        _rx[_rx_t] = c
        _rx_t = (_rx_t + 1) % _RING
        _rx_n += 1
        _rx_bytes += 1


def _ring_get_into(buf):
    global _rx_h, _rx_n
    n = len(buf)
    if n > _rx_n:
        n = _rx_n
    i = 0
    while i < n:
        buf[i] = _rx[_rx_h]
        _rx_h = (_rx_h + 1) % _RING
        _rx_n -= 1
        i += 1
    return n


def _tx_put(data):
    global _tx_n
    if not data:
        return
    _tx_q.append(bytes(data))
    _tx_n += len(data)


def _tx_peek_chunk():
    if not _tx_q or _tx_n <= 0:
        return None
    buf = _tx_q[0]
    remain = len(buf) - _tx_off
    if remain <= 0:
        return None
    n = _TX_CHUNK if remain > _TX_CHUNK else remain
    return buf[_tx_off : _tx_off + n]


def _tx_consume(n):
    global _tx_off, _tx_n
    if n <= 0:
        return
    if n > _tx_n:
        n = _tx_n
    _tx_off += n
    _tx_n -= n
    if _tx_q and _tx_off >= len(_tx_q[0]):
        _tx_q.pop(0)
        _tx_off = 0


def _tx_clear():
    global _tx_q, _tx_off, _tx_n, _tx_scheduled
    _tx_q = []
    _tx_off = 0
    _tx_n = 0
    _tx_scheduled = False


def _errno_of(exc):
    err = getattr(exc, "errno", None)
    if err is None:
        args = getattr(exc, "args", None)
        if args:
            err = args[0]
    if isinstance(err, int):
        if err < 0:
            return -err
        return err
    return None


def _classify_notify_error(exc):
    err = _errno_of(exc)
    if err is None:
        return _KIND_UNEXPECTED
    if err == _EAGAIN or err == _ENOMEM or err == _EBUSY:
        return _KIND_TEMPORAL
    if err == _ENOTCONN or err == _ENODEV:
        return _KIND_DISCONNECT
    return _KIND_UNEXPECTED


def _schedule_drain():
    global _tx_scheduled
    if _tx_scheduled or _tx_n <= 0:
        return
    if micropython is None:
        _drain_tx(None)
        return
    _tx_scheduled = True
    try:
        micropython.schedule(_drain_tx, 0)
    except RuntimeError:
        _tx_scheduled = False
        if not _tx_draining:
            _drain_tx(None)
    except OSError:
        _tx_scheduled = False
        if not _tx_draining:
            _drain_tx(None)


def _drain_tx(_arg):
    global _tx_scheduled, _tx_bytes, _notify_fail, _notify_retries, _notify_unexpected, _tx_draining
    _tx_scheduled = False
    if _tx_draining:
        return
    _tx_draining = True
    try:
        if _ble is None or _get_conn is None or _tx_n <= 0:
            return
        conn = _get_conn()
        if conn is None:
            _notify_fail += 1
            _tx_clear()
            return
        while _tx_n > 0:
            conn = _get_conn()
            if conn is None:
                _notify_fail += 1
                _tx_clear()
                return
            chunk = _tx_peek_chunk()
            if not chunk:
                return
            try:
                _ble.gatts_notify(conn, _tx_handle, chunk)
            except OSError as e:
                kind = _classify_notify_error(e)
                if kind == _KIND_TEMPORAL:
                    _notify_retries += 1
                    _schedule_drain()
                    return
                if kind == _KIND_DISCONNECT:
                    _notify_fail += 1
                    _tx_clear()
                    return
                _notify_unexpected += 1
                return
            _tx_consume(len(chunk))
            _tx_bytes += len(chunk)
    finally:
        _tx_draining = False


def irq_put(data):
    """Llamar desde IRQ GATTS_WRITE del REPL_RX. Minimo absoluto."""
    global _dupterm_notify_count
    if not data:
        return
    _ring_put(data)
    if os is not None:
        try:
            os.dupterm_notify(None)
            _dupterm_notify_count += 1
        except AttributeError:
            pass
        except Exception:
            pass


def inject_ctrl_c():
    irq_put(b"\x03")


class BleReplStream(io.IOBase):
    def read(self, sz=None):
        if _rx_n <= 0:
            return b""
        n = _rx_n if sz is None or sz < 0 else sz
        if n > _rx_n:
            n = _rx_n
        buf = bytearray(n)
        _ring_get_into(buf)
        return bytes(buf)

    def readinto(self, buf):
        if _rx_n <= 0:
            return None
        return _ring_get_into(buf)

    def write(self, buf):
        if buf is None:
            return 0
        if _ble is None or _get_conn is None:
            return 0
        if _get_conn() is None:
            return 0
        data = buf if isinstance(buf, (bytes, bytearray)) else bytes(buf)
        n = len(data)
        if n == 0:
            return 0
        _tx_put(data)
        _schedule_drain()
        return n

    def ioctl(self, op, arg):
        if op == _IOCTL_POLL:
            flags = _POLL_WR
            if _rx_n > 0:
                flags |= _POLL_RD
            return flags
        return 0


def attach(ble, tx_handle, get_conn):
    """Adjunta el stream REPL a dupterm slot 0. True solo si dupterm queda activo."""
    global _ble, _tx_handle, _get_conn, _stream, _slot
    _ble = ble
    _tx_handle = tx_handle
    _get_conn = get_conn
    _tx_clear()
    if _stream is None:
        _stream = BleReplStream()
    if os is None or not hasattr(os, "dupterm"):
        raise RuntimeError("dupterm unavailable")
    try:
        os.dupterm(_stream, 0)
    except TypeError:
        os.dupterm(_stream)
    except Exception as e:
        raise e
    _slot = 0
    if micropython is not None:
        try:
            micropython.kbd_intr(3)
        except Exception:
            pass
    return True


def detach():
    global _slot
    _tx_clear()
    if os is None:
        _slot = None
        return
    slot = 0 if _slot is None else _slot
    try:
        os.dupterm(None, slot)
    except TypeError:
        try:
            os.dupterm(None)
        except Exception:
            pass
    except Exception:
        try:
            os.dupterm(None, 0)
        except Exception:
            pass
    _slot = None
