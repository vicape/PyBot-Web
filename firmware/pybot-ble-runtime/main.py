# PyBot BLE Runtime - MicroPython (ESP32)
#
# Se instala en la placa como `main.py` (arranca solo al encender) usando el
# mecanismo existente de transferencia por raw REPL de PyBot (installFile).
# NO usa esptool ni binarios: es codigo fuente MicroPython versionado en el repo.
#
# Al encender:
#   init hardware -> uniqueId/MAC -> deviceId + nombre PYBOT-XXXXXX ->
#   init BLE -> servidor GATT -> servicio PyBot (RX write / TX notify) ->
#   advertising -> espera conexion.
#
# Separacion conceptual (aunque en un solo archivo por simplicidad de instalacion):
#   - BluetoothTransport : solo recibe/envia bytes por BLE.
#   - CommandProcessor   : interpreta texto y decide la respuesta (no toca BLE).
#   - HardwareController : acciones fisicas (LED integrado).
# Flujo: BLE RX -> CommandProcessor.process() -> HardwareController -> BLE TX notify.
#
# Placa objetivo: ESP32 clasico (WROOM). LED integrado en GPIO 2.
# La API `bluetooth` de MicroPython es comun a las variantes ESP32; si el LED no
# existe o difiere, cambiar BUILTIN_LED_PIN.

import bluetooth
import struct
import time
import machine
import ubinascii
from micropython import const

# --- Version / protocolo (legibles por el comando INFO) ---
PYBOT_RUNTIME_VERSION = "1.0.0"
PYBOT_PROTOCOL_VERSION = "1.0"
PYBOT_RUNTIME_NAME = "PyBot BLE Runtime"
PYBOT_BOARD = "ESP32"

# --- LED integrado (ESP32 clasico / WROOM DevKit) ---
BUILTIN_LED_PIN = 2

# --- Limites de robustez ---
MAX_COMMAND_LENGTH = const(64)
_TX_CHUNK = const(20)  # margen seguro para MTU BLE por defecto (23 -> 20 utiles)

# --- IRQ BLE ---
_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)

# --- Flags de caracteristicas GATT ---
_FLAG_READ = const(0x0002)
_FLAG_WRITE_NO_RESPONSE = const(0x0004)
_FLAG_WRITE = const(0x0008)
_FLAG_NOTIFY = const(0x0010)

# --- UUIDs del servicio PyBot ---
_SERVICE_UUID = bluetooth.UUID("8fbc0001-4d5a-4b8c-9a1f-123456789001")
_RX_UUID = bluetooth.UUID("8fbc0002-4d5a-4b8c-9a1f-123456789002")
_TX_UUID = bluetooth.UUID("8fbc0003-4d5a-4b8c-9a1f-123456789003")

# PyBot Web -> ESP32 (WRITE)
_RX_CHAR = (_RX_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE)
# ESP32 -> PyBot Web (NOTIFY)
_TX_CHAR = (_TX_UUID, _FLAG_NOTIFY | _FLAG_READ)
_PYBOT_SERVICE = (_SERVICE_UUID, (_TX_CHAR, _RX_CHAR))

# --- Estados BLE ---
STATE_BOOT = "BOOT"
STATE_WAITING = "WAITING"
STATE_CONNECTED = "CONNECTED"
STATE_DISCONNECTED = "DISCONNECTED"

# Tipos de dato para el payload de advertising
_ADV_TYPE_FLAGS = const(0x01)
_ADV_TYPE_NAME = const(0x09)
_ADV_TYPE_UUID128_COMPLETE = const(0x07)


def _advertising_payload(name=None, services=None):
    """Construye un payload de advertising valido (<=31 bytes)."""
    payload = bytearray()

    def _append(adv_type, value):
        payload.extend(struct.pack("BB", len(value) + 1, adv_type) + value)

    # General discoverable + BR/EDR no soportado.
    _append(_ADV_TYPE_FLAGS, struct.pack("B", 0x02 + 0x04))
    if name:
        _append(_ADV_TYPE_NAME, name)
    if services:
        for uuid in services:
            b = bytes(uuid)
            if len(b) == 16:
                _append(_ADV_TYPE_UUID128_COMPLETE, b)
    return payload


def device_id():
    """ID unico y ESTABLE derivado del hardware: ultimos 6 hex de la MAC/uniqueId."""
    try:
        raw = ubinascii.hexlify(machine.unique_id()).decode()
    except Exception:
        raw = "000000000000"
    return raw[-6:].upper()


def device_name():
    return "PYBOT-" + device_id()


class HardwareController:
    """Acciones fisicas. No conoce nada de BLE."""

    def __init__(self):
        self._led = None
        try:
            self._led = machine.Pin(BUILTIN_LED_PIN, machine.Pin.OUT)
            self._led.value(0)
        except Exception:
            self._led = None

    def set_led(self, on):
        if self._led is None:
            return False
        try:
            self._led.value(1 if on else 0)
            return True
        except Exception:
            return False


