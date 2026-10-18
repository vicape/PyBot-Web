/**
 * MicroPython modules uploaded only for Universal Lab C6 runtime.
 * English API names; expose only capabilities marked IMPLEMENTED on the profile.
 * Hardware results remain UNVERIFIED until physical bench tests.
 *
 * display.py is extended additively (shapes/text/images); ST7789 init/show/pins
 * remain the proven driver — see displayPySource.js / displayModule.py.
 */

import { DISPLAY_PY_SOURCE } from "./displayPySource.js";

/** @type {Readonly<Record<string, string>>} */
export const C6_BOARD_MODULES = Object.freeze({
  "pybot/__init__.py": [
    "# PyBot Universal Lab — Waveshare ESP32-C6-LCD-1.47 helpers",
    "# Hardware validation: UNVERIFIED until device bench tests.",
    "",
  ].join("\n"),

  "pybot/gpio.py": [
    '"""Digital / PWM / ADC helpers for the selected board profile."""',
    "from machine import Pin, PWM, ADC",
    "",
    "# Header GPIOs documented for Waveshare ESP32-C6-LCD-1.47",
    "AVAILABLE_GPIO = (0, 1, 2, 3, 10, 11, 18, 19, 20, 23)",
    "RESERVED_LCD = (6, 7, 14, 15, 21, 22)",
    "BOOT_BUTTON = 9",
    "RGB_LED = 8",
    "",
    "",
    "def _check_pin(pin):",
    "    p = int(pin)",
    "    if p in RESERVED_LCD:",
    '        raise ValueError("GPIO %s is reserved for the onboard LCD" % p)',
    "    return p",
    "",
    "",
    "def digital_out(pin, value=0):",
    '    """Configure pin as output and write 0/1."""',
    "    p = Pin(_check_pin(pin), Pin.OUT)",
    "    p.value(1 if value else 0)",
    "    return p",
    "",
    "",
    "def digital_in(pin, pull=None):",
    '    """Configure pin as input. pull: None, Pin.PULL_UP, or Pin.PULL_DOWN."""',
    "    kwargs = {}",
    "    if pull is not None:",
    '        kwargs["pull"] = pull',
    "    return Pin(_check_pin(pin), Pin.IN, **kwargs)",
    "",
    "",
    "def pwm_out(pin, freq=1000, duty_u16=0):",
    '    """PWM on an available GPIO (duty_u16 0..65535)."""',
    "    p = PWM(Pin(_check_pin(pin)), freq=int(freq), duty_u16=int(duty_u16))",
    "    return p",
    "",
    "",
    "def analog_in(pin):",
    '    """ADC read helper (returns machine.ADC)."""',
    "    return ADC(Pin(_check_pin(pin)))",
    "",
    "",
    "def boot_button(pull=Pin.PULL_UP):",
    '    """Onboard BOOT button (GPIO9, active low)."""',
    "    return Pin(BOOT_BUTTON, Pin.IN, pull)",
    "",
    "",
    "def rgb_led():",
    '    """Onboard RGB LED data pin (GPIO8 / WS2812-compatible)."""',
    "    return Pin(RGB_LED, Pin.OUT)",
    "",
  ].join("\n"),

  "pybot/display.py": DISPLAY_PY_SOURCE,

  "pybot/wifi.py": [
    '"""Wi-Fi client / AP helpers (stock MicroPython network.WLAN on ESP32-C6)."""',
    "import network",
    "import time",
    "",
    "",
    "def station():",
    '    """Return WLAN station interface."""',
    "    return network.WLAN(network.STA_IF)",
    "",
    "",
    "def access_point():",
    '    """Return WLAN soft-AP interface."""',
    "    return network.WLAN(network.AP_IF)",
    "",
    "",
    "def connect(ssid, password, timeout_ms=15000):",
    '    """Connect station to an AP. Raises OSError on failure."""',
    "    wlan = station()",
    "    wlan.active(True)",
    "    if not wlan.isconnected():",
    "        wlan.connect(ssid, password)",
    "        start = time.ticks_ms()",
    "        while not wlan.isconnected():",
    "            if time.ticks_diff(time.ticks_ms(), start) > timeout_ms:",
    '                raise OSError("Wi-Fi connect timeout")',
    "            time.sleep_ms(200)",
    "    return wlan.ifconfig()",
    "",
    "",
    "def start_ap(ssid, password=None, authmode=None):",
    '    """Start soft-AP. password optional."""',
    "    ap = access_point()",
    "    ap.active(True)",
    "    if password:",
    "        am = authmode if authmode is not None else network.AUTH_WPA_WPA2_PSK",
    "        ap.config(essid=ssid, password=password, authmode=am)",
    "    else:",
    "        ap.config(essid=ssid)",
    "    return ap.ifconfig()",
    "",
  ].join("\n"),

  "pybot/bluetooth.py": [
    '"""BLE helpers using stock MicroPython bluetooth (ESP32-C6)."""',
    "import bluetooth",
    "",
    "",
    "def ble():",
    '    """Return a bluetooth.BLE instance (active=False until caller enables)."""',
    "    return bluetooth.BLE()",
    "",
    "",
    "def activate():",
    '    """Activate the BLE radio and return the BLE object."""',
    "    b = bluetooth.BLE()",
    "    b.active(True)",
    "    return b",
    "",
  ].join("\n"),

  "pybot/power.py": [
    '"""Light sleep / deep sleep helpers (stock esp32 / machine)."""',
    "import machine",
    "",
    "",
    "def lightsleep(ms):",
    "    machine.lightsleep(int(ms))",
    "",
    "",
    "def deepsleep(ms):",
    "    machine.deepsleep(int(ms))",
    "",
    "",
    "def reset():",
    "    machine.reset()",
    "",
  ].join("\n"),
});

/**
 * Modules to install for a ready C6 session (path → source).
 * @returns {ReadonlyArray<[string, string]>}
 */
export function listC6ModulesForInstall() {
  return Object.freeze(Object.entries(C6_BOARD_MODULES));
}
