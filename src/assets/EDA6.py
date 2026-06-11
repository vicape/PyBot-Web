# EDA6 — librería educativa ESP32/WEMOS (compatible Thonny)
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
import time

_pwm_cache = {}
_out_pins = {}
_adc_cache = {}
_lcd = None
_lcd_ready = False
_lcd_available = None


def _map_val(value, in_min, in_max, out_min, out_max):
    if in_max == in_min:
        return out_min
    return int((value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)


def _pins():
    return PIN_MAPS[PLACA_ACTUAL]


def _check_port(n):
    if n < 1 or n > 4:
        raise ValueError("EDA6_PORT_RANGE")


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
    p = machine.PWM(machine.Pin(gpio))
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


def _adc_read(gpio):
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
        return int(a.read())
    except Exception:
        return int(a.read_u16()) * 4095 // 65535


def _raw_to_percent(gpio, raw):
    if PLACA_ACTUAL == "WEMOS" and gpio == 2:
        leido = CAL_LEIDO_PIN2_RAW
        real = CAL_REAL_PIN2_RAW
        if raw <= leido[0]:
            pct_raw = 0
        elif raw >= leido[-1]:
            pct_raw = real[-1]
        else:
            pct_raw = raw
            for i in range(len(leido) - 1):
                if leido[i] <= raw <= leido[i + 1]:
                    pct_raw = _map_val(raw, leido[i], leido[i + 1], real[i], real[i + 1])
                    break
        return max(0, min(100, pct_raw * 100 // 4095))
    return max(0, min(100, raw * 100 // 4095))


def entradaDigital(n_entrada):
    _check_port(n_entrada)
    gpio = _pins()["digital_inputs"][n_entrada - 1]
    return machine.Pin(gpio, machine.Pin.IN).value()


def entradaAnalogica(n_entrada):
    _check_port(n_entrada)
    gpio = _pins()["adc_inputs"][n_entrada - 1]
    raw = _adc_read(gpio)
    return _raw_to_percent(gpio, raw)


def salidaDigital(n_salida, estado):
    _check_port(n_salida)
    gpio = _pins()["digital_outputs"][n_salida - 1]
    val = 1 if estado else 0
    p = _out_pins.get(gpio)
    if p is None:
        p = machine.Pin(gpio, machine.Pin.OUT)
        _out_pins[gpio] = p
    p.value(val)


def servomotor(nsalida, angulo):
    _check_port(nsalida)
    a = int(angulo)
    if a < 0:
        a = 0
    if a > 180:
        a = 180
    gpio = _pins()["servo_pins"][nsalida - 1]
    duty = _map_val(a, 0, 180, 31, 120)
    _set_pwm_duty(gpio, duty)


def motorRC(n_salida, valor):
    _check_port(n_salida)
    v = int(valor)
    if v < -100:
        v = -100
    if v > 100:
        v = 100
    gpio = _pins()["servo_pins"][n_salida - 1]
    duty = _map_val(v, -100, 100, 31, 120)
    _set_pwm_duty(gpio, duty)


def sensorDistancia(n_entrada):
    _check_port(n_entrada)
    pins = _pins()
    trig = pins["digital_inputs"][n_entrada - 1]
    echo = pins["adc_inputs"][n_entrada - 1]
    t_pin = machine.Pin(trig, machine.Pin.OUT)
    e_pin = machine.Pin(echo, machine.Pin.IN)
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


def _stop_pwm():
    for gpio, p in list(_pwm_cache.items()):
        try:
            p.deinit()
        except Exception:
            pass
    _pwm_cache.clear()


def detenerTodo():
    _stop_pwm()
    pins = _pins()
    for gpio in pins["digital_outputs"]:
        try:
            machine.Pin(gpio, machine.Pin.OUT).value(0)
        except Exception:
            pass
    _out_pins.clear()
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
    scl, sda = _pins()["I2C"]
    try:
        i2c = machine.I2C(0, scl=machine.Pin(scl), sda=machine.Pin(sda), freq=400000)
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
