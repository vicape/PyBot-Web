/**
 * Prelude USB para una ESP32 MicroPython GENÉRICA (sin runtime PyBot en placa).
 * BLE Native usa `from pybot_mpy import *` (firmware/pybot-ble-runtime/pybot_mpy.py).
 */

export const MPY_PRELUDE = `import machine, time

def wait(seconds):
    time.sleep(seconds)

_pwm_cache = {}
_pwm_freq = {}
_adc_cache = {}
_out_pins = {}

def _pwm(gpio, freq):
    p = _pwm_cache.get(gpio)
    if p is not None and _pwm_freq.get(gpio) == freq:
        return p
    if p is not None:
        try:
            p.deinit()
        except Exception:
            pass
    p = machine.PWM(machine.Pin(gpio))
    try:
        p.freq(freq)
    except Exception:
        pass
    _pwm_cache[gpio] = p
    _pwm_freq[gpio] = freq
    return p

def _set_duty(p, value):
    v = int(value)
    if v < 0:
        v = 0
    if v > 255:
        v = 255
    duty = v * 65535 // 255
    try:
        p.duty_u16(duty)
    except Exception:
        p.duty(duty * 1023 // 65535)

def _set_pulse_us(p, pulse_us):
    duty = int(pulse_us) * 65535 // 20000
    try:
        p.duty_u16(duty)
    except Exception:
        p.duty(duty * 1023 // 65535)

def _is_adc(gpio):
    return gpio in (32, 33, 34, 35, 36, 37, 38, 39)

def _read_analog(gpio):
    a = _adc_cache.get(gpio)
    if a is None:
        a = machine.ADC(machine.Pin(gpio))
        try:
            a.atten(machine.ADC.ATTN_11DB)
        except Exception:
            pass
        try:
            a.width(machine.ADC.WIDTH_12BIT)
        except Exception:
            pass
        _adc_cache[gpio] = a
    try:
        raw = a.read()
    except Exception:
        raw = a.read_u16() * 4095 // 65535
    return int(raw) * 1023 // 4095

def _gpio(value):
    if isinstance(value, str):
        raise ValueError("ESP32_GPIO_ONLY")
    return int(value)

def _read(gpio):
    if _is_adc(gpio):
        return _read_analog(gpio)
    return machine.Pin(gpio, machine.Pin.IN).value()

def _write(gpio, value):
    v = int(value)
    if v > 1:
        _set_duty(_pwm(gpio, 1000), v)
    else:
        p = _out_pins.get(gpio)
        if p is None:
            p = machine.Pin(gpio, machine.Pin.OUT)
            _out_pins[gpio] = p
        p.value(1 if v == 1 else 0)

def _pybot_cleanup():
    for gpio in list(_pwm_cache.keys()):
        p = _pwm_cache.get(gpio)
        try:
            p.duty_u16(0)
        except Exception:
            try:
                p.duty(0)
            except Exception:
                pass
        try:
            p.deinit()
        except Exception:
            pass
    _pwm_cache.clear()
    _pwm_freq.clear()
    for gpio in list(_out_pins.keys()):
        p = _out_pins.get(gpio)
        try:
            p.value(0)
        except Exception:
            pass

def pin(*args):
    if len(args) == 0:
        raise ValueError("pin: faltan argumentos")
    first = args[0]
    if isinstance(first, str) and first.lower() in ("in", "out", "pwm"):
        mode = first.lower()
        if len(args) < 2:
            raise ValueError("pin: falta el numero de GPIO")
        gpio = _gpio(args[1])
        value = args[2] if len(args) >= 3 else None
        if mode == "in":
            return _read(gpio)
        if mode == "pwm":
            _set_duty(_pwm(gpio, 1000), 0 if value is None else value)
            return None
        _write(gpio, 0 if value is None else value)
        return None
    gpio = _gpio(first)
    if len(args) == 1:
        return _read(gpio)
    _write(gpio, args[1])
    return None

def _servo_pulse(gpio, angle):
    a = int(angle)
    if a < 0:
        a = 0
    if a > 180:
        a = 180
    pulse = 500 + a * 2000 // 180
    _set_pulse_us(_pwm(gpio, 50), pulse)

def servo(pin, angle, angle_end=None, speed=5):
    gpio = _gpio(pin)
    if angle_end is None:
        _servo_pulse(gpio, angle)
        return
    a = int(angle)
    ae = int(angle_end)
    spd = max(1, min(10, int(speed)))
    step = 1 if ae >= a else -1
    delay = 0.05 / (spd / 5)
    x = a
    while True:
        _servo_pulse(gpio, x)
        time.sleep(delay)
        if x == ae:
            break
        x += step

def motor(pin, speed=0):
    gpio = _gpio(pin)
    s = int(speed)
    if s < -100:
        s = -100
    if s > 100:
        s = 100
    _servo_pulse(gpio, 90 + s * 90 // 100)

try:
    from pybot_net import (
        wifi_conectar, wifi_desconectar, wifi_conectado, wifi_ip,
        wifi_estado, wifi_signal, web_get, web_post,
    )
except ImportError:
    pass
`;
