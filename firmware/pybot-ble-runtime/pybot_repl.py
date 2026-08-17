# BLE UART stream + os.dupterm: el REPL de MicroPython usa BLE como transporte.
# IRQ: solo copia bytes al ring y llama dupterm_notify. Sin FS/import/sleep/JSON/print.
#
# TX: write() encola en FIFO acotado y retorna al instante; gatts_notify ocurre en
# _drain_tx (micropython.schedule), fuera de write(), un chunk por invocacion
# (cooperativo). Ante EAGAIN/ENOMEM/EBUSY se conservan los bytes y se reintenta
# mas tarde; nunca consume antes de notify exitoso.
#
# Contrato dupterm (docs + extmod/os_dupterm.c): readinto() vacio debe ser None
# (EAGAIN). 0 es EOF y desactiva el stream ("dupterm: EOF received, deactivating").
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
_TX_RING = const(2048)

_rx = bytearray(_RING)
_rx_h = 0
_rx_t = 0
_rx_n = 0
_tx = bytearray(_TX_RING)
_tx_h = 0
_tx_t = 0
_tx_n = 0
_tx_overflow = 0
_tx_scheduled = False
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
_dupterm_notify_count = 0


def stats():
    return {
        "rx_bytes": _rx_bytes,
        "tx_bytes": _tx_bytes,
        "rx_overflow": _rx_overflow,
        "tx_overflow": _tx_overflow,
        "tx_pending": _tx_n,
        "notify_fail": _notify_fail,
        "notify_retries": _notify_retries,
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


def _tx_peek_into(buf):
    n = len(buf)
    if n > _tx_n:
        n = _tx_n
    pos = _tx_h
    i = 0
    while i < n:
        buf[i] = _tx[pos]
        pos = (pos + 1) % _TX_RING
        i += 1
    return n


def _tx_consume(n):
    global _tx_h, _tx_n
    if n > _tx_n:
        n = _tx_n
    _tx_h = (_tx_h + n) % _TX_RING
    _tx_n -= n


def _tx_put(data):
    global _tx_t, _tx_n, _tx_overflow
    need = len(data)
    if need > _TX_RING or _tx_n + need > _TX_RING:
        _tx_overflow += 1
        raise OSError("BLE TX queue full")
    for c in data:
        _tx[_tx_t] = c
        _tx_t = (_tx_t + 1) % _TX_RING
        _tx_n += 1


def _tx_clear():
    global _tx_h, _tx_t, _tx_n, _tx_scheduled
    _tx_h = 0
    _tx_t = 0
    _tx_n = 0
    _tx_scheduled = False


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
    except Exception:
        _tx_scheduled = False


def _drain_tx(_arg):
    global _tx_scheduled, _tx_bytes, _notify_fail, _notify_retries
    _tx_scheduled = False
    if _ble is None or _get_conn is None or _tx_n <= 0:
        return
    conn = _get_conn()
    if conn is None:
        _notify_fail += 1
        _tx_clear()
        return
    n = _TX_CHUNK if _tx_n > _TX_CHUNK else _tx_n
    chunk = bytearray(n)
    _tx_peek_into(chunk)
    try:
        _ble.gatts_notify(conn, _tx_handle, chunk)
    except Exception:
        conn = _get_conn()
        if conn is None:
            _notify_fail += 1
            _tx_clear()
            return
        _notify_retries += 1
        _schedule_drain()
        return
    _tx_consume(n)
    _tx_bytes += n
    if _tx_n > 0:
        _schedule_drain()


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
        try:
            _tx_put(data)
        except OSError:
            return 0
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