class CommandProcessor:
    """Interpreta comandos de texto y devuelve la respuesta. No toca BLE."""

    def __init__(self, hardware, dev_name, dev_id):
        self._hw = hardware
        self._name = dev_name
        self._id = dev_id

    def _info(self):
        return (
            '{"device":"%s","id":"%s","firmware":"%s",'
            '"protocol":"%s","runtime":"%s","board":"%s"}'
            % (
                self._name,
                self._id,
                PYBOT_RUNTIME_VERSION,
                PYBOT_PROTOCOL_VERSION,
                PYBOT_RUNTIME_NAME,
                PYBOT_BOARD,
            )
        )

    def process(self, command):
        if command is None:
            return None
        try:
            text = command.strip()
        except Exception:
            return "ERR,UNKNOWN_COMMAND"
        if not text:
            return None
        if len(text) > MAX_COMMAND_LENGTH:
            return "ERR,TOO_LONG"

        upper = text.upper()
        if upper == "PING":
            return "PONG"
        if upper == "INFO":
            return self._info()
        if upper == "LED,1":
            return "OK" if self._hw.set_led(True) else "ERR,NO_LED"
        if upper == "LED,0":
            return "OK" if self._hw.set_led(False) else "ERR,NO_LED"
        return "ERR,UNKNOWN_COMMAND"


class BluetoothTransport:
    """Capa BLE: advertising, conexion y RX/TX. Delega la logica al callback."""

    def __init__(self, name, on_command):
        self._name = name
        self._on_command = on_command
        self.state = STATE_BOOT
        self._conn_handle = None
        self._rx_buf = bytearray()

        self._ble = bluetooth.BLE()
        self._ble.active(True)
        self._ble.irq(self._irq)
        ((self._tx_handle, self._rx_handle),) = self._ble.gatts_register_services(
            (_PYBOT_SERVICE,)
        )
        self._payload = _advertising_payload(services=[_SERVICE_UUID])
        self._resp_payload = _advertising_payload(name=self._name.encode())
        self._advertise()

    def _advertise(self, interval_us=250000):
        try:
            self._ble.gap_advertise(
                interval_us, adv_data=self._payload, resp_data=self._resp_payload
            )
            self.state = STATE_WAITING
        except Exception:
            # Reintento sin scan response si el stack lo rechaza.
            try:
                self._ble.gap_advertise(interval_us, adv_data=self._payload)
                self.state = STATE_WAITING
            except Exception:
                pass

    def _irq(self, event, data):
        try:
            if event == _IRQ_CENTRAL_CONNECT:
                conn_handle, _, _ = data
                self._conn_handle = conn_handle
                self.state = STATE_CONNECTED
            elif event == _IRQ_CENTRAL_DISCONNECT:
                self._conn_handle = None
                self.state = STATE_DISCONNECTED
                self._rx_buf = bytearray()
                # Volver a advertising automaticamente (sin reset manual).
                self._advertise()
            elif event == _IRQ_GATTS_WRITE:
                conn_handle, value_handle = data
                if value_handle == self._rx_handle:
                    self._handle_rx()
        except Exception:
            # Nunca crashear dentro del IRQ.
            pass

    def _handle_rx(self):
        try:
            chunk = self._ble.gatts_read(self._rx_handle)
        except Exception:
            return
        if not chunk:
            return
        self._rx_buf.extend(chunk)
        # Evitar crecer sin limite ante datos corruptos/sin delimitador.
        if len(self._rx_buf) > (MAX_COMMAND_LENGTH * 4):
            self._rx_buf = bytearray()
            return
        # Procesar por lineas (delimitador '\n'); tolera comandos sin '\n'.
        while True:
            idx = self._rx_buf.find(b"\n")
            if idx < 0:
                break
            line = self._rx_buf[:idx]
            self._rx_buf = self._rx_buf[idx + 1 :]
            self._dispatch(line)
        # Si no hay delimitador pero ya llego un comando completo razonable,
        # procesarlo igual (PyBot Web puede no enviar '\n').
        if self._rx_buf and len(self._rx_buf) <= MAX_COMMAND_LENGTH:
            self._dispatch(bytes(self._rx_buf))
            self._rx_buf = bytearray()

    def _dispatch(self, raw_bytes):
        try:
            text = bytes(raw_bytes).decode("utf-8")
        except Exception:
            self.send("ERR,BAD_ENCODING")
            return
        try:
            response = self._on_command(text)
        except Exception:
            response = "ERR,INTERNAL"
        if response:
            self.send(response)

    def send(self, message):
        """Envia texto por TX notify en trozos seguros para el MTU, con '\n' final."""
        if self._conn_handle is None:
            return
        try:
            data = (message + "\n").encode("utf-8")
        except Exception:
            return
        for i in range(0, len(data), _TX_CHUNK):
            piece = data[i : i + _TX_CHUNK]
            try:
                self._ble.gatts_notify(self._conn_handle, self._tx_handle, piece)
            except Exception:
                break
            time.sleep_ms(8)


def main():
    dev_id = device_id()
    dev_name = device_name()
    hardware = HardwareController()
    processor = CommandProcessor(hardware, dev_name, dev_id)
    transport = BluetoothTransport(dev_name, processor.process)

    # Bucle principal: mantener vivo el runtime; el trabajo real ocurre en el IRQ.
    while True:
        time.sleep_ms(200)


main()
