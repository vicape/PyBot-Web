# SPDX-License-Identifier: MIT
# PyBot on-device Zigbee adapter for custom MicroPython+_uzigbee firmware.
# Maps ONLY verified upstream native bindings from mateuszsury/uZigbee (ZBOSS v1.6).
# NOT a mock radio. On stock MicroPython (no _uzigbee) diagnostics are honest FAIL.
#
# Attribution: native stack via MIT uZigbee; Zigbee SDK binaries have separate terms
# (see firmware/pybot-c6-micropython-zigbee/LICENSE_ATTRIBUTION.md).
#
# Native snapshot formats (uZigbee ff25553):
#   get_active_endpoints_snapshot -> (status, count, endpoints_tuple)  # no addr field
#   get_simple_descriptor_snapshot -> (status, addr, desc_or_None)
#     desc = (endpoint, profile_id, device_id, device_version, in_clusters, out_clusters)
#   on_attribute callback: (ep, cluster, attr, value, type, status)
#     or with source: (src_short, ep, cluster, attr, value, type, status)
#   on_command (PyBot overlay on uZigbee): (src_short|None, src_ep, dst_ep,
#     cluster, command_id, manuf_code, payload_bytes, callback_id, status)
#     Verified SDK 1.6 ids: custom 0x1040/0x1041, privilege 0x1050/0x1051, IAS 0x1031.
#   on_aps (PyBot APS overlay, SDK 1.6.8 by-value indication):
#     (src_short, src_ep, dst_ep, profile, cluster, status, asdu, asdu_len,
#      asdu_len_orig, truncated)
# There is NO remote ZCL Read Attributes command in _uzigbee.
# Cluster 0xEF00 is NOT a valid add_custom_cluster id (upstream requires >=0xFC00);
# capture 0xEF00 via on_aps, never via add_custom_cluster(0xEF00).

"""pybot.zigbee — coordinator helpers over native ``_uzigbee``."""

try:
    import _uzigbee as _native
except ImportError:  # pragma: no cover - exercised on stock firmware
    _native = None

try:
    import time
except ImportError:  # pragma: no cover
    time = None

# ZCL / role constants verified against uZigbee c_module + python/uzigbee
ROLE_COORDINATOR = 0
ROLE_ROUTER = 1
ROLE_END_DEVICE = 2
CLUSTER_BASIC = 0x0000
CLUSTER_IDENTIFY = 0x0003
CLUSTER_GROUPS = 0x0004
CLUSTER_SCENES = 0x0005
CLUSTER_ON_OFF = 0x0006
CLUSTER_LEVEL_CONTROL = 0x0008
ATTR_ON_OFF = 0x0000
ATTR_LEVEL_CURRENT = 0x0000
CMD_ON_OFF_OFF = 0
CMD_ON_OFF_ON = 1
CMD_ON_OFF_TOGGLE = 2

# Verified esp-zigbee-lib ~1.6 core action callback ids (command capture overlay)
CB_CMD_CUSTOM_CLUSTER_REQ = 0x1040
CB_CMD_CUSTOM_CLUSTER_RESP = 0x1041
CB_CMD_PRIVILEGE_REQ = 0x1050
CB_CMD_PRIVILEGE_RESP = 0x1051
CB_CMD_IAS_ZONE_STATUS_CHANGE = 0x1031

# HA / Tuya (candidate until Basic manufacturer/model confirmed on bench)
PROFILE_HA = 0x0104
CLUSTER_TUYA_EF00 = 0xEF00
# Candidate fingerprint for SC10 2-key scene remote (descriptor match only until Basic read)
TS0021_MANUFACTURER = "_TZ3210_3ulg9kpo"
TS0021_MODEL = "TS0021"
# ZCL frame-control bits
ZCL_FC_MANUFACTURER = 0x04
# Tuya commandActiveStatusReport (herdsman / Z2M)
TUYA_CMD_ACTIVE_STATUS_REPORT = 0x0A
# DP enum gestures: 0 single, 1 double, 2 hold (ZHA/Z2M candidate)
GESTURE_SINGLE = 0
GESTURE_DOUBLE = 1
GESTURE_HOLD = 2
GESTURE_NAMES = {0: "single", 1: "double", 2: "hold"}

# ESP_ERR_INVALID_STATE — repeated create/register/start after stack is live
ESP_ERR_INVALID_STATE = 259

PERMIT_JOIN_MAX_S = 254  # uint8 bound in native permit_join
PERMIT_JOIN_DEFAULT_S = 60
EVENT_QUEUE_MAX = 32
APS_ASDU_MAX = 64  # must match UZB_APS_ASDU_MAX in APS overlay

_MISSING_MSG = (
    "NATIVE_MODULE_MISSING: _uzigbee is not present on this firmware. "
    "Stock MicroPython ESP32_GENERIC_C6 has no Zigbee radio binding. "
    "Zigbee coordinator Python APIs require the opt-in custom image built from "
    "firmware/pybot-c6-micropython-zigbee/ (uZigbee v1.6 PoC, artifact must be READY). "
    "Do not treat this as a Zigbee pass. Hardware validation remains UNVERIFIED. "
    "Restore path: official ESP32_GENERIC_C6 v1.27.0 (see docs/BACKUP_RESTORE.md)."
)


