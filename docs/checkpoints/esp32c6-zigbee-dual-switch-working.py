# PYBOT - ESP32-C6 ZIGBEE
# Waveshare ESP32-C6-LCD-1.47
#
# ARRIBA: TECLA 1
# ABAJO:  TECLA 2
#
# ROJO  = ON
# VERDE = OFF
#
# Inicio: ambas ON (rojas)
# Cada pulsacion cambia su estado.
# Sin framebuffer de 110 KB.

import time
from machine import Pin, SPI
from pybot import zigbee

WIDTH = 172
HEIGHT = 320
HALF = HEIGHT // 2

RED = 0xF800
GREEN = 0x07E0

state = [True, True]

cs = Pin(14, Pin.OUT, value=1)
dc = Pin(15, Pin.OUT, value=0)
rst = Pin(21, Pin.OUT, value=1)
bl = Pin(22, Pin.OUT, value=1)

spi = SPI(
    1,
    baudrate=40000000,
    polarity=1,
    phase=1,
    sck=Pin(7),
    mosi=Pin(6)
)


def command(value):
    cs.value(0)
    dc.value(0)
    spi.write(bytes([value]))
    cs.value(1)


def data(value):
    cs.value(0)
    dc.value(1)
    spi.write(value)
    cs.value(1)


def init_lcd():
    rst.value(0)
    time.sleep_ms(50)
    rst.value(1)
    time.sleep_ms(50)

    command(0x01)
    time.sleep_ms(150)

    command(0x11)
    time.sleep_ms(120)

    command(0x36)
    data(b'\x00')

    command(0x3A)
    data(b'\x05')

    command(0x21)
    command(0x13)
    command(0x29)

    bl.value(1)


def fill_half(number, color):
    x0 = 34
    x1 = x0 + WIDTH - 1

    if number == 1:
        y0 = 0
        y1 = HALF - 1
    else:
        y0 = HALF
        y1 = HEIGHT - 1

    command(0x2A)
    data(bytes([x0 >> 8, x0 & 255, x1 >> 8, x1 & 255]))

    command(0x2B)
    data(bytes([y0 >> 8, y0 & 255, y1 >> 8, y1 & 255]))

    command(0x2C)

    high = (color >> 8) & 255
    low = color & 255

    chunk = bytes([high, low]) * (WIDTH * 8)

    cs.value(0)
    dc.value(1)

    for i in range(20):
        spi.write(chunk)

    cs.value(1)


def show_state(number):
    enabled = state[number - 1]

    if enabled:
        fill_half(number, RED)
        label = "ON"
    else:
        fill_half(number, GREEN)
        label = "OFF"

    print("SWITCH %d: %s" % (number, label))


def toggle(number):
    if number not in (1, 2):
        return

    state[number - 1] = not state[number - 1]
    show_state(number)


def on_button(event):
    key = event.get("key")
    gesture = event.get("gesture_name")

    if key == "KEY1":
        number = 1
    elif key == "KEY2":
        number = 2
    else:
        return

    print("EVENTO:", key, gesture)

    if gesture == "single":
        toggle(number)


def main():
    print("PYBOT ZIGBEE - DUAL SWITCH")

    init_lcd()

    show_state(1)
    show_state(2)

    info = zigbee.diagnose()

    if not info.get("ok"):
        print("ERROR ZIGBEE:", info)
        return

    zigbee.on_button(on_button)
    zigbee.enable_aps_capture()

    zigbee.start_coordinator(form_network=True)
    zigbee.permit_join(60)

    print("ZIGBEE INICIADO")
    print("ESPERANDO PULSACIONES")

    while True:
        try:
            events = zigbee.poll_events(16)

            for event in events:
                if event.get("kind") == "join":
                    print(
                        "DISPOSITIVO CONECTADO:",
                        event.get("payload")
                    )

            time.sleep_ms(50)

        except KeyboardInterrupt:
            print("PROGRAMA DETENIDO")
            zigbee.close_join()
            break


main()
