"""Simula EDA6 entradas digitales/analógicas sin placa (fake machine).
Cubre API pública original sin EDA6_VERSION / sin lógica 1.1.x.
"""
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
    instances = []

    def __init__(self, pin):
        self.gpio = pin.gpio
        FakeADC.instances.append(self)

    def atten(self, *_a):
        return None

    def width(self, *_a):
        return None

    def read(self):
        return int(FakeADC.raw_by_gpio.get(self.gpio, 0))

    def read_u16(self):
        return self.read() * 65535 // 4095


class FakePWM:
    def __init__(self, pin):
        self.gpio = pin.gpio
        self._duty = None

    def freq(self, *_a):
        return 50

    def duty(self, v=None):
        if v is not None:
            self._duty = v
        return self._duty

    def duty_u16(self, v=None):
        if v is not None:
            self._duty = v
        return self._duty

    def deinit(self):
        return None


def install_mocks():
    FakePin.created = []
    FakePin.values = {}
    FakeADC.instances = []
    FakeADC.raw_by_gpio = {}

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
    return machine


def load_eda6(path: Path):
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

    assert not hasattr(E, "EDA6_VERSION")
    assert list(E.PIN_MAPS["WEMOS"]["digital_inputs"]) == [5, 23, 19, 18]
    assert list(E.PIN_MAPS["WEMOS"]["adc_inputs"]) == [2, 4, 35, 34]
    assert list(E.PIN_MAPS["WEMOS"]["digital_outputs"]) == [26, 17, 27, 12]
    assert list(E.PIN_MAPS["WEMOS"]["servo_pins"]) == [25, 16, 14, 13]
    assert list(E.PIN_MAPS["ESP32"]["digital_inputs"]) == [4, 2, 15, 0]
    assert list(E.PIN_MAPS["ESP32"]["adc_inputs"]) == [35, 34, 39, 36]
    assert list(E.PIN_MAPS["ESP32"]["digital_outputs"]) == [32, 25, 27, 12]
    assert list(E.PIN_MAPS["ESP32"]["servo_pins"]) == [33, 26, 14, 13]

    # Digital 1..4
    FakePin.values = {5: 1, 23: 0, 19: 1, 18: 0}
    dig = [E.entradaDigital(n) for n in range(1, 5)]
    assert dig == [1, 0, 1, 0]
    used = [p.gpio for p in FakePin.created[-4:]]
    assert used == [5, 23, 19, 18]

    # Analog 1..4
    FakeADC.raw_by_gpio = {2: 0, 4: 2047, 35: 4095, 34: 0}
    a1 = E.entradaAnalogica(1)
    a2 = E.entradaAnalogica(2)
    a3 = E.entradaAnalogica(3)
    a4 = E.entradaAnalogica(4)
    assert 0 <= a1 <= 100 and 0 <= a2 <= 100 and 0 <= a3 <= 100 and 0 <= a4 <= 100
    assert a3 == 100
    assert a4 == 0

    # salida + entrada digital
    E.salidaDigital(1, 1)
    assert FakePin.values.get(26) == 1
    FakePin.values[5] = 1
    assert E.entradaDigital(1) == 1

    # servo / motorRC sin regresión
    E.servomotor(1, 90)
    assert 25 in E._pwm_cache
    assert E._pwm_role.get(25) == "servo"
    E.motorRC(2, 50)
    assert 16 in E._pwm_cache
    assert E._pwm_role.get(16) == "motor"
    servo_ok = True
    motor_ok = True

    # Run -> Stop -> Run: cleanup normal conserva servo; detenerTodo limpia
    E._pybot_cleanup_normal()
    assert 25 in E._pwm_cache  # servo positional retained
    assert 16 not in E._pwm_cache  # motor cleared
    E.detenerTodo()
    assert E._pwm_cache == {}
    FakeADC.raw_by_gpio[35] = 4095
    assert E.entradaAnalogica(3) == 100
    E.servomotor(1, 45)
    E._pybot_cleanup_normal()
    assert 25 in E._pwm_cache
    run_stop_run_ok = True

    # star-import style: public names exist
    for name in (
        "entradaDigital",
        "entradaAnalogica",
        "salidaDigital",
        "servomotor",
        "motorRC",
        "sensorDistancia",
        "detenerTodo",
    ):
        assert hasattr(E, name)

    print(
        json.dumps(
            {
                "ok": True,
                "hasVersion": hasattr(E, "EDA6_VERSION"),
                "dig": dig,
                "a3": a3,
                "servoOk": servo_ok,
                "motorOk": motor_ok,
                "runStopRunOk": run_stop_run_ok,
            }
        )
    )


if __name__ == "__main__":
    main()