class ZigbeeNativeMissingError(OSError):
    """Raised when _uzigbee is absent — never a fake success."""


class ZigbeeError(OSError):
    pass


class UnsupportedError(ZigbeeError):
    """Raised when a feature is not present in the pinned native module."""


def native_available():
    """Return True only when the real native module imports."""
    return _native is not None


def diagnose():
    """Honest, actionable diagnostic dict (no fake Zigbee pass)."""
    if _native is None:
        return {
            "ok": False,
            "native": None,
            "status": "NATIVE_MODULE_MISSING",
            "hardwareValidation": "UNVERIFIED",
            "message": _MISSING_MSG,
            "nextStep": (
                "Build firmware/pybot-c6-micropython-zigbee with ESP-IDF v5.3.2, "
                "flash only after backup + READY multi-offset artifact, then reinstall pybot.zigbee."
            ),
        }
    return {
        "ok": True,
        "native": "_uzigbee",
        "status": "NATIVE_PRESENT",
        "hardwareValidation": "UNVERIFIED",
        "message": (
            "Native _uzigbee present. Zigbee RF pairing still UNVERIFIED until "
            "user-supervised bench with a real switch."
        ),
        "nextStep": "Call start_coordinator(); keep permit_join closed until pairing.",
    }


def _require_native():
    if _native is None:
        raise ZigbeeNativeMissingError(_MISSING_MSG)
    return _native


def _require_attr(name):
    zb = _require_native()
    if not hasattr(zb, name):
        raise UnsupportedError("native _uzigbee has no %s" % name)
    return zb


def _sleep_ms(ms):
    if time is None:
        return
    if hasattr(time, "sleep_ms"):
        time.sleep_ms(int(ms))
    else:
        time.sleep(int(ms) / 1000.0)


def _ticks_ms():
    if time is not None and hasattr(time, "ticks_ms"):
        return time.ticks_ms()
    if time is not None:
        return int(time.time() * 1000)
    return 0


def _ticks_diff(a, b):
    if time is not None and hasattr(time, "ticks_diff"):
        return time.ticks_diff(a, b)
    return int(a) - int(b)


def _ticks_add(base, delta):
    if time is not None and hasattr(time, "ticks_add"):
        return time.ticks_add(base, int(delta))
    return int(base) + int(delta)


# --- bounded event queue (join/leave/report/command) ---
_event_q = []
_cb_join = None
_cb_leave = None
_cb_report = None
_cb_device_update = None
_cb_command = None
_cb_aps = None
_cb_button = None
_signal_hooked = False
_command_hooked = False
_aps_hooked = False
_coordinator_started = False
# Device Basic identity when available; None => UNVERIFIED TS0021 candidate
_device_fingerprint = {}  # short_addr -> {manufacturer, model, verified}

# Attr cache keyed by (short_addr_or_None, endpoint, cluster, attr)
_attr_cache = {}


def _hex_bytes(data):
    if not data:
        return ""
    return "".join("%02x" % (b & 0xFF) for b in data)


def parse_zcl_header(asdu):
    """
    Parse ZCL frame control / optional manuf / seq / command from ASDU bytes.
    Returns dict or None if too short. Does not invent missing fields.
    """
    if asdu is None:
        return None
    raw = bytes(asdu)
    if len(raw) < 3:
        return None
    fc = raw[0]
    idx = 1
    manuf = None
    if fc & ZCL_FC_MANUFACTURER:
        if len(raw) < 5:
            return None
        manuf = raw[1] | (raw[2] << 8)
        idx = 3
    if len(raw) < idx + 2:
        return None
    seq = raw[idx]
    cmd = raw[idx + 1]
    payload = raw[idx + 2 :]
    return {
        "frame_control": fc,
        "manuf_code": manuf,
        "seq": seq,
        "command": cmd,
        "payload": payload,
        "raw_hex": _hex_bytes(raw),
    }


def parse_tuya_dp_payload(payload):
    """
    Parse Tuya DP list after ZCL command header.
    Layout after ActiveStatusReport: seq_be(2) then repeats of
    dp(1) + datatype(1) + len_be(2) + data(len).
    Returns list of {dp, datatype, data, value_int?} with length checks.
    """
    if payload is None:
        return []
    raw = bytes(payload)
    out = []
    if len(raw) < 2:
        return out
    # Leading 2-byte sequence (big-endian) is common for active status report
    pos = 2
    while pos + 4 <= len(raw):
        dp = raw[pos]
        dtype = raw[pos + 1]
        dlen = (raw[pos + 2] << 8) | raw[pos + 3]
        pos += 4
        if dlen < 0 or pos + dlen > len(raw):
            break
        data = raw[pos : pos + dlen]
        pos += dlen
        item = {"dp": dp, "datatype": dtype, "data": data, "data_hex": _hex_bytes(data)}
        if dlen == 1:
            item["value_int"] = data[0]
        elif dlen == 2:
            item["value_int"] = (data[0] << 8) | data[1]
        elif dlen == 4:
            item["value_int"] = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
        out.append(item)
    return out


