# -*- coding: utf-8 -*-
"""
Librería EDA6 para Robótica con MicroPython en ESP32
Compatible con placas Wemos R1 ESP32 y ESP32 38-pin.

Versión actualizada el 01/11/25

"""

import machine
import utime
from machine import Pin, PWM, ADC, I2C

# ----------------------------------------------------------------------
# --- 1. CONFIGURACIÓN DE PINES ----------------------------------------
# ----------------------------------------------------------------------

PLACA_ACTUAL = "WEMOS" 

PIN_MAPS = {
    'WEMOS': {
        'digital_outputs': [26, 17, 27, 12],
        'adc_inputs': [2, 4, 35, 34],       
        'digital_inputs': [5, 23, 19, 18],  
        'servo_pins': [25, 16, 14, 13],
        'I2C': (22, 21)
    },
    'ESP32': {
        'digital_outputs': [32, 25, 27, 12],
        'adc_inputs': [35, 34, 39, 36],     
        'digital_inputs': [4, 2, 15, 0],    
        'servo_pins': [33, 26, 14, 13],
        'I2C': (22, 21)
    }
}

try:
    PINS = PIN_MAPS[PLACA_ACTUAL]
    print(f"Librería EDA6 iniciada para placa: {PLACA_ACTUAL}")
except KeyError:
    print(f"Error: '{PLACA_ACTUAL}' no es una configuración de placa válida. Usando WEMOS por defecto.")
    PINS = PIN_MAPS['WEMOS']


# ----------------------------------------------------------------------
# --- 2. LIBRERÍA LCD I2C (INCLUIDA) -----------------------------------
# ----------------------------------------------------------------------
# --- ¡SECCIÓN REEMPLAZADA CON TU CÓDIGO FUNCIONAL! ---

