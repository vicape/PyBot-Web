# Reliable BLE framing under the raw REPL byte stream.
# gatts_notify success is NOT delivery. Frames stay until ACK.
# IRQ-safe feed_rx: no FS/import/sleep/JSON/print.

try:
    from micropython import const
except ImportError:
    def const(x):
        return x

try:
    import time as _time
except ImportError:
    _time = None

try:
    from machine import Timer as _Timer
except ImportError:
    _Timer = None

RBLE_VERSION = const(1)
TYPE_DATA = const(1)
TYPE_ACK = const(2)
TYPE_NACK = const(3)
TYPE_RESET = const(4)

_VER = const(1)
_WINDOW = const(2)
_MAX_PAYLOAD = const(14)
_HDR = const(4)
_CRC = const(2)
_FRAME_MAX = const(20)
_ACK_MS = const(120)
_RETRY_MAX = const(10)

# CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, xorout 0.
def crc16(data):
    crc = 0xFFFF
    for c in data:
        crc ^= c << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def encode_frame(typ, seq, payload=b""):
    n = len(payload)
    if n > _MAX_PAYLOAD:
        payload = payload[:_MAX_PAYLOAD]
        n = _MAX_PAYLOAD
    hdr = bytes(((_VER << 4) | (typ & 0x0F), (seq >> 8) & 0xFF, seq & 0xFF, n))
    body = hdr + payload
    c = crc16(body)
    return body + bytes((c >> 8, c & 0xFF))


def decode_frame(data):
    if data is None:
        return None
    ntot = len(data)
    if ntot < _HDR + _CRC:
        return None
    n = data[3]
    if n > _MAX_PAYLOAD or ntot != _HDR + n + _CRC:
        return None
    body = data[: _HDR + n]
    got = (data[_HDR + n] << 8) | data[_HDR + n + 1]
    if crc16(body) != got:
        return None
    if (data[0] >> 4) != _VER:
        return None
    typ = data[0] & 0x0F
    seq = (data[1] << 8) | data[2]
    if n == 0:
        payload = b""
    else:
        payload = bytes(data[_HDR : _HDR + n])
    return (typ, seq, payload)


def _seq_lte(a, b):
    return ((b - a) & 0xFFFF) < 0x8000


def _seq_lt(a, b):
    return a != b and _seq_lte(a, b)


_win_buf = [bytearray(_FRAME_MAX), bytearray(_FRAME_MAX)]
_win_len = [0, 0]
_win_seq = [0, 0]
_win_ticks = [0, 0]
_win_retries = [0, 0]
_win_used = [False, False]
_win_notified = [False, False]

_tx_next = 0
_tx_base = 0
_rx_expected = 0
_epoch = 0
_peer_epoch = -1
_synced = False
_ctrl = []
_ctrl_off = 0
_need_reset = True
_timer = None
_on_timeout = None
_acks_sent = 0
_nacks_sent = 0
_resets = 0
_retrans = 0
_dup_rx = 0
_gap_rx = 0
_bad_rx = 0


def _ticks():
    if _time is None:
        return 0
    try:
        return _time.ticks_ms()
    except AttributeError:
        return 0


def _ticks_diff(a, b):
    if _time is None:
        return 0
    try:
        return _time.ticks_diff(a, b)
    except AttributeError:
        return a - b


def _clear_window():
    i = 0
    while i < _WINDOW:
        _win_used[i] = False
        _win_notified[i] = False
        _win_len[i] = 0
        _win_retries[i] = 0
        i += 1


def _slot_for_seq(seq):
    i = 0
    while i < _WINDOW:
        if _win_used[i] and _win_seq[i] == seq:
            return i
        i += 1
    return -1


def _free_slot():
    i = 0
    while i < _WINDOW:
        if not _win_used[i]:
            return i
        i += 1
    return -1


def window_free():
    n = 0
    i = 0
    while i < _WINDOW:
        if not _win_used[i]:
            n += 1
        i += 1
    return n


def _queue_ctrl(frame):
    _ctrl.append(frame)


