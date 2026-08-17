# BLE UART stream + os.dupterm: el REPL de MicroPython usa BLE como transporte.
# IRQ: solo copia bytes al ring y llama dupterm_notify. Sin FS/import/sleep/JSON.

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

_rx = bytearray(_RING)
_rx_h = 0
_rx_t = 0
_rx_n = 0
_ble = None
_tx_handle = 0
_get_conn = None
_stream = None


def _ring_put(data):
    global _rx_t, _rx_n
    for c in data:
        if _rx_n >= _RING:
            return
        _rx[_rx_t] = c
        _rx_t = (_rx_t + 1) % _RING
        _rx_n += 1


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
    if not data:
        return
    _ring_put(data)
    if os is not None:
        try:
            os.dupterm_notify(None)
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
            return 0
        return _ring_get_into(buf)

    def write(self, buf):
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
        while i < n:
            piece = data[i : i + _TX_CHUNK]
            try:
                _ble.gatts_notify(conn, _tx_handle, piece)
            except Exception:
                break
            i += len(piece)
        return n

    def ioctl(self, op, arg):
        if op == _IOCTL_POLL:
            flags = _POLL_WR
            if _rx_n > 0:
                flags |= _POLL_RD
            return flags
        return 0


def attach(ble, tx_handle, get_conn):
    """Adjunta el stream REPL a dupterm. True solo si dupterm queda activo.

    No silencia el fallo de dupterm: si no se puede adjuntar, lanza.
    Slot 1 primero para no reemplazar el UART USB (slot 0).
    """
    global _ble, _tx_handle, _get_conn, _stream
    _ble = ble
    _tx_handle = tx_handle
    _get_conn = get_conn
    if _stream is None:
        _stream = BleReplStream()
    if os is None or not hasattr(os, "dupterm"):
        raise RuntimeError("dupterm unavailable")
    last = None
    attached = False
    for args in ((_stream, 1), (_stream, 0), (_stream,)):
        try:
            os.dupterm(*args)
            attached = True
            break
        except TypeError as e:
            last = e
        except Exception as e:
            last = e
    if not attached:
        if last is not None:
            raise last
        raise RuntimeError("dupterm failed")
    if micropython is not None:
        try:
            micropython.kbd_intr(3)
        except Exception:
            pass
    return True


def detach():
    if os is None:
        return
    try:
        os.dupterm(None, 0)
    except Exception:
        try:
            os.dupterm(None)
        except Exception:
            pass
