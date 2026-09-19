# EDA6 — librería educativa ESP32/WEMOS (compatible Thonny)
# Semántica de entradas alineada a la fuente original (libreria-EDA6-original).
# Perfil de placa: WEMOS (default) o ESP32

PLACA_ACTUAL = "WEMOS"

PIN_MAPS = {
    "WEMOS": {
        "digital_outputs": [26, 17, 27, 12],
        "adc_inputs": [2, 4, 35, 34],
        "digital_inputs": [5, 23, 19, 18],
        "servo_pins": [25, 16, 14, 13],
        "I2C": (22, 21),
    },
    "ESP32": {
        "digital_outputs": [32, 25, 27, 12],
        "adc_inputs": [35, 34, 39, 36],
        "digital_inputs": [4, 2, 15, 0],
        "servo_pins": [33, 26, 14, 13],
        "I2C": (22, 21),
    },
}

CAL_LEIDO_PIN2_RAW = [
    0, 120, 215, 300, 410, 570, 680, 832, 950, 1215, 1600, 2060, 4095,
]
CAL_REAL_PIN2_RAW = [
    0, 429, 900, 1315, 1825, 2300, 2550, 2815, 3000, 3300, 3600, 3940, 4095,
]

import machine
from machine import Pin, ADC, PWM
import time

PINS = PIN_MAPS[PLACA_ACTUAL]

try:
    _pwm_cache
except NameError:
    _pwm_cache = {}
try:
    _pwm_role
except NameError:
    _pwm_role = {}

_digital_outputs = []
_digital_inputs = []
_adc_inputs = []
_lcd = None
_lcd_ready = False
_lcd_available = None


