# SPDX-License-Identifier: MIT
# Self-contained SC10 two-button remote APS capture for Waveshare ESP32-C6-LCD-1.47.
#
# Physical evidence (do NOT invent mappings):
#   SC10 short e.g. 0x6320, EP1, input [0x0001,0x0500,0xEF00,0x0000],
#   output [0x0019,0x000A], NO OnOff 0x0006 — Tuya-profile scene remote (TS0021 candidate).
#
# Capture path: native APSDE indication (SDK 1.6.8) via pybot.zigbee.enable_aps_capture /
# kind='aps'. Do NOT register custom cluster 0xEF00 (upstream rejects IDs < 0xFC00).
#
# LCD/terminal: listening + APS count + payload hex; KEY1/KEY2 only after validated
# DP1/DP2 gestures (0/1/2). Never treats join/device_update/report as buttons.
#
# Safety: pairing CLOSED by default; form_network=False so NVRAM may keep the
# existing lab network without opening join (does not touch Tuya Smart Life).
# Repeated start_coordinator is idempotent (OSError 259 avoided).
# Supervisor may call zigbee.permit_join(60) when needed.

PERMIT_JOIN_ON_BOOT = False
FORM_NETWORK_ON_BOOT = False  # reopen existing zb_storage network if present
CAPTURE_SECONDS = 180
# 0xEF00 is manufacturer-specific — captured via APS only (not custom-cluster API)
SC10_CLUSTER_EF00 = 0xEF00

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
    if isinstance(payload, str):
        return payload
    return "".join("%02x" % (b & 0xFF) for b in payload)


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

    # APS capture for 0xEF00 — never register that id as a custom cluster
    try:
        zigbee.enable_aps_capture()
    except Exception as exc:
        _show(["NO on_aps", "rebuild fw"])
        print("aps capture setup:", exc)
        return

    # Optional command hook (IAS/custom>=0xFC00); ignore if overlay missing
    try:
        zigbee.enable_command_capture()
    except Exception as exc:
        print("command capture optional:", exc)

    _show(["SC10 APS", "start coord"])
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
        _show(["join open 60s", "listening APS"])
    else:
        _show(["ZB closed", "listening APS"])

    import time

    btn_seen = set()
    aps_count = 0
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
                print("report raw (not a button):", payload)
                continue
            if kind == "command":
                cmd_count += 1
                print(
                    "CMD cluster=0x%04x cmd=0x%02x bytes=%s"
                    % (
                        int(payload.get("cluster", 0)),
                        int(payload.get("command", 0)),
                        _hex(payload.get("payload") or b""),
                    )
                )
                continue
            if kind == "aps":
                aps_count += 1
                raw = payload.get("raw_hex") or _hex(payload.get("asdu") or b"")
                trunc = " TRUNC" if payload.get("truncated") else ""
                print(
                    "APS src=0x%04x ep=%s cluster=0x%04x len=%s/%s%s hex=%s model=%s"
                    % (
                        int(payload.get("short_addr", 0)),
                        payload.get("src_endpoint"),
                        int(payload.get("cluster", 0)),
                        payload.get("asdu_len"),
                        payload.get("asdu_len_orig"),
                        trunc,
                        raw,
                        payload.get("model"),
                    )
                )
                lines = [
                    "APS %s" % aps_count,
                    "c=0x%04x" % int(payload.get("cluster", 0)),
                    raw[:20] or "(no data)",
                ]
                if "KEY1" in btn_seen:
                    lines.append("KEY1")
                if "KEY2" in btn_seen:
                    lines.append("KEY2")
                _show(lines, 0xFFE0)
                continue
            if kind == "button":
                key = payload.get("key")
                if key:
                    btn_seen.add(key)
                print(
                    "BUTTON %s dp=%s gesture=%s raw=%s verified=%s"
                    % (
                        key,
                        payload.get("dp"),
                        payload.get("gesture_name"),
                        payload.get("raw_hex"),
                        payload.get("fingerprint_verified"),
                    )
                )
                lines = ["KEY %s" % key, payload.get("gesture_name") or ""]
                if "KEY1" in btn_seen:
                    lines.append("KEY1")
                if "KEY2" in btn_seen:
                    lines.append("KEY2")
                lines.append("APS %s" % aps_count)
                _show(lines, 0x07E0)
                continue

        time.sleep_ms(50) if hasattr(time, "sleep_ms") else time.sleep(0.05)

    if "KEY1" in btn_seen and "KEY2" in btn_seen:
        _show(["KEY1", "KEY2", "APS %s" % aps_count], 0x07E0)
    else:
        _show(
            [
                "FINISHED",
                "APS %s" % aps_count,
                "CMD %s" % cmd_count,
                "SIG %s" % signal_count,
                "KEY %s" % sorted(btn_seen),
            ]
        )
    print(
        "done aps=%s cmds=%s signals=%s keys=%s (join/device_update never count as buttons)"
        % (aps_count, cmd_count, signal_count, sorted(btn_seen))
    )


main()