class I2cLcd:
    """
    Clase para manejar un display LCD 16x2 o 20x4 a través de I2C
    con el chip PCF8574. (Versión validada por el usuario)
    """
    # Constantes del LCD
    LCD_CLEARDISPLAY = 0x01
    LCD_RETURNHOME = 0x02
    LCD_ENTRYMODESET = 0x04
    LCD_DISPLAYCONTROL = 0x08
    LCD_CURSORSHIFT = 0x10
    LCD_FUNCTIONSET = 0x20
    LCD_SETCGRAMADDR = 0x40
    LCD_SETDDRAMADDR = 0x80

    # Banderas para el modo de entrada
    LCD_ENTRYRIGHT = 0x00
    LCD_ENTRYLEFT = 0x02
    LCD_ENTRYSHIFTINCREMENT = 0x01
    LCD_ENTRYSHIFTDECREMENT = 0x00

    # Banderas para control de display
    LCD_DISPLAYON = 0x04
    LCD_DISPLAYOFF = 0x00
    LCD_CURSORON = 0x02
    LCD_CURSOROFF = 0x00
    LCD_BLINKON = 0x01
    LCD_BLINKOFF = 0x00

    # Banderas para Function Set
    LCD_8BITMODE = 0x10
    LCD_4BITMODE = 0x00
    LCD_2LINE = 0x08
    LCD_1LINE = 0x00
    LCD_5x10DOTS = 0x04
    LCD_5x8DOTS = 0x00

    # Banderas para control de luz de fondo
    LCD_BACKLIGHT = 0x08  # Pin P3
    LCD_NOBACKLIGHT = 0x00

    # Bit de Enable
    ENABLE = 0x04  # Pin P2

    def __init__(self, i2c, addr, cols, rows):
        self.i2c = i2c
        self.addr = addr
        self.cols = cols
        self.rows = rows
        self.backlight_val = self.LCD_BACKLIGHT

        # Inicialización
        utime.sleep_ms(50)  # Esperar >40ms después de VCC subir a 2.7V

        # Poner en modo 4-bit
        self.write_nibble(0x30)
        utime.sleep_ms(5)  # Esperar >4.1ms
        self.write_nibble(0x30)
        utime.sleep_ms(1)  # Esperar >100us
        self.write_nibble(0x30)
        utime.sleep_ms(1)
        self.write_nibble(0x20)  # Modo 4-bit

        # Configuración del display
        self.write_command(self.LCD_FUNCTIONSET | self.LCD_4BITMODE | self.LCD_2LINE | self.LCD_5x8DOTS)
        self.write_command(self.LCD_DISPLAYCONTROL | self.LCD_DISPLAYON | self.LCD_CURSOROFF | self.LCD_BLINKOFF)
        self.write_command(self.LCD_ENTRYMODESET | self.LCD_ENTRYLEFT | self.LCD_ENTRYSHIFTDECREMENT)
        
        self.clear()

    def write_nibble(self, nibble):
        """Escribe un nibble (4 bits) al bus I2C."""
        byte = (nibble & 0xF0) | self.backlight_val
        self.i2c.writeto(self.addr, bytearray([byte | self.ENABLE]))
        utime.sleep_us(1)
        self.i2c.writeto(self.addr, bytearray([byte & ~self.ENABLE]))
        utime.sleep_us(50)

    def write_command(self, cmd):
        """Escribe un comando al LCD."""
        # Modo RS=0 (comando)
        high_nibble = cmd & 0xF0
        low_nibble = (cmd << 4) & 0xF0

        byte = high_nibble | self.backlight_val
        self.i2c.writeto(self.addr, bytearray([byte | self.ENABLE]))
        utime.sleep_us(1)
        self.i2c.writeto(self.addr, bytearray([byte & ~self.ENABLE]))
        utime.sleep_us(1)

        byte = low_nibble | self.backlight_val
        self.i2c.writeto(self.addr, bytearray([byte | self.ENABLE]))
        utime.sleep_us(1)
        self.i2c.writeto(self.addr, bytearray([byte & ~self.ENABLE]))
        utime.sleep_us(50)

        if cmd == self.LCD_CLEARDISPLAY:
            utime.sleep_ms(2)  # El comando clear tarda más

    def write_data(self, data):
        """Escribe un dato (carácter) al LCD."""
        # Modo RS=1 (datos)
        RS_MASK = 0x01  # Pin P0
        high_nibble = data & 0xF0
        low_nibble = (data << 4) & 0xF0

        byte = high_nibble | self.backlight_val | RS_MASK
        self.i2c.writeto(self.addr, bytearray([byte | self.ENABLE]))
        utime.sleep_us(1)
        self.i2c.writeto(self.addr, bytearray([byte & ~self.ENABLE]))
        utime.sleep_us(1)

        byte = low_nibble | self.backlight_val | RS_MASK
        self.i2c.writeto(self.addr, bytearray([byte | self.ENABLE]))
        utime.sleep_us(1)
        self.i2c.writeto(self.addr, bytearray([byte & ~self.ENABLE]))
        utime.sleep_us(50)

    def clear(self):
        """Limpia la pantalla."""
        self.write_command(self.LCD_CLEARDISPLAY)

    def move_to(self, col, row):
        """Mueve el cursor a la columna y fila especificadas."""
        row_offsets = [0x00, 0x40] # Solo para LCD 2 filas
        if row >= self.rows:
            row = self.rows - 1
        self.write_command(self.LCD_SETDDRAMADDR | (col + row_offsets[row]))

    def putstr(self, s):
        """Escribe una cadena de texto en la posición actual del cursor."""
        for char in s:
            self.write_data(ord(char))

    def backlight_on(self):
        """Enciende la luz de fondo."""
        self.backlight_val = self.LCD_BACKLIGHT
        self.write_command(self.LCD_RETURNHOME) # Envía un comando nulo para actualizar

    def backlight_off(self):
        """Apaga la luz de fondo."""
        self.backlight_val = self.LCD_NOBACKLIGHT
        self.write_command(self.LCD_RETURNHOME) # Envía un comando nulo para actualizar

    def putchar(self, char):
        """Escribe un solo caracter (agregado para compatibilidad con printLCD)."""
        self.write_data(ord(char))

# --- FIN DE LA SECCIÓN REEMPLAZADA ---


# ----------------------------------------------------------------------
# --- 3. INICIALIZACIÓN DE HARDWARE ------------------------------------
# ----------------------------------------------------------------------
_digital_outputs = [Pin(p, Pin.OUT) for p in PINS['digital_outputs']]
_digital_inputs = [Pin(p, Pin.IN, Pin.PULL_DOWN) for p in PINS['digital_inputs']]