def _map_val(value, in_min, in_max, out_min, out_max):
    if in_max == in_min:
        return out_min
    return int((value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)


def _interpolar(x, x_points, y_points):
    if x <= x_points[0]:
        return y_points[0]
    if x >= x_points[-1]:
        return y_points[-1]
    for i in range(len(x_points) - 1):
        if x_points[i] <= x <= x_points[i + 1]:
            x0, x1 = x_points[i], x_points[i + 1]
            y0, y1 = y_points[i], y_points[i + 1]
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return y_points[-1]


def _pins():
    return PINS


def _check_port(n):
    if n < 1 or n > 4:
        raise ValueError("EDA6_PORT_RANGE")


def _init_io():
    """Crea Pin/ADC del perfil actual exactamente como la EDA6 original."""
    global _digital_outputs, _digital_inputs, _adc_inputs
    _digital_outputs = [Pin(p, Pin.OUT) for p in PINS["digital_outputs"]]
    _digital_inputs = [Pin(p, Pin.IN, Pin.PULL_DOWN) for p in PINS["digital_inputs"]]
    _adc_inputs = []
    for p in PINS["adc_inputs"]:
        adc = ADC(Pin(p))
        adc.atten(ADC.ATTN_11DB)
        _adc_inputs.append(adc)


def _aplicar_placa(placa):
    """Reinicializa I/O al perfil WEMOS/ESP32 (selector PyBot). No cambia PIN_MAPS."""
    global PLACA_ACTUAL, PINS, _lcd, _lcd_ready, _lcd_available
    nombre = "ESP32" if placa == "ESP32" else "WEMOS"
    if (
        nombre == PLACA_ACTUAL
        and _digital_inputs
        and len(_digital_inputs) == 4
        and _adc_inputs
        and len(_adc_inputs) == 4
        and _digital_outputs
        and len(_digital_outputs) == 4
    ):
        return
    try:
        _stop_pwm(False)
    except Exception:
        pass
    PLACA_ACTUAL = nombre
    PINS = PIN_MAPS[PLACA_ACTUAL]
    _lcd = None
    _lcd_ready = False
    _lcd_available = None
    _init_io()


_init_io()


def _pwm(gpio, freq=50):
    p = _pwm_cache.get(gpio)
    if p is not None:
        try:
            if p.freq() != freq:
                p.freq(freq)
        except Exception:
            try:
                p.freq(freq)
            except Exception:
                pass
        return p
    p = PWM(Pin(gpio))
    try:
        p.freq(freq)
    except Exception:
        pass
    _pwm_cache[gpio] = p
    return p


def _set_pwm_duty(gpio, duty_val):
    # EDA6: duty 31-120 en escala MicroPython (0-1023), igual que Thonny.
    d = int(duty_val)
    if d < 0:
        d = 0
    if d > 1023:
        d = 1023
    p = _pwm(gpio, 50)
    try:
        p.duty(d)
    except Exception:
        try:
            p.duty_u16(d * 65535 // 1023)
        except Exception:
            p.duty_u16(d * 65535 // 255)


def entradaDigital(n_entrada):
    if 1 <= n_entrada <= 4:
        return _digital_inputs[n_entrada - 1].value()
    print(f"Error: entradaDigital número {n_entrada} fuera de rango (1-4).")
    return None


def entradaAnalogica(n_entrada):
    if not (1 <= n_entrada <= 4):
        print(f"Error: entradaAnalogica número {n_entrada} fuera de rango (1-4).")
        return None
    porcentaje = 0.0
    try:
        if PLACA_ACTUAL == "WEMOS" and n_entrada == 1:
            valor_leido_raw = _adc_inputs[n_entrada - 1].read()
            valor_corregido_raw = _interpolar(
                valor_leido_raw,
                CAL_LEIDO_PIN2_RAW,
                CAL_REAL_PIN2_RAW,
            )
            porcentaje = (valor_corregido_raw / 4050) * 100
        else:
            valor_leido_raw = _adc_inputs[n_entrada - 1].read()
            porcentaje = (valor_leido_raw / 4050) * 100
    except Exception as e:
        print(f"Error en ADC (Pin {PINS['adc_inputs'][n_entrada - 1]}): {e}.")
        return -1

    if porcentaje > 100:
        return 100
    elif porcentaje < 0:
        return 0
    else:
        return int(porcentaje)


def salidaDigital(n_salida, estado):
    _check_port(n_salida)
    val = 1 if estado else 0
    _digital_outputs[n_salida - 1].value(val)


def servomotor(nsalida, angulo):
    _check_port(nsalida)
    a = int(angulo)
    if a < 0:
        a = 0
    if a > 180:
        a = 180
    gpio = PINS["servo_pins"][nsalida - 1]
    duty = _map_val(a, 0, 180, 31, 120)
    _set_pwm_duty(gpio, duty)
    _pwm_role[gpio] = "servo"


def motorRC(n_salida, valor):
    _check_port(n_salida)
    v = int(valor)
    if v < -100:
        v = -100
    if v > 100:
        v = 100
    gpio = PINS["servo_pins"][n_salida - 1]
    duty = _map_val(v, -100, 100, 31, 120)
    _set_pwm_duty(gpio, duty)
    _pwm_role[gpio] = "motor"


def sensorDistancia(n_entrada):
    _check_port(n_entrada)
    trig = PINS["digital_inputs"][n_entrada - 1]
    echo = PINS["adc_inputs"][n_entrada - 1]
    t_pin = Pin(trig, Pin.OUT)
    e_pin = Pin(echo, Pin.IN)
    t_pin.value(0)
    time.sleep_us(2)
    t_pin.value(1)
    time.sleep_us(10)
    t_pin.value(0)
    timeout = time.ticks_us() + 30000
    while e_pin.value() == 0:
        if time.ticks_diff(timeout, time.ticks_us()) <= 0:
            return -1
    start = time.ticks_us()
    timeout = time.ticks_us() + 30000
    while e_pin.value() == 1:
        if time.ticks_diff(timeout, time.ticks_us()) <= 0:
            return -1
    elapsed = time.ticks_diff(time.ticks_us(), start)
    return round(elapsed * 0.034 / 2, 1)


def _stop_pwm(keep_positional=False):
    for gpio, p in list(_pwm_cache.items()):
        if keep_positional and _pwm_role.get(gpio) == "servo":
            continue
        try:
            p.deinit()
        except Exception:
            pass
        try:
            del _pwm_cache[gpio]
        except Exception:
            pass
        _pwm_role.pop(gpio, None)
    if not keep_positional:
        _pwm_cache.clear()
        _pwm_role.clear()


def _clear_digital_outputs():
    for p in _digital_outputs:
        try:
            p.value(0)
        except Exception:
            pass


def _pybot_cleanup_normal():
    # Fin normal WEMOS/EDA6: apaga motorRC y salidas digitales; conserva PWM de servos.
    _stop_pwm(True)
    _clear_digital_outputs()


def detenerTodo():
    _stop_pwm(False)
    _clear_digital_outputs()
    if _lcd_available:
        try:
            limpiarLCD()
        except Exception:
            pass


class _I2cLcd:
    LCD_CMD = 0x80
    LCD_DAT = 0x40
    LCD_BL = 0x08

    def __init__(self, i2c, addr=0x27):
        self.i2c = i2c
        self.addr = addr
        self.backlight = True
        self.display = True
        self.cursor = False
        self.blink = False
        time.sleep_ms(50)
        self._write4(0x03)
        time.sleep_ms(5)
        self._write4(0x03)
        time.sleep_ms(1)
        self._write4(0x03)
        time.sleep_ms(1)
        self._write4(0x02)
        self._cmd(0x28)
        self._cmd(0x0C)
        self._cmd(0x06)
        self._cmd(0x01)
        time.sleep_ms(2)

    def _write4(self, nibble):
        data = (nibble & 0xF0) | self.LCD_BL
        self.i2c.writeto(self.addr, bytes([data, data | 0x04, data]))
        time.sleep_us(200)

    def _cmd(self, cmd):
        self._write4(cmd & 0xF0)
        self._write4((cmd << 4) & 0xF0)

    def _dat(self, dat):
        data = self.LCD_DAT | self.LCD_BL
        self._write4(dat & 0xF0)
        self._write4((dat << 4) & 0xF0)

    def _apply_display(self):
        cmd = 0x08
        if self.display:
            cmd |= 0x04
        if self.cursor:
            cmd |= 0x02
        if self.blink:
            cmd |= 0x01
        self._cmd(cmd)

    def clear(self):
        self._cmd(0x01)
        time.sleep_ms(2)

    def set_cursor(self, col, row):
        offsets = [0x00, 0x40, 0x14, 0x54]
        self._cmd(0x80 | (offsets[row] + col))

    def putstr(self, txt):
        for ch in str(txt):
            self._dat(ord(ch))


def _lcd_try_init():
    global _lcd, _lcd_ready, _lcd_available
    if _lcd_ready:
        return _lcd_available
    _lcd_ready = True
    scl, sda = PINS["I2C"]
    try:
        i2c = machine.I2C(0, scl=Pin(scl), sda=Pin(sda), freq=400000)
        addrs = i2c.scan()
        addr = None
        for candidate in (0x27, 0x3F):
            if candidate in addrs:
                addr = candidate
                break
        if addr is None:
            _lcd_available = False
            return False
        _lcd = _I2cLcd(i2c, addr)
        _lcd_available = True
        return True
    except Exception:
        _lcd_available = False
        return False


def _lcd_require():
    if not _lcd_try_init():
        raise RuntimeError("EDA6_LCD_MISSING")


def printLCD(columna, fila, txt):
    _lcd_require()
    _lcd.set_cursor(int(columna), int(fila))
    _lcd.putstr(str(txt))


def limpiarLCD():
    _lcd_require()
    _lcd.clear()


def asciiLCD(columna, fila, carac):
    _lcd_require()
    _lcd.set_cursor(int(columna), int(fila))
    ch = carac
    if isinstance(ch, str):
        ch = ch[0] if ch else " "
    _lcd._dat(ord(ch))


def luzLCD(estado):
    _lcd_require()
    _lcd.backlight = bool(estado)
    _lcd._apply_display()


def cursorLCD(estado):
    _lcd_require()
    _lcd.cursor = bool(estado)
    _lcd._apply_display()


def parpadeoLCD(estado):
    _lcd_require()
    _lcd.blink = bool(estado)
    _lcd._apply_display()


try:
    from pybot_net import (
        wifi_conectar,
        wifi_desconectar,
        wifi_conectado,
        wifi_ip,
        wifi_estado,
        wifi_signal,
        web_get,
        web_post,
    )
except ImportError:
    pass
