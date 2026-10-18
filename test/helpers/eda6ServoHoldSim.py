"""Simula EDA6 vendor + wrap educativo: PWM mock; hold vía reimport tras Stop."""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path


def _map_val(value, in_min, in_max, out_min, out_max):
    if in_max == in_min:
        return out_min
    return int((value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)


class FakePin:
    IN = 0
    OUT = 1
    PULL_DOWN = 2
    PULL_UP = 3

    def __init__(self, gpio, mode=None, pull=None):
        self.gpio = int(gpio)
        self.mode = mode
        self.pull = pull
        self._value = 0

    def value(self, v=None):
        if v is None:
            return self._value
        self._value = 1 if v else 0


class FakePWM:
    instances = []

    def __init__(self, pin, freq=50):
        self.gpio = pin.gpio
        self._freq = int(freq) if freq is not None else 50
        self._duty = 0
        self.alive = True
        FakePWM.instances.append(self)

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = int(f)
        return None

    def duty(self, d=None):
        if d is None:
            return self._duty
        self._duty = int(d)
        return None

    def duty_u16(self, d=None):
        if d is None:
            return self._duty * 65535 // 1023
        self._duty = int(d) * 1023 // 65535
        return None

    def deinit(self):
        self.alive = False


class FakeADC:
    ATTN_11DB = 0
    WIDTH_12BIT = 0

    def __init__(self, pin):
        self.gpio = pin.gpio
        self.atten_set = None

    def atten(self, a):
        self.atten_set = a
        return None

    def width(self, *_a):
        return None

    def read(self):
        return 0

    def read_u16(self):
        return 0


class FakeI2C:
    def __init__(self, *_a, **_k):
        pass

    def scan(self):
        return []

    def writeto(self, *_a, **_k):
        return None


def install_mocks():
    FakePWM.instances = []
    machine = types.ModuleType("machine")
    machine.Pin = FakePin
    machine.PWM = FakePWM
    machine.ADC = FakeADC
    machine.I2C = FakeI2C
    machine.time_pulse_us = lambda *_a, **_k: -1
    sys.modules["machine"] = machine
    t = types.ModuleType("time")
    t.sleep = lambda *_a, **_k: None
    t.sleep_ms = lambda *_a, **_k: None
    t.sleep_us = lambda *_a, **_k: None
    t.ticks_us = lambda: 0
    t.ticks_diff = lambda a, b: a - b
    sys.modules["time"] = t
    sys.modules["utime"] = t
    return machine


# Mirrors programWrap: missing _pybot_cleanup_normal → detenerTodo (vendor).
WRAP = """
try:
    _pybot_cleanup()
except Exception:
    pass
def __pybot_main():
{body}
_pybot_ok = False
try:
    __pybot_main()
    _pybot_ok = True
finally:
    if _pybot_ok:
        try:
            _pybot_cleanup_normal()
        except Exception:
            try:
                detenerTodo()
            except Exception:
                pass
            try:
                _pybot_cleanup()
            except Exception:
                pass
    else:
        try:
            detenerTodo()
        except Exception:
            pass
        try:
            _pybot_cleanup()
        except Exception:
            pass
"""


def load_eda6(path, ns, placa="WEMOS"):
    src = Path(path).read_text(encoding="utf-8")
    src = src.replace('PLACA_ACTUAL = "WEMOS"', 'PLACA_ACTUAL = "%s"' % placa, 1)
    src = src.replace('PLACA_ACTUAL = "ESP32"', 'PLACA_ACTUAL = "%s"' % placa, 1)
    exec(compile(src, str(path), "exec"), ns)
    return ns


def run_wrapped(ns, user_code):
    body = "\n".join("    " + line if line else line for line in user_code.split("\n"))
    exec(compile(WRAP.format(body=body or "    pass"), "<wrap>", "exec"), ns)


def pwm_for(gpio):
    found = [p for p in FakePWM.instances if p.gpio == gpio]
    return found[-1] if found else None


def expected_duty(angle):
    a = max(0, min(180, int(angle)))
    return _map_val(a, 0, 180, 31, 120)


def main():
    eda6_path = sys.argv[1]
    results = {}

    # 1) Fin normal: vendor no conserva PWM; wrap cae a detenerTodo.
    install_mocks()
    ns = {"__name__": "__main__"}
    load_eda6(eda6_path, ns, "WEMOS")
    run_wrapped(ns, "servomotor(1, 90)")
    p = pwm_for(25)
    results["normal_end"] = {
        "gpio": 25 if p else None,
        "alive_after_cleanup": bool(p and p.alive),
        "duty_before_was_set": expected_duty(90),
    }

    # 2) Reimport tras Stop: nuevo PWM usable (contrato vendor / eda6Lifecycle).
    install_mocks()
    ns2 = {"__name__": "__main__"}
    load_eda6(eda6_path, ns2, "WEMOS")
    run_wrapped(ns2, "servomotor(1, 0)")
    # Mid-run state is cleaned by wrap; reimport again to prove PWM recreation.
    install_mocks()
    ns3 = {"__name__": "__main__"}
    load_eda6(eda6_path, ns3, "WEMOS")
    ns3["servomotor"](1, 0)
    p2 = pwm_for(25)
    results["reimport_run"] = {
        "alive": bool(p2 and p2.alive),
        "duty": None if p2 is None else p2._duty,
        "expected_duty": expected_duty(0),
    }

    # 3) Error: limpieza completa.
    install_mocks()
    ns_err = {"__name__": "__main__"}
    load_eda6(eda6_path, ns_err, "WEMOS")
    raised = False
    try:
        run_wrapped(ns_err, "servomotor(1, 90)\nraise RuntimeError('boom')")
    except RuntimeError:
        raised = True
    p_err = pwm_for(25)
    results["on_error"] = {
        "raised": raised,
        "alive": bool(p_err and p_err.alive),
    }

    # 4) motorRC + cleanup → PWM muerto.
    install_mocks()
    ns_m = {"__name__": "__main__"}
    load_eda6(eda6_path, ns_m, "WEMOS")
    run_wrapped(ns_m, "motorRC(1, 50)")
    p_m = pwm_for(25)
    results["motor_rc"] = {
        "alive_after_cleanup": bool(p_m and p_m.alive),
    }

    # 5) Perfiles por PLACA_ACTUAL en fuente (sin _pins / _aplicar_placa).
    install_mocks()
    ns_w = {}
    load_eda6(eda6_path, ns_w, "WEMOS")
    install_mocks()
    ns_e = {}
    load_eda6(eda6_path, ns_e, "ESP32")
    star_ns = {}
    # Star-import must not expose private helpers (vendor has none anyway).
    mod = types.ModuleType("EDA6")
    mod.__dict__.update(ns_w)
    sys.modules["EDA6"] = mod
    exec("from EDA6 import *", star_ns)
    results["profile_wemos"] = {
        "servo_gpio": ns_w["PINS"]["servo_pins"][0],
        "placa": ns_w["PLACA_ACTUAL"],
    }
    results["profile_esp32"] = {
        "servo_gpio": ns_e["PINS"]["servo_pins"][0],
        "placa": ns_e["PLACA_ACTUAL"],
    }
    results["pins_imported_by_star"] = "_pins" in star_ns or "_aplicar_placa" in star_ns

    ok = (
        results["normal_end"]["gpio"] == 25
        and results["normal_end"]["alive_after_cleanup"] is False
        and results["reimport_run"]["alive"] is True
        and results["reimport_run"]["duty"] == results["reimport_run"]["expected_duty"]
        and results["on_error"]["raised"]
        and results["on_error"]["alive"] is False
        and results["motor_rc"]["alive_after_cleanup"] is False
        and results["profile_wemos"]["servo_gpio"] == 25
        and results["profile_esp32"]["servo_gpio"] == 33
        and results["pins_imported_by_star"] is False
    )
    print(json.dumps({"ok": ok, **results}, sort_keys=True))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
