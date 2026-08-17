# BLE UART stream + os.dupterm: el REPL de MicroPython usa BLE como transporte.
# IRQ: solo copia bytes al ring y llama dupterm_notify. Sin FS/import/sleep/JSON/print.
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
_TX_BURST = const(8)

_rx = bytearray(_RING)
_rx_h = 0
_rx_t = 0
_rx_n = 0
_ble = None
_tx_handle = 0
_get_conn = None
_stream = None
_slot = None

_rx_bytes = 0
_tx_bytes = 0
_rx_overflow = 0
_notify_fail = 0
_dupterm_notify_count = 0


def stats():
    return {
        "rx_bytes": _rx_bytes,
        "tx_bytes": _tx_bytes,
        "rx_overflow": _rx_overflow,
        "notify_fail": _notify_fail,
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
        global _tx_bytes, _notify_fail
        if _ble is None or _get_conn is None:
            return 0 if buf is None else len(buf)
        conn = _get_conn()
        if conn is None:
            return 0 if buf is None else len(buf)
        if buf is None:
            return 0
        data = buf if isinstance(buf, (bytes, bytearray)) else bytes(buf)
        i = 0
        n = len(data)
        # Si hay RX pendiente (Ctrl+C), ceder pronto para que el VM lea el IRQ.
        burst = 1 if _rx_n > 0 else _TX_BURST
        chunks = 0
        while i < n and chunks < burst:
            piece = data[i : i + _TX_CHUNK]
            try:
                _ble.gatts_notify(conn, _tx_handle, piece)
            except Exception:
                _notify_fail += 1
                break
            i += len(piece)
            _tx_bytes += len(piece)
            chunks += 1
        return i

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