def decode_ts0021_button_from_aps(aps_payload):
    """
    Candidate TS0021 (_TZ3210_3ulg9kpo) DP1/DP2 → KEY1/KEY2 + gesture.
    Emits only when DP in {1,2} and gesture in {0,1,2}. Never from join/report.
    Returns None or button dict; always preserves raw_hex on aps_payload path.
    """
    if not aps_payload:
        return None
    cluster = int(aps_payload.get("cluster", -1))
    if cluster != CLUSTER_TUYA_EF00:
        return None
    if aps_payload.get("truncated"):
        # Do not invent full packet / DP on truncation
        return None
    asdu = aps_payload.get("asdu") or b""
    zcl = parse_zcl_header(asdu)
    if zcl is None:
        return None
    dps = parse_tuya_dp_payload(zcl.get("payload") or b"")
    short_addr = aps_payload.get("short_addr")
    fp = _device_fingerprint.get(short_addr) if short_addr is not None else None
    verified = bool(fp and fp.get("verified"))
    model_label = (
        "%s %s" % (fp.get("manufacturer"), fp.get("model"))
        if verified
        else "UNVERIFIED TS0021 candidate (_TZ3210_3ulg9kpo)"
    )
    for item in dps:
        dp = int(item.get("dp", -1))
        if dp not in (1, 2):
            continue
        if "value_int" not in item:
            continue
        gesture = int(item["value_int"])
        if gesture not in (GESTURE_SINGLE, GESTURE_DOUBLE, GESTURE_HOLD):
            continue
        key = "KEY1" if dp == 1 else "KEY2"
        return {
            "key": key,
            "dp": dp,
            "gesture": gesture,
            "gesture_name": GESTURE_NAMES.get(gesture, str(gesture)),
            "short_addr": short_addr,
            "src_endpoint": aps_payload.get("src_endpoint"),
            "cluster": cluster,
            "command": zcl.get("command"),
            "manuf_code": zcl.get("manuf_code"),
            "raw_hex": zcl.get("raw_hex") or _hex_bytes(asdu),
            "dp_candidates": dps,
            "model": model_label,
            "fingerprint_verified": verified,
        }
    return None


def _push_event(kind, payload):
    if len(_event_q) >= EVENT_QUEUE_MAX:
        _event_q.pop(0)
    _event_q.append({"kind": kind, "payload": payload})


def _on_signal(signal, status):
    # SIGNAL_DEVICE_ANNCE=0x02, SIGNAL_LEAVE=0x03, SIGNAL_DEVICE_UPDATE=0x30
    # (uZigbee constants; keep numeric to avoid depending on optional exports)
    try:
        sig = int(signal)
        st = int(status)
    except (TypeError, ValueError):
        return
    if sig == 0x02:
        addr = None
        try:
            addr = last_joined_short_addr()
        except Exception:
            addr = None
        payload = {"signal": sig, "status": st, "short_addr": addr}
        _push_event("join", payload)
        if _cb_join:
            try:
                _cb_join(payload)
            except Exception:
                pass
    elif sig in (0x03, 0x13):
        payload = {"signal": sig, "status": st}
        _push_event("leave", payload)
        if _cb_leave:
            try:
                _cb_leave(payload)
            except Exception:
                pass
    elif sig == 0x30:
        payload = {"signal": sig, "status": st}
        _push_event("device_update", payload)
        if _cb_device_update:
            try:
                _cb_device_update(payload)
            except Exception:
                pass


def _parse_attr_callback_args(args):
    """Normalize 6-arg legacy or 7-arg (with source short) attribute callbacks."""
    n = len(args)
    if n >= 7:
        src = int(args[0]) & 0xFFFF
        endpoint = int(args[1])
        cluster_id = int(args[2])
        attr_id = int(args[3])
        value = args[4]
        return src, endpoint, cluster_id, attr_id, value
    if n >= 4:
        endpoint = int(args[0])
        cluster_id = int(args[1])
        attr_id = int(args[2])
        value = args[3]
        return None, endpoint, cluster_id, attr_id, value
    raise TypeError("attribute callback expects 6 or 7 args")


def _on_attribute(*args):
    try:
        src, endpoint, cluster_id, attr_id, value = _parse_attr_callback_args(args)
    except (TypeError, ValueError):
        return
    key = (src, int(endpoint), int(cluster_id), int(attr_id))
    _attr_cache[key] = value
    payload = {
        "short_addr": src,
        "endpoint": int(endpoint),
        "cluster": int(cluster_id),
        "attr": int(attr_id),
        "value": value,
    }
    _push_event("report", payload)
    if _cb_report:
        try:
            _cb_report(payload)
        except Exception:
            pass


def _parse_command_callback_args(args):
    """Native overlay: 9-tuple command event."""
    if len(args) < 9:
        raise TypeError("command callback expects 9 args")
    src = args[0]
    if src is not None:
        src = int(src) & 0xFFFF
    payload = args[6]
    if payload is None:
        payload = b""
    elif not isinstance(payload, (bytes, bytearray)):
        try:
            payload = bytes(payload)
        except TypeError:
            payload = b""
    return {
        "short_addr": src,
        "src_endpoint": int(args[1]),
        "dst_endpoint": int(args[2]),
        "cluster": int(args[3]),
        "command": int(args[4]),
        "manuf_code": int(args[5]),
        "payload": bytes(payload),
        "payload_len": len(payload),
        "callback_id": int(args[7]),
        "status": int(args[8]),
    }


def _on_command(*args):
    try:
        payload = _parse_command_callback_args(args)
    except (TypeError, ValueError):
        return
    _push_event("command", payload)
    if _cb_command:
        try:
            _cb_command(payload)
        except Exception:
            pass


