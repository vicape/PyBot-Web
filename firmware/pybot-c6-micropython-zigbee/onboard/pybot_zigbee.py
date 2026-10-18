# SPDX-License-Identifier: MIT
# PyBot on-device Zigbee adapter for custom MicroPython+_uzigbee firmware.
# Maps ONLY verified upstream native bindings from mateuszsury/uZigbee (ZBOSS v1.6).
# NOT a mock radio. On stock MicroPython (no _uzigbee) diagnostics are honest FAIL.
#
# Attribution: native stack via MIT uZigbee; Zigbee SDK binaries have separate terms
# (see firmware/pybot-c6-micropython-zigbee/LICENSE_ATTRIBUTION.md).

"""pybot.zigbee — coordinator helpers over native ``_uzigbee``."""

try:
    import _uzigbee as _native
except ImportError:  # pragma: no cover - exercised on stock firmware
    _native = None

# ZCL / role constants verified against uZigbee c_module + python/uzigbee
ROLE_COORDINATOR = 0
CLUSTER_ON_OFF = 0x0006
ATTR_ON_OFF = 0x0000
CMD_ON_OFF_OFF = 0
CMD_ON_OFF_ON = 1
CMD_ON_OFF_TOGGLE = 2

PERMIT_JOIN_MAX_S = 254  # uint8 bound in native permit_join
PERMIT_JOIN_DEFAULT_S = 60

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


def start_coordinator(form_network=True, create_local_onoff_switch=True, local_endpoint=1):
    """
    Start Zigbee 3.x coordinator via verified upstream ``init`` + ``start``.

    ``local_endpoint`` is the *coordinator's own* ZCL client endpoint used as
    src for OnOff commands — not a claim about joined dual-channel switch EPs.
    """
    zb = _require_native()
    zb.init(ROLE_COORDINATOR)
    if create_local_onoff_switch and hasattr(zb, "create_on_off_switch"):
        zb.create_on_off_switch(int(local_endpoint))
    if hasattr(zb, "register_device"):
        zb.register_device()
    zb.start(bool(form_network))
    return diagnose()


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


def discover_active_endpoints(short_addr, wait_ms=3000, poll_ms=100):
    """
    Dual-channel (or N-channel) endpoint discovery via ZDO active endpoints.

    Returns the snapshot from native firmware. Does **not** invent endpoints 1/2.
    """
    zb = _require_native()
    import time

    short_addr = int(short_addr) & 0xFFFF
    zb.request_active_endpoints(short_addr)
    deadline = time.ticks_add(time.ticks_ms(), int(wait_ms))
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        snap = zb.get_active_endpoints_snapshot()
        if snap and int(snap.get("addr", -1)) == short_addr:
            # Upstream snapshot carries real endpoint list from the device
            return snap
        time.sleep_ms(int(poll_ms))
    raise ZigbeeError("timeout waiting for active endpoints of 0x%04x" % short_addr)


def discover_simple_descriptor(short_addr, endpoint, wait_ms=3000, poll_ms=100):
    """Fetch simple descriptor for one discovered endpoint (clusters include 0x0006 when present)."""
    zb = _require_native()
    import time

    short_addr = int(short_addr) & 0xFFFF
    endpoint = int(endpoint)
    if endpoint <= 0 or endpoint >= 0xF0:
        raise ValueError("invalid endpoint")
    zb.request_simple_descriptor(short_addr, endpoint)
    deadline = time.ticks_add(time.ticks_ms(), int(wait_ms))
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        snap = zb.get_simple_descriptor_snapshot()
        if snap and int(snap.get("addr", -1)) == short_addr:
            return snap
        time.sleep_ms(int(poll_ms))
    raise ZigbeeError("timeout waiting for simple descriptor")


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


# Last remote OnOff attribute values from native attr callbacks (reporting path).
_onoff_cache = {}


def _on_attribute(endpoint, cluster_id, attr_id, value, *_rest):
    if int(cluster_id) == CLUSTER_ON_OFF and int(attr_id) == ATTR_ON_OFF:
        _onoff_cache[int(endpoint)] = value


def enable_onoff_attr_cache():
    """Register native attribute callback used for remote OnOff READ via reports."""
    zb = _require_native()
    if hasattr(zb, "on_attribute"):
        zb.on_attribute(_on_attribute)
    elif hasattr(zb, "set_attribute_callback"):
        zb.set_attribute_callback(_on_attribute)
    else:
        raise ZigbeeError("native module has no attribute callback hook")


def onoff_read(short_addr=None, dst_endpoint=None, local_endpoint=None):
    """
    Read OnOff attr 0x0000 on cluster 0x0006.

    Upstream native C exposes ``get_attribute`` for **local** endpoints and
    attribute callbacks/reporting for remotes — there is no remote ZCL Read
    Attributes API in ``_uzigbee``. This adapter mirrors that truth:

    - If ``local_endpoint`` is set: ``get_attribute`` on the coordinator.
    - If ``dst_endpoint`` is set: return last reported value for that endpoint
      from ``enable_onoff_attr_cache()``; raise if never reported.
    """
    zb = _require_native()
    if local_endpoint is not None:
        return zb.get_attribute(int(local_endpoint), CLUSTER_ON_OFF, ATTR_ON_OFF)
    if dst_endpoint is None:
        raise ValueError("provide local_endpoint or dst_endpoint (from discovery)")
    ep = int(dst_endpoint)
    if ep not in _onoff_cache:
        raise ZigbeeError(
            "no cached OnOff report for endpoint %s — enable_onoff_attr_cache(), "
            "ensure binding/reporting, or use onoff_on/onoff_off; "
            "native _uzigbee has no remote ZCL Read Attributes command"
            % ep
        )
    return _onoff_cache[ep]


def network_runtime():
    """Optional runtime snapshot if native exposes it."""
    zb = _require_native()
    if hasattr(zb, "get_network_runtime"):
        return zb.get_network_runtime()
    return None
