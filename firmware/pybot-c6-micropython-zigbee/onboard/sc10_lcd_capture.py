# SPDX-License-Identifier: MIT
# Self-contained SC10 two-button remote capture for Waveshare ESP32-C6-LCD-1.47.
#
# Physical evidence (do NOT invent mappings):
#   SC10 short 0xC22B, EP1, input [0x0001,0x0500,0xEF00,0x0000],
#   output [0x0019,0x000A], NO OnOff 0x0006.
# Shows TWO button labels ONLY after matching verified command events that the
# operator records into BUTTON_MAP. Until then: raw cluster/cmd/EP + UNMAPPED
# and hex payload logs. Never treats join/device_update as button ON/OFF.
#
# Safety: pairing CLOSED by default; form_network=False so NVRAM may keep the
# existing lab network without opening join (does not touch Tuya Smart Life).
# Repeated start_coordinator is idempotent (OSError 259 avoided).

PERMIT_JOIN_ON_BOOT = False
FORM_NETWORK_ON_BOOT = False  # reopen existing zb_storage network if present
CAPTURE_SECONDS = 180
# Cluster 0xEF00 is manufacturer-specific on SC10 — register both roles so
# SDK 1.6 CUSTOM_CLUSTER_* callbacks can fire when frames match endpoint/role.
SC10_CUSTOM_CLUSTER = 0xEF00
# Fill ONLY after logging real command events on your bench, e.g.:
#   {(0xEF00, 0x01, 1): "BTN1", (0xEF00, 0x02, 1): "BTN2"}
# Keys: (cluster, command_id, src_endpoint). Empty => always UNMAPPED.
BUTTON_MAP = {}

try:
    import pybot.zigbee as zigbee
except ImportError:
    try:
        import pybot_zigbee as zigbee
    except ImportError:
        zigbee = None


def _lcd():
    try:
        import pybot.display as display

        if hasattr(display, "init"):
            return display.init()
        return display.Lcd()
    except Exception as exc:
        print("lcd skip:", exc)
        return None


def _show(lines, color=0xFFFF):
    print(" | ".join(str(x) for x in lines))
    lcd = _lcd()
    if lcd is None:
        return
    try:
        lcd.fill(0)
        y = 0
        for line in lines[:6]:
            text = str(line)[:20]
            if hasattr(lcd, "text"):
                lcd.text(text, 0, y, color)
            y += 16
        if hasattr(lcd, "show"):
            lcd.show()
    except Exception as exc:
        print("lcd draw:", exc)


def _hex(payload):
    if not payload:
        return ""
    return "".join("%02x" % (b & 0xFF) for b in payload)


def _match_button(ev):
    """Return button label only from BUTTON_MAP + real command fields."""
    if not BUTTON_MAP:
        return None
    key = (int(ev.get("cluster", -1)), int(ev.get("command", -1)), int(ev.get("src_endpoint", -1)))
    return BUTTON_MAP.get(key)


def main():
    if zigbee is None:
        _show(["NO pybot.zigbee"])
        return

    info = zigbee.diagnose()
    print("diagnose", info)
    if not info.get("ok"):
        _show(["ZIGBEE NOT INSTALLED"])
        print(info.get("message"))
        return

    # init first (required for add_custom_cluster), then register 0xEF00 before
    # create/register/start so CUSTOM_CLUSTER callbacks are eligible.
    # Roles: Espressif 1.6 SERVER=0x01 CLIENT=0x02 (native exports preferred).
    try:
        import _uzigbee as _zb

        _zb.init(zigbee.ROLE_COORDINATOR)
        role_srv = int(getattr(_zb, "CLUSTER_ROLE_SERVER", 0x01))
        role_cli = int(getattr(_zb, "CLUSTER_ROLE_CLIENT", 0x02))
        zigbee.enable_command_capture(
            custom_clusters=[
                (SC10_CUSTOM_CLUSTER, role_cli),
                (SC10_CUSTOM_CLUSTER, role_srv),
            ]
        )
    except Exception as exc:
        print("command capture setup:", exc)
        try:
            zigbee.enable_command_capture()
        except Exception as exc2:
            _show(["NO on_command", "rebuild fw"])
            print(exc2)
            return

    _show(["SC10 capture", "start coord"])
    zigbee.start_coordinator(
        form_network=FORM_NETWORK_ON_BOOT,
        create_local_onoff_switch=True,
        local_endpoint=1,
    )
    # Second call must not raise OSError 259
    zigbee.start_coordinator(form_network=False, create_local_onoff_switch=True)
    zigbee.close_join()
    if PERMIT_JOIN_ON_BOOT:
        zigbee.permit_join(60)
        _show(["join open 60s"])
    else:
        _show(["ZB closed", "wait cmds"])

    import time

    btn_seen = set()
    cmd_count = 0
    signal_count = 0
    t0 = time.ticks_ms() if hasattr(time, "ticks_ms") else int(time.time() * 1000)

    def _ticks():
        return time.ticks_ms() if hasattr(time, "ticks_ms") else int(time.time() * 1000)

    def _diff(a, b):
        return time.ticks_diff(a, b) if hasattr(time, "ticks_diff") else (a - b)

    while _diff(_ticks(), t0) < CAPTURE_SECONDS * 1000:
        for ev in zigbee.poll_events(16):
            kind = ev.get("kind")
            payload = ev.get("payload") or {}
            if kind in ("join", "leave", "device_update"):
                signal_count += 1
                print("signal-only (not a button):", kind, payload)
                continue
            if kind == "report":
                # Attribute report is not a fabricated button; log raw only.
                print("report raw:", payload)
                continue
            if kind != "command":
                continue
            cmd_count += 1
            cluster = int(payload.get("cluster", 0))
            cmd = int(payload.get("command", 0))
            src_ep = int(payload.get("src_endpoint", 0))
            dst_ep = int(payload.get("dst_endpoint", 0))
            raw = payload.get("payload") or b""
            print(
                "CMD cluster=0x%04x cmd=0x%02x src_ep=%s dst_ep=%s manuf=0x%04x cb=0x%04x bytes=%s"
                % (
                    cluster,
                    cmd,
                    src_ep,
                    dst_ep,
                    int(payload.get("manuf_code", 0)),
                    int(payload.get("callback_id", 0)),
                    _hex(raw),
                )
            )
            label = _match_button(payload)
            if label:
                btn_seen.add(label)
                lines = ["MAPPED " + label, "c=0x%04x cmd=%02x" % (cluster, cmd)]
                if "BTN1" in btn_seen:
                    lines.append("BTN1")
                if "BTN2" in btn_seen:
                    lines.append("BTN2")
                _show(lines, 0x07E0)
            else:
                _show(
                    [
                        "UNMAPPED",
                        "c=0x%04x" % cluster,
                        "cmd=0x%02x ep%s" % (cmd, src_ep),
                        _hex(raw)[:20] or "(no data)",
                    ],
                    0xFFE0,
                )

        time.sleep_ms(50) if hasattr(time, "sleep_ms") else time.sleep(0.05)

    # Two separate button labels ONLY if both were mapped from real commands.
    if "BTN1" in btn_seen and "BTN2" in btn_seen:
        _show(["BTN1", "BTN2", "cmds=%s" % cmd_count], 0x07E0)
    else:
        _show(
            [
                "FINISHED",
                "CMDS %s" % cmd_count,
                "SIG %s" % signal_count,
                "MAP %s" % sorted(btn_seen),
            ]
        )
    print(
        "done cmds=%s signals=%s mapped=%s (join/device_update never count as buttons)"
        % (cmd_count, signal_count, sorted(btn_seen))
    )


main()