def _parse_aps_callback_args(args):
    """Native APS overlay: 10-tuple indication event."""
    if len(args) < 10:
        raise TypeError("aps callback expects 10 args")
    asdu = args[6]
    if asdu is None:
        asdu = b""
    elif not isinstance(asdu, (bytes, bytearray)):
        try:
            asdu = bytes(asdu)
        except TypeError:
            asdu = b""
    asdu = bytes(asdu)
    asdu_len = int(args[7])
    asdu_len_orig = int(args[8])
    truncated = bool(args[9])
    # Enforce max; mark truncated if native lied or Python-side shrink
    if len(asdu) > APS_ASDU_MAX:
        asdu = asdu[:APS_ASDU_MAX]
        truncated = True
    if asdu_len_orig > APS_ASDU_MAX:
        truncated = True
    return {
        "short_addr": int(args[0]) & 0xFFFF,
        "src_endpoint": int(args[1]),
        "dst_endpoint": int(args[2]),
        "profile": int(args[3]),
        "cluster": int(args[4]),
        "status": int(args[5]),
        "asdu": asdu,
        "asdu_len": min(asdu_len, len(asdu)),
        "asdu_len_orig": asdu_len_orig,
        "truncated": truncated,
        "raw_hex": _hex_bytes(asdu),
    }


def _on_aps(*args):
    try:
        payload = _parse_aps_callback_args(args)
    except (TypeError, ValueError):
        return
    # Always surface raw APS first (bench priority over DP guessing)
    zcl = parse_zcl_header(payload.get("asdu") or b"")
    if zcl is not None:
        payload["zcl"] = zcl
        payload["dp_candidates"] = parse_tuya_dp_payload(zcl.get("payload") or b"")
    else:
        payload["dp_candidates"] = []
    short_addr = payload.get("short_addr")
    fp = _device_fingerprint.get(short_addr) if short_addr is not None else None
    payload["model"] = (
        "%s %s" % (fp.get("manufacturer"), fp.get("model"))
        if fp and fp.get("verified")
        else "UNVERIFIED TS0021 candidate (_TZ3210_3ulg9kpo)"
    )
    payload["fingerprint_verified"] = bool(fp and fp.get("verified"))
    _push_event("aps", payload)
    if _cb_aps:
        try:
            _cb_aps(payload)
        except Exception:
            pass
    # Button ONLY from validated DP 1/2 + gesture 0/1/2 — never join/report
    btn = decode_ts0021_button_from_aps(payload)
    if btn is not None:
        _push_event("button", btn)
        if _cb_button:
            try:
                _cb_button(btn)
            except Exception:
                pass


def _ensure_signal_hook():
    global _signal_hooked
    if _signal_hooked:
        return
    zb = _require_native()
    if hasattr(zb, "on_signal"):
        zb.on_signal(_on_signal)
        _signal_hooked = True
    elif hasattr(zb, "set_signal_callback"):
        zb.set_signal_callback(_on_signal)
        _signal_hooked = True


def _ensure_command_hook():
    global _command_hooked
    if _command_hooked:
        return
    zb = _require_native()
    if hasattr(zb, "on_command"):
        zb.on_command(_on_command)
        _command_hooked = True
    elif hasattr(zb, "set_command_callback"):
        zb.set_command_callback(_on_command)
        _command_hooked = True
    else:
        raise UnsupportedError(
            "native _uzigbee has no on_command — rebuild with "
            "overlays/apply_uzb_command_capture.py (esp-zigbee-lib ~1.6)"
        )


def _ensure_aps_hook():
    global _aps_hooked
    if _aps_hooked:
        return
    zb = _require_native()
    if hasattr(zb, "on_aps"):
        zb.on_aps(_on_aps)
        _aps_hooked = True
    elif hasattr(zb, "set_aps_callback"):
        zb.set_aps_callback(_on_aps)
        _aps_hooked = True
    else:
        raise UnsupportedError(
            "native _uzigbee has no on_aps — rebuild with "
            "overlays/apply_uzb_aps_capture.py (esp-zigbee-lib 1.6.8 APS)"
        )


def _native_is_started():
    zb = _require_native()
    if hasattr(zb, "is_started"):
        try:
            return bool(zb.is_started())
        except Exception:
            return bool(_coordinator_started)
    return bool(_coordinator_started)