_adc_inputs = []
for p in PINS['adc_inputs']:
    adc = ADC(Pin(p))
    adc.atten(ADC.ATTN_11DB) 
    _adc_inputs.append(adc)

_servo_pwms = [PWM(Pin(p), freq=50) for p in PINS['servo_pins']]

lcd = None
try:
    i2c = I2C(0, scl=Pin(PINS['I2C'][0]), sda=Pin(PINS['I2C'][1]), freq=400000)
    devices = i2c.scan()
    if devices:
        lcd_addr = devices[0]
        # --- ¡AHORA USA LA NUEVA CLASE I2cLcd! ---
        lcd = I2cLcd(i2c, lcd_addr, 16, 2) # (i2c, addr, cols, rows)
        # lcd.clear() # La clase __init__ ya llama a clear()
        lcd.backlight_on() # Aseguramos que esté encendida
        print(f"LCD I2C detectado en {hex(lcd_addr)} e inicializado.")
    else:
        print("Advertencia: No se detectó ningún dispositivo I2C (LCD).")
except Exception as e:
    print(f"Error al inicializar el LCD I2C: {e}")
    print("Las funciones LCD no estarán operativas.")


# ----------------------------------------------------------------------
# --- 4. FUNCIONES DE UTILIDAD (INTERNAS) ------------------------------
# ----------------------------------------------------------------------

def _map_value(x, in_min, in_max, out_min, out_max):
    if (in_max - in_min) == 0:
        return out_min
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min

CAL_LEIDO_PIN2_RAW = [0, 120,  215,  300,  410,  570,  680,  832,  950, 1215, 1600, 2060, 4095 ]
CAL_REAL_PIN2_RAW  = [0,  429,  900, 1315, 1825, 2300, 2550, 2815, 3000, 3300, 3600, 3940, 4095 ]

def _interpolar(x, x_puntos, y_puntos):
    if x <= x_puntos[0]:
        return y_puntos[0]
    if x >= x_puntos[-1]:
        return y_puntos[-1]
    try:
        for i in range(len(x_puntos) - 1):
            if x >= x_puntos[i] and x <= x_puntos[i+1]:
                return _map_value(x, x_puntos[i], x_puntos[i+1], y_puntos[i], y_puntos[i+1])
    except:
        return y_puntos[0]

# ----------------------------------------------------------------------
# --- 5. FUNCIONES PRINCIPALES DE LA LIBRERÍA --------------------------
# ----------------------------------------------------------------------

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
        if PLACA_ACTUAL == 'WEMOS' and n_entrada == 1:
            valor_leido_raw = _adc_inputs[n_entrada - 1].read()
            valor_corregido_raw = _interpolar(valor_leido_raw, CAL_LEIDO_PIN2_RAW, CAL_REAL_PIN2_RAW)
            porcentaje = (valor_corregido_raw / 4050) * 100
        else:
            valor_leido_raw = _adc_inputs[n_entrada - 1].read()
            porcentaje = (valor_leido_raw / 4050) * 100
    except Exception as e:
        print(f"Error en ADC (Pin {PINS['adc_inputs'][n_entrada-1]}): {e}.")
        return -1 
    if porcentaje > 100: return 100
    elif porcentaje < 0: return 0
    else: return int(porcentaje)

def salidaDigital(n_salida, estado):
    if 1 <= n_salida <= 4:
        _digital_outputs[n_salida - 1].value(1 if estado else 0)
    else:
        print(f"Error: salidaDigital número {n_salida} fuera de rango (1-4).")

def motorRC(n_salida, valor):
    if 1 <= n_salida <= 4:
        # --- ¡CORREGIDO con valores 31-120! ---
        duty = _map_value(valor, -100, 100, 31, 120)
        _servo_pwms[n_salida - 1].duty(int(duty))
    else:
        print(f"Error: motorRC número {n_salida} fuera de rango (1-4).")

def servomotor(nsalida, angulo):
    if 1 <= nsalida <= 4:
        # --- ¡CORREGIDO con valores 31-120! ---
        duty = _map_value(angulo, 0, 180, 31, 120)
        _servo_pwms[nsalida - 1].duty(int(duty))
    else:
        print(f"Error: servomotor número {nsalida} fuera de rango (1-4).")

