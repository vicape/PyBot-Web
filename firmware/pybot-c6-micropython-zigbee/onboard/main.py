# Boot-safe autonomous C6 Zigbee hub example (Waveshare ESP32-C6-LCD-1.47).
# Runs from /main.py on power-on without PC/browser/USB host when custom
# MicroPython+_uzigbee firmware is installed.
#
# Safety defaults:
# - PERMIT_JOIN_ON_BOOT = False (network stays closed)
# - No automatic On/Off of mains relays on power-on or in idle loops
# - Join only via BOOT button (GPIO9) with debounce
# - After discovery, long-press BOOT toggles ONE discovered OnOff endpoint
# - Endpoints discovered live — never hardcode 1/2
# - Stock firmware (no _uzigbee) → honest "ZIGBEE NOT INSTALLED" on LCD
#
# Display uses proven public API: display.init() / Lcd (NOT display.Display).

PERMIT_JOIN_ON_BOOT = False
FORM_NETWORK_ON_BOOT = True
JOIN_WINDOW_S = 60
BOOT_PIN = 9  # Waveshare C6 BOOT button
DEBOUNCE_MS = 40
LONG_PRESS_MS = 800  # long-press = supervised channel toggle (human only)

try:
    import pybot.zigbee as zigbee
except ImportError:
    try:
        import pybot_zigbee as zigbee
    except ImportError:
        zigbee = None


def _show(msg, color=0xFFFF):
    print(msg)
    try:
        import pybot.display as display

        # Physically tested API: init() returns Lcd (or use Lcd() directly)
        if hasattr(display, "init"):
            lcd = display.init()
        else:
            lcd = display.Lcd()
        lcd.fill(0)
        line = str(msg)[:40]
        if hasattr(lcd, "text"):
            lcd.text(line, 0, 0, color)
        if hasattr(lcd, "show"):
            lcd.show()
    except Exception as exc:
        print("display diagnostic skipped:", exc)


def _boot_down(pin):
    # Active-low BOOT on ESP32-C6
    try:
        return pin.value() == 0
    except Exception:
        return False


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
        _show("ZIGBEE NOT INSTALLED")
        print(info.get("message"))
        print(info.get("nextStep"))
        return

    _show("ZB coord start")
    # form_network=True forms if needed; SDK NVRAM may keep prior pairings.
    # close_join() is also applied inside start_coordinator.
    zigbee.start_coordinator(form_network=FORM_NETWORK_ON_BOOT)
    zigbee.close_join()
    try:
        zigbee.enable_onoff_attr_cache()
    except Exception as exc:
        print("attr cache optional:", exc)

    if PERMIT_JOIN_ON_BOOT:
        zigbee.permit_join(JOIN_WINDOW_S)
        _show("join %ss" % JOIN_WINDOW_S)
    else:
        _show("ZB ready closed")

    import time
    from machine import Pin

    boot = Pin(BOOT_PIN, Pin.IN, Pin.PULL_UP)
    known_addr = None
    onoff_eps = []
    channel_i = 0

    while True:
        # BOOT short press → time-limited permit_join
        # BOOT long press → toggle next discovered OnOff endpoint (supervised)
        if _boot_down(boot):
            time.sleep_ms(DEBOUNCE_MS)
            if not _boot_down(boot):
                continue
            t0 = time.ticks_ms()
            while _boot_down(boot):
                time.sleep_ms(20)
            held = time.ticks_diff(time.ticks_ms(), t0)
            if held >= LONG_PRESS_MS and known_addr is not None and onoff_eps:
                ep = onoff_eps[channel_i % len(onoff_eps)]
                channel_i += 1
                try:
                    zigbee.onoff_toggle(known_addr, ep)
                    _show("tog 0x%04x ep%s" % (known_addr, ep))
                except Exception as exc:
                    print("onoff:", exc)
            else:
                zigbee.permit_join(JOIN_WINDOW_S)
                _show("join %ss" % JOIN_WINDOW_S)

        # Drain native-backed events (bounded)
        try:
            for ev in zigbee.poll_events(8):
                print("zb event", ev)
                if ev.get("kind") == "join":
                    addr = (ev.get("payload") or {}).get("short_addr")
                    if addr is None:
                        addr = zigbee.last_joined_short_addr()
                    if addr is not None:
                        known_addr = int(addr) & 0xFFFF
                        _show("joined 0x%04x" % known_addr)
                        try:
                            disc = zigbee.discover_onoff_endpoints(known_addr)
                            onoff_eps = disc.get("endpoints") or []
                            _show("eps %s" % onoff_eps)
                        except Exception as exc:
                            print("discover:", exc)
                            onoff_eps = []
        except Exception as exc:
            print("poll:", exc)

        # Also poll last_joined if signal path missed (bounded)
        if known_addr is None:
            try:
                addr = zigbee.last_joined_short_addr()
                if addr is not None:
                    known_addr = int(addr) & 0xFFFF
                    _show("found 0x%04x" % known_addr)
                    disc = zigbee.discover_onoff_endpoints(known_addr)
                    onoff_eps = disc.get("endpoints") or []
                    _show("eps %s" % onoff_eps)
            except Exception:
                pass

        time.sleep_ms(100)


main()