def start_coordinator(form_network=True, create_local_onoff_switch=True, local_endpoint=1):
    """
    Start Zigbee 3.x coordinator via verified upstream ``init`` + ``start``.

    ``local_endpoint`` is the *coordinator's own* ZCL client endpoint used as
    src for OnOff commands — not a claim about joined dual-channel switch EPs.

    Joining stays closed until an explicit ``permit_join(seconds)`` call.
    ``form_network=True`` forms a new network when none exists; SDK NVRAM
    (zb_storage) may reopen a prior network when ``form_network=False``.

    Idempotent when the native stack is already started (avoids OSError 259).
    """
    global _coordinator_started
    zb = _require_native()
    if _native_is_started():
        _coordinator_started = True
        try:
            _ensure_signal_hook()
        except Exception:
            pass
        try:
            _ensure_command_hook()
        except UnsupportedError:
            pass
        try:
            _ensure_aps_hook()
        except UnsupportedError:
            pass
        try:
            close_join()
        except Exception:
            pass
        return diagnose()

    zb.init(ROLE_COORDINATOR)
    if create_local_onoff_switch and hasattr(zb, "create_on_off_switch"):
        try:
            zb.create_on_off_switch(int(local_endpoint))
        except OSError as exc:
            # ESP_ERR_INVALID_STATE (259) if endpoint already registered
            if not (exc.args and int(exc.args[0]) == ESP_ERR_INVALID_STATE):
                raise
    if hasattr(zb, "register_device"):
        try:
            zb.register_device()
        except OSError as exc:
            if not (exc.args and int(exc.args[0]) == ESP_ERR_INVALID_STATE):
                raise
    try:
        zb.start(bool(form_network))
    except OSError as exc:
        if not (exc.args and int(exc.args[0]) == ESP_ERR_INVALID_STATE):
            raise
    _coordinator_started = True
    try:
        _ensure_signal_hook()
    except Exception:
        pass
    try:
        _ensure_command_hook()
    except UnsupportedError:
        pass
    try:
        _ensure_aps_hook()
    except UnsupportedError:
        pass
    # Safety default: closed join window
    try:
        close_join()
    except Exception:
        pass
    return diagnose()


def stop_coordinator():
    """Best-effort stop if native exposes it; otherwise UnsupportedError."""
    zb = _require_native()
    for name in ("stop", "shutdown", "deinit"):
        if hasattr(zb, name):
            getattr(zb, name)()
            return True
    raise UnsupportedError(
        "native _uzigbee has no stop/shutdown — power-cycle or leave stack running"
    )


def coordinator_status():
    """Return diagnose() plus optional network_runtime fields."""
    info = diagnose()
    if not info.get("ok"):
        return info
    rt = network_runtime()
    if rt is not None:
        info["network"] = rt
    return info


def permit_join(duration_s=PERMIT_JOIN_DEFAULT_S):
    """Bounded permit-join (native uint8). duration_s=0 closes the window."""
    zb = _require_native()
    d = int(duration_s)
    if d < 0 or d > PERMIT_JOIN_MAX_S:
        raise ValueError("permit_join duration_s must be 0..%s" % PERMIT_JOIN_MAX_S)
    zb.permit_join(d)
    return d


def close_join():
    """Explicitly close joining (permit_join duration 0)."""
    return permit_join(0)


def last_joined_short_addr():
    """Joined-device discovery helper — last announced short address (or None)."""
    zb = _require_native()
    if not hasattr(zb, "get_last_joined_short_addr"):
        raise ZigbeeError("get_last_joined_short_addr not in native module")
    addr = zb.get_last_joined_short_addr()
    if addr is None:
        return None
    return int(addr) & 0xFFFF