def sensorDistancia(n_entrada):
    if not (1 <= n_entrada <= 4):
        print(f"Error: sensorDistancia número {n_entrada} fuera de rango (1-4).")
        return -1
    trigger_pin_num = PINS['digital_inputs'][n_entrada - 1] 
    echo_pin_num = PINS['adc_inputs'][n_entrada - 1]     
    trigger = Pin(trigger_pin_num, Pin.OUT)
    echo = Pin(echo_pin_num, Pin.IN)
    trigger.value(0)
    utime.sleep_us(5)
    trigger.value(1)
    utime.sleep_us(10)
    trigger.value(0)
    try:
        duration = machine.time_pulse_us(echo, 1, 30000)
    except OSError:
        return -1 
    if duration < 0:
        return -1 
    dist_cm = duration * 0.01715
    return dist_cm

def detenerTodo():
    """
    Detiene todos los actuadores y limpia los recursos.
    """
    print("Deteniendo todos los actuadores...")
    for pwm in _servo_pwms:
        pwm.deinit()
    for output in _digital_outputs:
        output.value(0)
    if lcd:
        limpiarLCD()
        lcd.backlight_on() # Dejarla encendida
    print("Recursos liberados. Es seguro detener.")


# ----------------------------------------------------------------------
# --- 6. FUNCIONES DEL DISPLAY LCD -------------------------------------
# ----------------------------------------------------------------------

def printLCD(columna, fila, txt):
    if lcd is None: return
    txt = str(txt)
    col = columna - 1
    fil = fila - 1
    lcd.move_to(col, fil)
    
    for char in txt:
        if col > 15:
            if fil == 0:
                fil = 1
                col = 0
                lcd.move_to(col, fil)
            else:
                break
        # La nueva clase I2cLcd tiene el método 'putchar' que agregamos
        lcd.putchar(char) 
        col += 1

def limpiarLCD():
    if lcd:
        lcd.clear()

def asciiLCD(columna, fila, carac):
    if lcd is None: return
    if 0 <= carac <= 255:
        lcd.move_to(columna - 1, fila - 1)
        # --- ¡CORREGIDO! ---
        # Usa el método 'write_data' de la nueva clase
        lcd.write_data(carac) 
    else:
        print(f"Error: asciiLCD valor {carac} fuera de rango (0-255).")
        
def luzLCD(estado):
    """
    Enciende (True) o apaga (False) la luz de fondo del LCD.
    """
    if lcd is None: return
    try:
        if estado:
            lcd.backlight_on()
        else:
            lcd.backlight_off()
    except Exception as e:
        print(f"Error al cambiar luz LCD: {e}")

def cursorLCD(estado):
    """
    Muestra (True) u oculta (False) el cursor (subrayado).
    """
    if lcd is None: return
    try:
        if estado:
            # Comando para Display ON + Cursor ON (Blink OFF)
            lcd.write_command(lcd.LCD_DISPLAYCONTROL | lcd.LCD_DISPLAYON | lcd.LCD_CURSORON | lcd.LCD_BLINKOFF)
        else:
            # Comando para Display ON + Cursor OFF (Blink OFF)
            lcd.write_command(lcd.LCD_DISPLAYCONTROL | lcd.LCD_DISPLAYON | lcd.LCD_CURSOROFF | lcd.LCD_BLINKOFF)
    except Exception as e:
        print(f"Error al cambiar cursor LCD: {e}")

def parpadeoLCD(estado):
    """
    Activa (True) o desactiva (False) el parpadeo del cursor (bloque).
    Nota: Esto también activa el cursor (subrayado).
    """
    if lcd is None: return
    try:
        if estado:
            # Comando para Display ON + Cursor ON + Parpadeo ON
            lcd.write_command(lcd.LCD_DISPLAYCONTROL | lcd.LCD_DISPLAYON | lcd.LCD_CURSORON | lcd.LCD_BLINKON)
        else:
            # Comando para Display ON + Cursor ON + Parpadeo OFF
            lcd.write_command(lcd.LCD_DISPLAYCONTROL | lcd.LCD_DISPLAYON | lcd.LCD_CURSORON | lcd.LCD_BLINKOFF)
    except Exception as e:
        print(f"Error al cambiar parpadeo LCD: {e}")