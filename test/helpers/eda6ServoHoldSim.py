"""Simula EDA6 + wrap educativo sin placa: PWM mock de machine."""
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

    def __init__(self, gpio, mode=None):
        self.gpio = int(gpio)
        self._value = 0

    def value(self, v=None):
        if v is None:
            return self._value
        self._value = 1 if v else 0


class FakePWM:
    instances = []

    def __init__(self, pin):
        self.gpio = pin.gpio
        self._freq = 0
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

    def atten(self, *_a):
        return None

    def width(self, *_a):
        return None

    def read(self):
        return 0

    def read_u16(self):
        return 0


def install_mocks():
    FakePWM.instances = []
    machine = types.ModuleType("machine")
    machine.Pin = FakePin
    machine.PWM = FakePWM
    machine.ADC = FakeADC
    sys.modules["machine"] = machine
    t = types.ModuleType("time")
    t.sleep = lambda *_a, **_k: None
    t.sleep_ms = lambda *_a, **_k: None
    t.sleep_us = lambda *_a, **_k: None
    t.ticks_us = lambda: 0
    t.ticks_diff = lambda a, b: a - b
    sys.modules["time"] = t
    return machine


WRAP = """
try:
    detenerTodo()
except Exception:
    pass
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

    # 1) Fin normal servomotor(1, 90): PWM GPIO 25 activo.
    install_mocks()
    ns = {"__name__": "__main__"}
    load_eda6(eda6_path, ns, "WEMOS")
    run_wrapped(ns, "servomotor(1, 90)")
    p = pwm_for(25)
    results["normal_hold"] = {
        "gpio": 25 if p else None,
        "alive": bool(p and p.alive),
        "duty": None if p is None else p._duty,
        "freq": None if p is None else p._freq,
        "expected_duty": expected_duty(90),
        "role": ns.get("_pwm_role", {}).get(25),
        "in_cache": 25 in ns.get("_pwm_cache", {}),
    }

    # 2) Nueva ejecución con otro ángulo sobre el mismo namespace (USB persistente).
    run_wrapped(ns, "servomotor(1, 0)")
    p2 = pwm_for(25)
    results["second_angle"] = {
        "alive": bool(p2 and p2.alive),
        "duty": None if p2 is None else p2._duty,
        "expected_duty": expected_duty(0),
        "same_instance": p2 is p,
    }

    # 3) Stop / detenerTodo tras fin normal.
    ns["detenerTodo"]()
    results["stop_after_idle"] = {
        "alive": bool(p2 and p2.alive),
        "cache_empty": len(ns.get("_pwm_cache", {})) == 0,
        "role_empty": len(ns.get("_pwm_role", {})) == 0,
    }

    # 4) Error: limpieza completa.
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
        "cache_empty": len(ns_err.get("_pwm_cache", {})) == 0,
    }

    # 5) motorRC no queda activo por la excepción de servos posicionales.
    install_mocks()
    ns_m = {"__name__": "__main__"}
    load_eda6(eda6_path, ns_m, "WEMOS")
    run_wrapped(ns_m, "motorRC(1, 50)")
    p_m = pwm_for(25)
    results["motor_rc"] = {
        "alive": bool(p_m and p_m.alive),
        "role_after": ns_m.get("_pwm_role", {}).get(25),
        "in_cache": 25 in ns_m.get("_pwm_cache", {}),
    }

    # Servo + motorRC en el mismo puerto: gana motorRC, no se conserva.
    install_mocks()
    ns_mix = {"__name__": "__main__"}
    load_eda6(eda6_path, ns_mix, "WEMOS")
    run_wrapped(ns_mix, "servomotor(1, 90)\nmotorRC(1, 40)")
    p_mix = pwm_for(25)
    results["servo_then_motor"] = {
        "alive": bool(p_mix and p_mix.alive),
        "in_cache": 25 in ns_mix.get("_pwm_cache", {}),
    }

    # 6) Módulo EDA6 quedó ESP32; el prelude aplica WEMOS → servo 1 = GPIO 25.
    install_mocks()
    mod = types.ModuleType("EDA6")
    load_eda6(eda6_path, mod.__dict__, "ESP32")
    sys.modules["EDA6"] = mod
    assert mod.PLACA_ACTUAL == "ESP32"
    assert mod._pins()["servo_pins"][0] == 33
    star_ns = {}
    exec("from EDA6 import *", star_ns)
    pins_imported = "_pins" in star_ns
    mod.PLACA_ACTUAL = "WEMOS"
    gpio = mod._pins()["servo_pins"][0]
    star_ns["servomotor"] = mod.servomotor
    star_ns["_pybot_cleanup_normal"] = mod._pybot_cleanup_normal
    star_ns["detenerTodo"] = mod.detenerTodo
    run_wrapped(star_ns, "servomotor(1, 90)")
    p_ble = pwm_for(25)
    results["ble_profile"] = {
        "pins_imported_by_star": pins_imported,
        "module_gpio": gpio,
        "alive": bool(p_ble and p_ble.alive),
        "duty": None if p_ble is None else p_ble._duty,
        "student_placa_unchanged": star_ns.get("PLACA_ACTUAL") == "ESP32",
    }

    ok = (
        results["normal_hold"]["alive"]
        and results["normal_hold"]["duty"] == results["normal_hold"]["expected_duty"]
        and results["normal_hold"]["freq"] == 50
        and results["normal_hold"]["in_cache"]
        and results["second_angle"]["alive"]
        and results["second_angle"]["duty"] == results["second_angle"]["expected_duty"]
        and results["stop_after_idle"]["alive"] is False
        and results["stop_after_idle"]["cache_empty"]
        and results["on_error"]["raised"]
        and results["on_error"]["alive"] is False
        and results["motor_rc"]["alive"] is False
        and results["motor_rc"]["in_cache"] is False
        and results["servo_then_motor"]["alive"] is False
        and results["ble_profile"]["pins_imported_by_star"] is False
        and results["ble_profile"]["module_gpio"] == 25
        and results["ble_profile"]["alive"]
        and results["ble_profile"]["student_placa_unchanged"]
    )
    print(json.dumps({"ok": ok, **results}, sort_keys=True))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
