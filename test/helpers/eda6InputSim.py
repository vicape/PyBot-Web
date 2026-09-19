"""Simula EDA6 entradas digitales/analógicas sin placa (fake machine).
Verifica semántica original: PULL_DOWN, ADC preinit, /4050, perfil, sin EDA6_VERSION.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path


class FakePin:
    IN = 0
    OUT = 1
    PULL_DOWN = 2
    PULL_UP = 3
    values = {}  # gpio -> level

    def __init__(self, gpio, mode=None, pull=None):
        self.gpio = int(gpio)
        self.mode = mode
        self.pull = pull
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
    fail_gpio = None

    def __init__(self, pin):
        self.gpio = pin.gpio
        self.atten_set = None
        FakeADC.instances.append(self)

    def atten(self, a):
        self.atten_set = a
        return None

    def width(self, *_a):
        return None

    def read(self):
        if FakeADC.fail_gpio is not None and self.gpio == FakeADC.fail_gpio:
            raise OSError("adc_fail")
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
    FakeADC.fail_gpio = None

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
    mod = types.ModuleType("EDA6")
    mod.__file__ = str(path)
    code = path.read_text(encoding="utf-8")
    exec(compile(code, str(path), "exec"), mod.__dict__)
    sys.modules["EDA6"] = mod
    return mod


def main():
    eda6_path = Path(sys.argv[1])
    install_mocks()
    E = load_eda6(eda6_path)

    assert not hasattr(E, "EDA6_VERSION")
    assert list(E.PIN_MAPS["WEMOS"]["digital_inputs"]) == [5, 23, 19, 18]
    assert list(E.PIN_MAPS["WEMOS"]["adc_inputs"]) == [2, 4, 35, 34]
    assert list(E.PIN_MAPS["WEMOS"]["digital_outputs"]) == [26, 17, 27, 12]
    assert list(E.PIN_MAPS["WEMOS"]["servo_pins"]) == [25, 16, 14, 13]
    assert list(E.PIN_MAPS["ESP32"]["digital_inputs"]) == [4, 2, 15, 0]
    assert list(E.PIN_MAPS["ESP32"]["adc_inputs"]) == [35, 34, 39, 36]
    assert list(E.PIN_MAPS["ESP32"]["digital_outputs"]) == [32, 25, 27, 12]
    assert list(E.PIN_MAPS["ESP32"]["servo_pins"]) == [33, 26, 14, 13]

    # DIGITAL: preinicializados WEMOS E1..E4 -> [5,23,19,18], IN+PULL_DOWN
    assert E.PLACA_ACTUAL == "WEMOS"
    dig_pins = list(E._digital_inputs)
    assert [p.gpio for p in dig_pins] == [5, 23, 19, 18]
    assert all(p.mode == FakePin.IN for p in dig_pins)
    assert all(p.pull == FakePin.PULL_DOWN for p in dig_pins)
    assert all(p.pull != FakePin.PULL_UP for p in dig_pins)

    created_before = len(FakePin.created)
    FakePin.values = {5: 1, 23: 0, 19: 1, 18: 0}
    dig = [E.entradaDigital(n) for n in range(1, 5)]
    assert dig == [1, 0, 1, 0]
    # No crea Pin nuevos en cada lectura
    assert len(FakePin.created) == created_before
    assert E.entradaDigital(0) is None
    assert E.entradaDigital(5) is None

    # ANALÓGICO: ADC preinicializado, ATTN_11DB, /4050
    assert [a.gpio for a in E._adc_inputs] == [2, 4, 35, 34]
    assert all(a.atten_set == FakeADC.ATTN_11DB for a in E._adc_inputs)
    FakeADC.raw_by_gpio = {2: 0, 4: 2025, 35: 4095, 34: 0}
    a1 = E.entradaAnalogica(1)
    a2 = E.entradaAnalogica(2)
    a3 = E.entradaAnalogica(3)
    a4 = E.entradaAnalogica(4)
    assert a1 == 0
    assert a2 == int((2025 / 4050) * 100)
    assert a3 == 100  # clamp >100
    assert a4 == 0

    # E1 WEMOS usa interpolación (punto de cal 120 -> 429)
    FakeADC.raw_by_gpio[2] = 120
    a1_cal = E.entradaAnalogica(1)
    assert a1_cal == int((429 / 4050) * 100)

    FakeADC.fail_gpio = 35
    assert E.entradaAnalogica(3) == -1
    FakeADC.fail_gpio = None
    assert E.entradaAnalogica(0) is None
    assert E.entradaAnalogica(9) is None

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

    # Run -> Stop -> Run
    E._pybot_cleanup_normal()
    assert 25 in E._pwm_cache
    assert 16 not in E._pwm_cache
    E.detenerTodo()
    assert E._pwm_cache == {}
    FakeADC.raw_by_gpio[35] = 4095
    assert E.entradaAnalogica(3) == 100
    E.servomotor(1, 45)
    E._pybot_cleanup_normal()
    assert 25 in E._pwm_cache
    run_stop_run_ok = True

    # PERFIL: cambio no deja hardware del perfil anterior
    wemos_dig_ids = [id(p) for p in E._digital_inputs]
    wemos_adc_ids = [id(a) for a in E._adc_inputs]
    E._aplicar_placa("ESP32")
    assert E.PLACA_ACTUAL == "ESP32"
    assert [p.gpio for p in E._digital_inputs] == [4, 2, 15, 0]
    assert [a.gpio for a in E._adc_inputs] == [35, 34, 39, 36]
    assert [p.gpio for p in E._digital_outputs] == [32, 25, 27, 12]
    assert all(p.pull == FakePin.PULL_DOWN for p in E._digital_inputs)
    assert [id(p) for p in E._digital_inputs] != wemos_dig_ids
    assert [id(a) for a in E._adc_inputs] != wemos_adc_ids
    FakePin.values = {4: 1, 2: 0, 15: 1, 0: 0}
    assert [E.entradaDigital(n) for n in range(1, 5)] == [1, 0, 1, 0]
    E._aplicar_placa("WEMOS")
    assert E.PLACA_ACTUAL == "WEMOS"
    assert [p.gpio for p in E._digital_inputs] == [5, 23, 19, 18]
    profile_ok = True

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
                "a1Cal": a1_cal,
                "servoOk": servo_ok,
                "motorOk": motor_ok,
                "runStopRunOk": run_stop_run_ok,
                "profileOk": profile_ok,
                "pullDown": True,
                "attn": True,
            }
        )
    )


if __name__ == "__main__":
    main()
