"""Simula EDA6 entradas digitales/analógicas sin placa (fake machine)."""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path


class FakePin:
    IN = 0
    OUT = 1
    values = {}  # gpio -> level

    def __init__(self, gpio, mode=None):
        self.gpio = int(gpio)
        self.mode = mode
        FakePin.created.append(self)

    def value(self, v=None):
        if v is None:
            return int(FakePin.values.get(self.gpio, 0))
        FakePin.values[self.gpio] = 1 if v else 0
        return None


FakePin.created = []


class FakeADC:
    ATTN_11DB = 0
    WIDTH_12BIT = 0
    raw_by_gpio = {}
    fail_read = set()
    instances = []

    def __init__(self, pin):
        self.gpio = pin.gpio
        FakeADC.instances.append(self)

    def atten(self, *_a):
        return None

    def width(self, *_a):
        return None

    def read(self):
        if self.gpio in FakeADC.fail_read:
            raise OSError("stale")
        return int(FakeADC.raw_by_gpio.get(self.gpio, 0))

    def read_u16(self):
        return self.read() * 65535 // 4095


class FakeWLAN:
    STA_IF = 0
    instances = []

    def __init__(self, *_a):
        self._active = False
        self._connected = False
        FakeWLAN.instances.append(self)

    def active(self, v=None):
        if v is None:
            return self._active
        self._active = bool(v)
        if not self._active:
            self._connected = False
        return None

    def isconnected(self):
        return bool(self._connected)

    def disconnect(self):
        self._connected = False


class FakePWM:
    def __init__(self, pin):
        self.gpio = pin.gpio

    def freq(self, *_a):
        return 50

    def duty(self, *_a):
        return None

    def duty_u16(self, *_a):
        return None

    def deinit(self):
        return None


def install_mocks():
    FakePin.created = []
    FakePin.values = {}
    FakeADC.instances = []
    FakeADC.raw_by_gpio = {}
    FakeADC.fail_read = set()
    FakeWLAN.instances = []

    machine = types.ModuleType("machine")
    machine.Pin = FakePin
    machine.ADC = FakeADC
    machine.PWM = FakePWM
    sys.modules["machine"] = machine

    t = types.ModuleType("time")
    t.sleep = lambda *_a, **_k: None
    t.sleep_ms = lambda *_a, **_k: None
    t.sleep_us = lambda *_a, **_k: None
    _ticks = {"n": 0}

    def ticks_us():
        _ticks["n"] += 1000
        return _ticks["n"]

    t.ticks_us = ticks_us
    t.ticks_diff = lambda a, b: a - b
    sys.modules["time"] = t

    network = types.ModuleType("network")
    network.STA_IF = FakeWLAN.STA_IF
    network.WLAN = FakeWLAN
    sys.modules["network"] = network
    return machine


def load_eda6(path: Path):
    # Evitar residuales entre escenarios.
    for name in list(sys.modules):
        if name == "EDA6" or name.endswith(".EDA6"):
            del sys.modules[name]
    ns = {"__name__": "EDA6", "__file__": str(path)}
    code = path.read_text(encoding="utf-8")
    exec(compile(code, str(path), "exec"), ns)
    return types.SimpleNamespace(**{k: v for k, v in ns.items() if not k.startswith("__")})


def main():
    eda6_path = Path(sys.argv[1])
    install_mocks()
    E = load_eda6(eda6_path)
    E.PLACA_ACTUAL = "WEMOS"

    assert E.EDA6_VERSION == "1.1.1"
    assert list(E.PIN_MAPS["WEMOS"]["digital_inputs"]) == [5, 23, 19, 18]
    assert list(E.PIN_MAPS["WEMOS"]["adc_inputs"]) == [2, 4, 35, 34]
    assert list(E.PIN_MAPS["ESP32"]["digital_inputs"]) == [4, 2, 15, 0]
    assert list(E.PIN_MAPS["ESP32"]["adc_inputs"]) == [35, 34, 39, 36]

    # Digital: map + 0/1
    FakePin.values = {5: 1, 23: 0, 19: 1, 18: 0}
    dig = [E.entradaDigital(n) for n in range(1, 5)]
    assert dig == [1, 0, 1, 0]
    used = [p.gpio for p in FakePin.created[-4:]]
    assert used == [5, 23, 19, 18]

    # Analog 0..100 (sin Wi-Fi)
    FakeADC.raw_by_gpio = {2: 0, 4: 2047, 35: 4095, 34: 0}
    a1 = E.entradaAnalogica(1)
    a2 = E.entradaAnalogica(2)
    a3 = E.entradaAnalogica(3)
    a4 = E.entradaAnalogica(4)
    assert 0 <= a1 <= 100 and 0 <= a2 <= 100 and 0 <= a3 <= 100 and 0 <= a4 <= 100
    assert a3 == 100
    assert a4 == 0

    # ADC1 (GPIO35) usable aunque Wi-Fi esté conectado
    wlan = FakeWLAN()
    wlan._active = True
    wlan._connected = True
    # Monkey: next WLAN() returns same connected instance
    class WLANConnected(FakeWLAN):
        def __init__(self, *_a):
            self._active = True
            self._connected = True
            FakeWLAN.instances.append(self)

    sys.modules["network"].WLAN = WLANConnected
    # Force recreate ADC path for gpio 35 after wifi
    E._invalidate_adc()
    FakeADC.raw_by_gpio[35] = 2048
    assert E.entradaAnalogica(3) == 2048 * 100 // 4095

    # ADC2 + Wi-Fi connected → conflicto explícito
    conflict = False
    try:
        E.entradaAnalogica(1)
    except RuntimeError as e:
        conflict = "EDA6_ADC2_WIFI_CONFLICT" in str(e)
    assert conflict

    conflict2 = False
    try:
        E.entradaAnalogica(2)
    except RuntimeError as e:
        conflict2 = "EDA6_ADC2_WIFI_CONFLICT" in str(e)
    assert conflict2

    # ADC2 + Wi-Fi active but not connected → disable and read
    class WLANActiveOnly(FakeWLAN):
        def __init__(self, *_a):
            self._active = True
            self._connected = False
            FakeWLAN.instances.append(self)

    sys.modules["network"].WLAN = WLANActiveOnly
    E._invalidate_adc()
    FakeADC.raw_by_gpio[2] = 0
    assert E.entradaAnalogica(1) == 0
    assert any(not w._active for w in FakeWLAN.instances)

    # sensorDistancia invalida ADC cache; siguiente lectura recrea
    sys.modules["network"].WLAN = FakeWLAN
    E._invalidate_adc()
    FakeADC.raw_by_gpio[2] = 100
    _ = E.entradaAnalogica(1)
    cached = len(FakeADC.instances)
    E.sensorDistancia(1)
    FakeADC.raw_by_gpio[2] = 200
    _ = E.entradaAnalogica(1)
    assert len(FakeADC.instances) > cached

    # Run/Stop/Run: cleanup limpia cache
    E.detenerTodo()
    assert E._adc_cache == {}
    FakeADC.raw_by_gpio[35] = 4095
    assert E.entradaAnalogica(3) == 100
    E._pybot_cleanup_normal()
    assert E._adc_cache == {}

    print(json.dumps({"ok": True, "version": E.EDA6_VERSION, "dig": dig, "a3": a3}))


if __name__ == "__main__":
    main()