def _cancel_timer():
    global _timer
    if _timer is None:
        return
    try:
        _timer.deinit()
    except Exception:
        pass
    _timer = None


def _arm_timer():
    global _timer
    if _on_timeout is None or _Timer is None:
        return
    waiting = False
    i = 0
    while i < _WINDOW:
        if _win_used[i] and _win_notified[i]:
            waiting = True
            break
        i += 1
    if not waiting:
        _cancel_timer()
        return
    if _timer is not None:
        return
    try:
        _timer = _Timer(-1)
        _timer.init(mode=_Timer.ONE_SHOT, period=_ACK_MS, callback=_on_timeout)
    except Exception:
        try:
            _timer = _Timer(0)
            _timer.init(mode=_Timer.ONE_SHOT, period=_ACK_MS, callback=_on_timeout)
        except Exception:
            _timer = None


def set_timeout_cb(cb):
    global _on_timeout
    _on_timeout = cb


def reset_session(send_reset=True):
    global _tx_next, _tx_base, _rx_expected, _synced, _ctrl, _ctrl_off
    global _need_reset, _epoch, _peer_epoch
    _cancel_timer()
    _clear_window()
    _tx_next = 0
    _tx_base = 0
    _rx_expected = 0
    _ctrl = []
    _ctrl_off = 0
    _synced = False
    _epoch = (_epoch + 1) & 0xFF
    if send_reset:
        _need_reset = False
        _queue_ctrl(encode_frame(TYPE_RESET, 0, bytes((_WINDOW, _epoch))))


def reset_link():
    reset_session(False)
    global _need_reset
    _need_reset = True


def queue_data(payload):
    global _tx_next
    if not payload:
        return 0
    slot = _free_slot()
    if slot < 0:
        return 0
    seq = _tx_next
    frame = encode_frame(TYPE_DATA, seq, payload)
    n = len(frame)
    buf = _win_buf[slot]
    i = 0
    while i < n:
        buf[i] = frame[i]
        i += 1
    _win_len[slot] = n
    _win_seq[slot] = seq
    _win_used[slot] = True
    _win_notified[slot] = False
    _win_retries[slot] = 0
    _win_ticks[slot] = 0
    _tx_next = (seq + 1) & 0xFFFF
    return len(payload) if len(payload) <= _MAX_PAYLOAD else _MAX_PAYLOAD


def _oldest_unacked():
    found = -1
    best = 0
    i = 0
    while i < _WINDOW:
        if _win_used[i]:
            seq = _win_seq[i]
            if found < 0 or _seq_lt(seq, best):
                found = i
                best = seq
        i += 1
    return found


def next_to_send():
    global _need_reset, _ctrl_off, _retrans
    if _need_reset:
        if not _ctrl:
            _queue_ctrl(encode_frame(TYPE_RESET, 0, bytes((_WINDOW, _epoch))))
        _need_reset = False
    if _ctrl:
        if _ctrl_off < 0 or _ctrl_off >= len(_ctrl):
            _ctrl_off = 0
        return _ctrl[_ctrl_off]
    now = _ticks()
    i = 0
    while i < _WINDOW:
        if _win_used[i] and not _win_notified[i]:
            return bytes(_win_buf[i][: _win_len[i]])
        i += 1
    i = 0
    while i < _WINDOW:
        if _win_used[i] and _win_notified[i]:
            if _ticks_diff(now, _win_ticks[i]) >= _ACK_MS:
                if _win_retries[i] >= _RETRY_MAX:
                    reset_session(True)
                    if _ctrl:
                        return _ctrl[0]
                    return None
                _win_notified[i] = False
                _win_retries[i] += 1
                _retrans += 1
                return bytes(_win_buf[i][: _win_len[i]])
        i += 1
    return None


