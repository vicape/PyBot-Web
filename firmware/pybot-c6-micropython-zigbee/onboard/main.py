# Boot-safe autonomous example for Waveshare ESP32-C6-LCD-1.47
# custom MicroPython + _uzigbee firmware (no PC required after install).
#
# Safety defaults:
# - PERMIT_JOIN_ON_BOOT = False (network stays closed)
# - No endless rejoin / steering loops
# - Persistent pairing relies on SDK NVRAM (zb_storage) when supported — not forced reopen
# - Missing _uzigbee → honest diagnostic on LCD/REPL, not a fake Zigbee pass

PERMIT_JOIN_ON_BOOT = False
FORM_NETWORK_ON_BOOT = True

try:
    import pybot.zigbee as zigbee
except ImportError:
    # Allow running from /pybot/zigbee.py or frozen copy named pybot_zigbee
    try:
        import pybot_zigbee as zigbee
    except ImportError:
        zigbee = None


def _show(msg):
    print(msg)
    try:
        import pybot.display as display

        d = display.Display()
        d.fill(0)
        # text API may vary; keep best-effort for boot diagnostics
        if hasattr(d, "text"):
            d.text(str(msg)[:40], 0, 0, 0xFFFF)
        if hasattr(d, "show"):
            d.show()
    except Exception as exc:
        print("display diagnostic skipped:", exc)


def main():
    if zigbee is None:
        _show("NO pybot.zigbee")
        print(
            "Install pybot/zigbee.py from firmware/pybot-c6-micropython-zigbee/onboard/ "
            "onto the custom firmware image."
        )
        return

    info = zigbee.diagnose()
    print("pybot.zigbee.diagnose", info)
    if not info.get("ok"):
        _show("NO _uzigbee")
        print(info.get("message"))
        print(info.get("nextStep"))
        return

    _show("ZB coord start")
    zigbee.start_coordinator(form_network=FORM_NETWORK_ON_BOOT)
    zigbee.close_join()
    if PERMIT_JOIN_ON_BOOT:
        # Opt-in only — default False prevents unsupervised joining
        zigbee.permit_join(60)
        _show("join 60s")
    else:
        _show("ZB ready closed")

    # Idle forever without re-opening join or restarting steering
    import time

    while True:
        time.sleep(10)


main()