def _normalize_active_endpoints(raw, short_addr):
    """Convert native tuple/dict snapshot into a stable dict (includes requested addr)."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        eps = raw.get("endpoints") or raw.get("endpoint_ids") or []
        return {
            "status": int(raw.get("status", 0)),
            "count": int(raw.get("count", len(eps))),
            "endpoints": [int(e) for e in eps],
            "addr": int(short_addr) & 0xFFFF,
        }
    # Native: (status, count, endpoints_tuple) — no addr in snapshot
    status = int(raw[0])
    count = int(raw[1])
    endpoints = [int(e) for e in raw[2]]
    return {
        "status": status,
        "count": count,
        "endpoints": endpoints,
        "addr": int(short_addr) & 0xFFFF,
    }


def _normalize_simple_descriptor(raw):
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    # Native: (status, addr, desc_or_None)
    status = int(raw[0])
    addr = int(raw[1]) & 0xFFFF
    desc = raw[2]
    simple_desc = None
    if desc is not None:
        if isinstance(desc, dict):
            simple_desc = desc
        else:
            simple_desc = {
                "endpoint": int(desc[0]),
                "profile_id": int(desc[1]),
                "device_id": int(desc[2]),
                "device_version": int(desc[3]),
                "input_clusters": [int(c) for c in desc[4]],
                "output_clusters": [int(c) for c in desc[5]],
            }
    return {"status": status, "addr": addr, "simple_desc": simple_desc}


def discover_active_endpoints(short_addr, wait_ms=3000, poll_ms=100):
    """
    Dual-channel (or N-channel) endpoint discovery via ZDO active endpoints.

    Returns a dict with real endpoint list from the device.
    Does **not** invent endpoints 1/2. Native snapshot has no addr field;
    this adapter stamps the requested ``short_addr``.
    """
    zb = _require_native()
    short_addr = int(short_addr) & 0xFFFF
    zb.request_active_endpoints(short_addr)
    deadline = _ticks_add(_ticks_ms(), int(wait_ms))
    while _ticks_diff(deadline, _ticks_ms()) > 0:
        raw = zb.get_active_endpoints_snapshot()
        if raw is not None:
            return _normalize_active_endpoints(raw, short_addr)
        _sleep_ms(int(poll_ms))
    raise ZigbeeError("timeout waiting for active endpoints of 0x%04x" % short_addr)


def discover_simple_descriptor(short_addr, endpoint, wait_ms=3000, poll_ms=100):
    """Fetch simple descriptor for one discovered endpoint (clusters include 0x0006 when present)."""
    zb = _require_native()
    short_addr = int(short_addr) & 0xFFFF
    endpoint = int(endpoint)
    if endpoint <= 0 or endpoint >= 0xF0:
        raise ValueError("invalid endpoint")
    zb.request_simple_descriptor(short_addr, endpoint)
    deadline = _ticks_add(_ticks_ms(), int(wait_ms))
    while _ticks_diff(deadline, _ticks_ms()) > 0:
        snap = _normalize_simple_descriptor(zb.get_simple_descriptor_snapshot())
        if snap and int(snap.get("addr", -1)) == short_addr:
            sd = snap.get("simple_desc")
            if sd is None or int(sd.get("endpoint", -1)) == endpoint:
                return snap
        _sleep_ms(int(poll_ms))
    raise ZigbeeError("timeout waiting for simple descriptor")


def discover_onoff_endpoints(short_addr, wait_ms=3000, poll_ms=100):
    """
    Return endpoints whose simple descriptor lists OnOff (0x0006) as an
    input cluster. Never hardcodes 1/2 — uses live discovery only.
    """
    active = discover_active_endpoints(short_addr, wait_ms=wait_ms, poll_ms=poll_ms)
    onoff_eps = []
    for ep in active.get("endpoints") or []:
        if int(ep) == 242:
            continue  # Green Power reserved
        try:
            snap = discover_simple_descriptor(
                short_addr, int(ep), wait_ms=wait_ms, poll_ms=poll_ms
            )
        except ZigbeeError:
            continue
        sd = (snap or {}).get("simple_desc") or {}
        ins = sd.get("input_clusters") or []
        if CLUSTER_ON_OFF in [int(c) for c in ins]:
            onoff_eps.append(int(ep))
    return {"addr": int(short_addr) & 0xFFFF, "endpoints": onoff_eps, "active": active}


def onoff_on(short_addr, dst_endpoint, src_endpoint=1):
    """ZCL OnOff cluster 0x0006 — ON (verified send_on_off_cmd)."""
    return _onoff_cmd(short_addr, dst_endpoint, CMD_ON_OFF_ON, src_endpoint)


def onoff_off(short_addr, dst_endpoint, src_endpoint=1):
    """ZCL OnOff cluster 0x0006 — OFF."""
    return _onoff_cmd(short_addr, dst_endpoint, CMD_ON_OFF_OFF, src_endpoint)


def onoff_toggle(short_addr, dst_endpoint, src_endpoint=1):
    """ZCL OnOff cluster 0x0006 — TOGGLE."""
    return _onoff_cmd(short_addr, dst_endpoint, CMD_ON_OFF_TOGGLE, src_endpoint)


def _onoff_cmd(short_addr, dst_endpoint, cmd_id, src_endpoint):
    zb = _require_native()
    short_addr = int(short_addr) & 0xFFFF
    dst_endpoint = int(dst_endpoint)
    src_endpoint = int(src_endpoint)
    if dst_endpoint <= 0 or dst_endpoint >= 0xF0:
        raise ValueError(
            "dst_endpoint must come from discover_active_endpoints — never invent endpoints"
        )
    zb.send_on_off_cmd(src_endpoint, short_addr, dst_endpoint, int(cmd_id))
    return True


def level_move_to(short_addr, dst_endpoint, level, transition_ds=0, with_onoff=True, src_endpoint=1):
    """ZCL Level Control move-to-level via native send_level_cmd (if present)."""
    zb = _require_attr("send_level_cmd")
    short_addr = int(short_addr) & 0xFFFF
    dst_endpoint = int(dst_endpoint)
    if dst_endpoint <= 0 or dst_endpoint >= 0xF0:
        raise ValueError("dst_endpoint must come from discovery — never invent endpoints")
    zb.send_level_cmd(
        src_endpoint,
        short_addr,
        dst_endpoint,
        int(level) & 0xFF,
        int(transition_ds) & 0xFFFF,
        bool(with_onoff),
    )
    return True


def identify(short_addr, dst_endpoint, time_s=3, src_endpoint=1):
    """
    Identify cluster helper. Native _uzigbee has no dedicated identify send in
    the verified export table — raise UnsupportedError rather than fake it.
    """
    zb = _require_native()
    if hasattr(zb, "send_identify_cmd"):
        zb.send_identify_cmd(src_endpoint, int(short_addr) & 0xFFFF, int(dst_endpoint), int(time_s))
        return True
    raise UnsupportedError(
        "native _uzigbee has no send_identify_cmd in pinned PoC — UnsupportedError"
    )


def group_add(short_addr, dst_endpoint, group_id, src_endpoint=1):
    zb = _require_attr("send_group_add_cmd")
    zb.send_group_add_cmd(src_endpoint, int(short_addr) & 0xFFFF, int(dst_endpoint), int(group_id) & 0xFFFF)
    return True


def group_remove(short_addr, dst_endpoint, group_id, src_endpoint=1):
    zb = _require_attr("send_group_remove_cmd")
    zb.send_group_remove_cmd(src_endpoint, int(short_addr) & 0xFFFF, int(dst_endpoint), int(group_id) & 0xFFFF)
    return True


def scene_recall(short_addr, dst_endpoint, group_id, scene_id, src_endpoint=1):
    zb = _require_attr("send_scene_recall_cmd")
    zb.send_scene_recall_cmd(
        src_endpoint, int(short_addr) & 0xFFFF, int(dst_endpoint), int(group_id) & 0xFFFF, int(scene_id) & 0xFF
    )
    return True


def bind(src_ieee, src_endpoint, cluster_id, dst_ieee, dst_endpoint, req_dst_short_addr):
    """ZDO bind via native send_bind_cmd (IEEE addresses as 8-byte buffers)."""
    zb = _require_attr("send_bind_cmd")
    zb.send_bind_cmd(src_ieee, int(src_endpoint), int(cluster_id), dst_ieee, int(dst_endpoint), int(req_dst_short_addr) & 0xFFFF)
    return True


def unbind(src_ieee, src_endpoint, cluster_id, dst_ieee, dst_endpoint, req_dst_short_addr):
    zb = _require_attr("send_unbind_cmd")
    zb.send_unbind_cmd(src_ieee, int(src_endpoint), int(cluster_id), dst_ieee, int(dst_endpoint), int(req_dst_short_addr) & 0xFFFF)
    return True


def configure_reporting(
    short_addr,
    dst_endpoint,
    cluster_id,
    attr_id,
    attr_type,
    min_interval=0,
    max_interval=300,
    reportable_change=None,
    src_endpoint=1,
):
    """Configure attribute reporting via native configure_reporting (if present)."""
    zb = _require_attr("configure_reporting")
    kwargs = {
        "src_endpoint": int(src_endpoint),
        "dst_short_addr": int(short_addr) & 0xFFFF,
        "dst_endpoint": int(dst_endpoint),
        "cluster_id": int(cluster_id),
        "attr_id": int(attr_id),
        "attr_type": int(attr_type),
        "min_interval": int(min_interval),
        "max_interval": int(max_interval),
    }
    if reportable_change is not None:
        kwargs["reportable_change"] = reportable_change
    zb.configure_reporting(**kwargs)
    return True


def enable_onoff_attr_cache():
    """Register native attribute callback used for remote OnOff report cache."""
    zb = _require_native()
    if hasattr(zb, "on_attribute"):
        zb.on_attribute(_on_attribute)
    elif hasattr(zb, "set_attribute_callback"):
        zb.set_attribute_callback(_on_attribute)
    else:
        raise ZigbeeError("native module has no attribute callback hook")
    try:
        _ensure_signal_hook()
    except Exception:
        pass


def onoff_cached(short_addr=None, dst_endpoint=None, cluster_id=CLUSTER_ON_OFF, attr_id=ATTR_ON_OFF):
    """
    Return last **reported/cached** OnOff (or other) attribute value.

    Keyed by (short_addr, endpoint, cluster, attr). This is NOT a remote ZCL
    Read Attributes transaction — native _uzigbee has no remote READ API.
    """
    _require_native()
    if dst_endpoint is None:
        raise ValueError("dst_endpoint required (from discovery)")
    ep = int(dst_endpoint)
    cluster_id = int(cluster_id)
    attr_id = int(attr_id)
    src = None if short_addr is None else (int(short_addr) & 0xFFFF)
    key = (src, ep, cluster_id, attr_id)
    if key in _attr_cache:
        return _attr_cache[key]
    # Fallback: any source for this endpoint/cluster/attr
    for k, v in _attr_cache.items():
        if k[1] == ep and k[2] == cluster_id and k[3] == attr_id:
            if src is None or k[0] is None or k[0] == src:
                return v
    raise ZigbeeError(
        "no cached report for addr=%s ep=%s cluster=0x%04x attr=0x%04x — "
        "enable_onoff_attr_cache() and ensure binding/reporting; "
        "native _uzigbee has no remote ZCL Read Attributes command"
        % (src, ep, cluster_id, attr_id)
    )


def onoff_local_get(local_endpoint=1):
    """Local coordinator OnOff attr via native get_attribute (local endpoint only)."""
    zb = _require_native()
    return zb.get_attribute(int(local_endpoint), CLUSTER_ON_OFF, ATTR_ON_OFF)


def onoff_read(short_addr=None, dst_endpoint=None, local_endpoint=None):
    """
    Compatibility entry point — distinct semantics:

    - ``local_endpoint`` set → real local ``get_attribute`` (coordinator endpoint).
    - ``dst_endpoint`` set → ``onoff_cached`` only (NOT remote ZCL Read Attributes).

    Prefer ``onoff_local_get`` / ``onoff_cached`` for clarity.
    """
    _require_native()
    if local_endpoint is not None:
        return onoff_local_get(local_endpoint)
    return onoff_cached(short_addr=short_addr, dst_endpoint=dst_endpoint)


def network_runtime():
    """Optional runtime snapshot if native exposes it (normalized dict)."""
    zb = _require_native()
    if not hasattr(zb, "get_network_runtime"):
        return None
    raw = zb.get_network_runtime()
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    # Native tuple: (channel, pan_id, extended_pan_id, short_addr, formed, joined)
    return {
        "channel": int(raw[0]),
        "pan_id": int(raw[1]),
        "extended_pan_id": raw[2],
        "short_addr": int(raw[3]),
        "formed": bool(raw[4]),
        "joined": bool(raw[5]),
    }


def local_ieee_addr():
    zb = _require_attr("get_ieee_addr")
    return zb.get_ieee_addr()


def local_short_addr():
    zb = _require_attr("get_short_addr")
    return int(zb.get_short_addr()) & 0xFFFF


def on_join(callback):
    """Register join callback; receives {signal,status,short_addr}. Native-backed via on_signal."""
    global _cb_join
    _require_native()
    _ensure_signal_hook()
    _cb_join = callback


def on_leave(callback):
    global _cb_leave
    _require_native()
    _ensure_signal_hook()
    _cb_leave = callback


def on_report(callback):
    global _cb_report
    enable_onoff_attr_cache()
    _cb_report = callback


def on_device_update(callback):
    global _cb_device_update
    _require_native()
    _ensure_signal_hook()
    _cb_device_update = callback


def on_command(callback):
    """
    Register incoming ZCL/custom/IAS/privilege command callback.

    Receives dict with short_addr, src/dst endpoints, cluster, command,
    manuf_code, payload (bytes), callback_id, status. Never invents button
    ON/OFF from join/device_update — only real native command frames.
    """
    global _cb_command
    _ensure_command_hook()
    _cb_command = callback


def enable_command_capture(custom_clusters=None):
    """
    Hook native on_command and optionally register custom clusters BEFORE start.

    ``custom_clusters`` is a list of (cluster_id, role) using native
    CLUSTER_ROLE_SERVER / CLUSTER_ROLE_CLIENT. Required for
    ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_* when the coordinator must own that cluster.
    Call before ``start_coordinator`` / ``register_device``.

    Do **not** pass cluster 0xEF00 — upstream ``add_custom_cluster`` rejects IDs
    outside 0xFC00..0xFFFF. Use ``enable_aps_capture()`` for SC10/TS0021 0xEF00.
    """
    zb = _require_native()
    _ensure_command_hook()
    if custom_clusters:
        if not hasattr(zb, "add_custom_cluster"):
            raise UnsupportedError("native _uzigbee has no add_custom_cluster")
        for item in custom_clusters:
            cluster_id, role = item[0], item[1]
            cid = int(cluster_id)
            if cid == CLUSTER_TUYA_EF00:
                raise ValueError(
                    "add_custom_cluster(0xEF00) is invalid (upstream requires "
                    "cluster_id >= 0xFC00). Use enable_aps_capture() instead."
                )
            zb.add_custom_cluster(cid, int(role))
    return True


def enable_aps_capture():
    """
    Hook native on_aps for SDK 1.6.8 APSDE indication (HA 0xEF00 capture).

    Safe to call before or after start_coordinator; native registration happens
    inside uzb_core_start after device register. Reinit guards via _aps_hooked.
    """
    _ensure_aps_hook()
    try:
        _ensure_command_hook()
    except UnsupportedError:
        pass
    try:
        _ensure_signal_hook()
    except Exception:
        pass
    return True


def on_aps(callback):
    """Register raw APS callback; receives aps payload dict (kind='aps')."""
    global _cb_aps
    _ensure_aps_hook()
    _cb_aps = callback


def on_button(callback):
    """
    Register button callback. Fires only for validated TS0021 DP1/DP2 gestures
    decoded from real APS 0xEF00 frames — never from join/device_update/report.
    """
    global _cb_button
    _ensure_aps_hook()
    _cb_button = callback


def set_device_fingerprint(short_addr, manufacturer, model, verified=False):
    """
    Record Basic identity after a real read. Until verified=True with matching
    manufacturer/model, button events stay labeled UNVERIFIED.
    """
    addr = int(short_addr) & 0xFFFF
    _device_fingerprint[addr] = {
        "manufacturer": str(manufacturer) if manufacturer is not None else "",
        "model": str(model) if model is not None else "",
        "verified": bool(
            verified
            and manufacturer == TS0021_MANUFACTURER
            and model == TS0021_MODEL
        ),
    }
    return _device_fingerprint[addr]


def tuya_configure_magic_packet_unsupported():
    """
    Explicit: configureMagicPacket needs remote ZCL Basic read of
    [manufacturerName, zclVersion, appVersion, modelId, powerSource, 0xFFFE].
    Native _uzigbee has no remote Read Attributes API — do not fabricate reads.
    """
    raise UnsupportedError(
        "tuya configureMagicPacket / remote Basic read NOT available in pinned "
        "_uzigbee — no remote ZCL Read Attributes. Log inability; no made-up reads."
    )


def poll_events(max_events=EVENT_QUEUE_MAX):
    """Drain bounded event queue (non-blocking). Returns list of {kind,payload}.

    kinds: join, leave, device_update, report, command, aps, button
    """
    out = []
    n = min(int(max_events), len(_event_q))
    for _ in range(n):
        out.append(_event_q.pop(0))
    return out


def tuya_manufacturer_dp_unsupported():
    """
    Explicit gate: no fabricated Tuya DP mappings without model evidence.
    Official Smart Life cloud is a separate licensed product — not claimed here.
    Prefer decode_ts0021_button_from_aps on real APS captures; fingerprint via
    set_device_fingerprint after a real Basic read when an API exists.
    """
    raise UnsupportedError(
        "Tuya manufacturer DP support requires grounded model ID / endpoint / "
        "cluster evidence from bench discovery. No fabricated DP map. "
        "No Smart Life cloud / account spoofing. "
        "configureMagicPacket: " + "see tuya_configure_magic_packet_unsupported()."
    )