def mark_sent(frame):
    global _ctrl_off, _acks_sent, _nacks_sent, _resets
    if not frame:
        return
    parsed = decode_frame(frame)
    if parsed is None:
        return
    typ, seq, _payload = parsed
    if typ == TYPE_ACK or typ == TYPE_NACK or typ == TYPE_RESET:
        if _ctrl and _ctrl_off < len(_ctrl):
            _ctrl.pop(_ctrl_off)
            if _ctrl_off >= len(_ctrl):
                _ctrl_off = 0
        if typ == TYPE_ACK:
            _acks_sent += 1
        elif typ == TYPE_NACK:
            _nacks_sent += 1
        else:
            _resets += 1
        return
    slot = _slot_for_seq(seq)
    if slot >= 0:
        _win_notified[slot] = True
        _win_ticks[slot] = _ticks()
        _arm_timer()


def has_pending():
    if _need_reset or _ctrl:
        return True
    i = 0
    while i < _WINDOW:
        if _win_used[i]:
            return True
        i += 1
    return False


def on_ack(seq):
    global _tx_base
    i = 0
    while i < _WINDOW:
        if _win_used[i] and _seq_lte(_win_seq[i], seq):
            _win_used[i] = False
            _win_notified[i] = False
            _win_len[i] = 0
        i += 1
    nxt = (seq + 1) & 0xFFFF
    if _seq_lte(_tx_base, nxt):
        _tx_base = nxt
    _arm_timer()


def on_nack(seq):
    global _retrans
    slot = _slot_for_seq(seq)
    if slot >= 0:
        _win_notified[slot] = False
        _retrans += 1


def _queue_ack(seq):
    _queue_ctrl(encode_frame(TYPE_ACK, seq, b""))


def _queue_nack(seq):
    _queue_ctrl(encode_frame(TYPE_NACK, seq, b""))


def on_reset(window, epoch):
    global _peer_epoch, _synced, _tx_next, _tx_base, _rx_expected
    global _ctrl, _ctrl_off, _need_reset
    same = epoch == _peer_epoch
    _peer_epoch = epoch
    _synced = True
    if same:
        return
    _cancel_timer()
    _clear_window()
    _tx_next = 0
    _tx_base = 0
    _rx_expected = 0
    _ctrl = []
    _ctrl_off = 0
    _queue_ctrl(encode_frame(TYPE_RESET, 0, bytes((_WINDOW, _epoch))))
    _need_reset = False


def feed_rx(data):
    """IRQ: parse one GATT write. Returns payload bytes or None.
    ACK/NACK/RESET update state. DATA payload is returned once."""
    global _rx_expected, _synced, _dup_rx, _gap_rx, _bad_rx
    parsed = decode_frame(data)
    if parsed is None:
        _bad_rx += 1
        _queue_nack(_rx_expected)
        return None
    typ, seq, payload = parsed
    if typ == TYPE_ACK:
        on_ack(seq)
        return None
    if typ == TYPE_NACK:
        on_nack(seq)
        return None
    if typ == TYPE_RESET:
        w = payload[0] if payload else _WINDOW
        e = payload[1] if len(payload) > 1 else 0
        on_reset(w, e)
        return None
    if typ != TYPE_DATA:
        _bad_rx += 1
        return None
    if not _synced:
        return None
    if seq == _rx_expected:
        _rx_expected = (_rx_expected + 1) & 0xFFFF
        _queue_ack(seq)
        return payload
    if _seq_lt(seq, _rx_expected):
        _dup_rx += 1
        last = (_rx_expected - 1) & 0xFFFF
        _queue_ack(last)
        return None
    _gap_rx += 1
    _queue_nack(_rx_expected)
    return None


def stats():
    pending = 0
    i = 0
    while i < _WINDOW:
        if _win_used[i]:
            pending += 1
        i += 1
    return {
        "window": _WINDOW,
        "payload": _MAX_PAYLOAD,
        "tx_next": _tx_next,
        "tx_base": _tx_base,
        "rx_expected": _rx_expected,
        "win_pending": pending,
        "acks_sent": _acks_sent,
        "nacks_sent": _nacks_sent,
        "resets": _resets,
        "retrans": _retrans,
        "dup_rx": _dup_rx,
        "gap_rx": _gap_rx,
        "bad_rx": _bad_rx,
        "synced": _synced,
    }
