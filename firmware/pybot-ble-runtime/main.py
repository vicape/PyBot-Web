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
#   - CommandProcessor   : interpreta texto simple y decide la respuesta (PING/INFO/LED).
#   - ProgramRunner      : recibe el codigo del alumno por BLE, lo ejecuta y
#                          transmite la salida (protocolo 2.0: RUN/OUT/STOP).
#   - HardwareController : acciones fisicas (LED integrado).
# Flujo simple : BLE RX -> CommandProcessor.process() -> HardwareController -> TX notify.
# Flujo RUN    : BLE RX -> ProgramRunner (reensambla codigo) -> exec() -> TX (OUT/ERR/DONE).
#
# Los PRELUDIOS (pin/servo/motor/wait de "GPIO directo" y las funciones EDA6) NO
# viajan por BLE: viven como archivos .py instalados en la placa (`pybot_mpy.py`
# y `EDA6.py`, instalados por USB junto con este runtime). Por BLE solo viaja el
# codigo del alumno + el modo (mpy/eda6) + el perfil (WEMOS/ESP32).
#
# Placa objetivo: ESP32 clasico (WROOM). LED integrado en GPIO 2.
# La API `bluetooth` de MicroPython es comun a las variantes ESP32; si el LED no
# existe o difiere, cambiar BUILTIN_LED_PIN.

import bluetooth
import struct
import time
import sys
import machine
import ubinascii
from micropython import const

# --- Version / protocolo (legibles por el comando INFO) ---
PYBOT_RUNTIME_VERSION = "2.0.0"
PYBOT_PROTOCOL_VERSION = "2.0"
PYBOT_RUNTIME_NAME = "PyBot BLE Runtime"
PYBOT_BOARD = "ESP32"

# --- LED integrado (ESP32 clasico / WROOM DevKit) ---
BUILTIN_LED_PIN = 2

# --- Limites de robustez ---
MAX_COMMAND_LENGTH = const(64)
_TX_CHUNK = const(20)  # margen seguro para MTU BLE por defecto (23 -> 20 utiles)
_RX_BUF_MAX = const(512)  # una linea de protocolo cabe holgada; evita crecer sin limite
_OUT_CHUNK = const(120)  # bytes de fuente por frame OUT antes de base64
_MAX_PROGRAM_B64 = const(12000)  # ~8 KB de fuente (base64 ~1.34x)

# Preludios instalados en la placa (por USB) que el runtime importa al ejecutar.
_MPY_LIB = "pybot_mpy"  # define pin/servo/motor/wait (GPIO directo)
_EDA6_LIB = "EDA6"      # define salidaDigital/servomotor/motorRC/... (EDA6)

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

# Comandos simples aceptados SIN delimitador '\n' (herramientas BLE genericas).
_NO_NL_COMMANDS = ("PING", "INFO", "LED,1", "LED,0", "STOP")

# Tipos de dato para el payload de advertising
_ADV_TYPE_FLAGS = const(0x01)
_ADV_TYPE_NAME = const(0x09)
_ADV_TYPE_UUID128_COMPLETE = const(0x07)


class _PyBotStop(Exception):
    """Se lanza para abortar el programa del alumno cuando llega STOP/desconexion."""
    pass


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
    """Interpreta comandos de texto SIMPLES y devuelve la respuesta. No toca BLE."""

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


class _StrSink:
    """Sumidero de texto para sys.print_exception (captura el traceback como string)."""

    def __init__(self):
        self.parts = []

    def write(self, s):
        try:
            self.parts.append(s if isinstance(s, str) else str(s))
        except Exception:
            pass

    def text(self):
        return "".join(self.parts)


class ProgramRunner:
    """Recibe el codigo del alumno por BLE (en chunks base64), lo ejecuta con el
    preludio correcto (mpy/eda6) y transmite la salida por TX en tiempo real.

    Concurrencia: MicroPython es mono-hilo. El IRQ de BLE es un callback
    "soft" que corre ENTRE bytecodes; por eso el programa del alumno NO se
    ejecuta dentro del IRQ (bloquearia la recepcion de STOP). El IRQ solo
    reensambla y marca `pending`; el bucle principal invoca `run_pending()`.
    Mientras el programa corre, un STOP entrante dispara el IRQ soft-callback
    que setea la bandera de stop; `time.sleep` (parcheado) la observa y corta.
    """

    def __init__(self, send):
        self._send = send            # send(text): envia un frame por TX
        self._chunks = []            # chunks base64 acumulados
        self._b64_len = 0
        self._mode = "mpy"
        self._profile = "WEMOS"
        self._collecting = False
        self.running = False
        self.pending = False
        self._stop = False

    # --- Fase de recepcion (llamada desde el IRQ: debe ser rapida) ---

    def begin(self, mode, profile):
        if self.running:
            self._send("RUN:ERROR:BUSY")
            return
        self._chunks = []
        self._b64_len = 0
        self._mode = "eda6" if mode == "eda6" else "mpy"
        self._profile = "ESP32" if profile == "ESP32" else "WEMOS"
        self._collecting = True
        self._stop = False
        self.pending = False
        self._send("RUN:READY")

    def chunk(self, b64):
        if not self._collecting:
            return
        self._b64_len += len(b64)
        if self._b64_len > _MAX_PROGRAM_B64:
            self._collecting = False
            self._chunks = []
            self._send("RUN:ERROR:TOO_LONG")
            return
        self._chunks.append(b64)

    def mark_end(self):
        if not self._collecting:
            self._send("RUN:ERROR:NO_PROGRAM")
            return
        self._collecting = False
        self.pending = True

    def request_stop(self):
        self._stop = True

    def should_stop(self):
        return self._stop

    # --- Fase de ejecucion (llamada desde el bucle principal) ---

    def _decode(self):
        out = bytearray()
        for c in self._chunks:
            try:
                out.extend(ubinascii.a2b_base64(c))
            except Exception:
                raise ValueError("bad_b64")
        self._chunks = []
        return out.decode("utf-8")

    def _emit_out(self, text):
        try:
            data = text.encode("utf-8")
        except Exception:
            return
        for i in range(0, len(data), _OUT_CHUNK):
            piece = data[i:i + _OUT_CHUNK]
            try:
                b64 = ubinascii.b2a_base64(piece).decode().strip()
            except Exception:
                continue
            self._send("RUN:OUT:" + b64)

    def _emit_err(self, text):
        try:
            data = text.encode("utf-8")
        except Exception:
            return
        for i in range(0, len(data), _OUT_CHUNK):
            piece = data[i:i + _OUT_CHUNK]
            try:
                b64 = ubinascii.b2a_base64(piece).decode().strip()
            except Exception:
                continue
            self._send("RUN:ERR:" + b64)

    def _emit_err_exc(self, exc):
        sink = _StrSink()
        try:
            sys.print_exception(exc, sink)
            self._emit_err(sink.text())
        except Exception:
            try:
                self._emit_err(str(exc))
            except Exception:
                self._emit_err("error")

    def _make_print(self):
        emit = self._emit_out

        def _p(*args, **kwargs):
            sep = kwargs.get("sep", " ")
            end = kwargs.get("end", "\n")
            try:
                s = sep.join(str(a) for a in args) + end
            except Exception:
                s = end
            emit(s)

        return _p

    def _load_prelude(self, ns):
        """Carga en el namespace las funciones del preludio segun el modo.
        Los preludios estan instalados como archivos .py en la placa."""
        try:
            if self._mode == "eda6":
                mod_eda6 = __import__(_EDA6_LIB)
                try:
                    mod_eda6.PLACA_ACTUAL = self._profile
                except Exception:
                    pass
                for k in dir(mod_eda6):
                    if not k.startswith("_"):
                        ns[k] = getattr(mod_eda6, k)
                # Estado seguro antes de correr (igual que el flujo serial EDA6).
                try:
                    mod_eda6.detenerTodo()
                except Exception:
                    pass
            # pin/servo/motor/wait siempre disponibles (GPIO directo).
            mod_mpy = __import__(_MPY_LIB)
            for k in dir(mod_mpy):
                if not k.startswith("_"):
                    ns[k] = getattr(mod_mpy, k)
            return True
        except Exception as e:
            self._emit_err_exc(e)
            return False

    def _eda6_cleanup(self, ns):
        if self._mode != "eda6":
            return
        fn = ns.get("detenerTodo")
        if fn:
            try:
                fn()
            except Exception:
                pass

    def run_pending(self):
        if not self.pending:
            return
        self.pending = False
        self.running = True
        try:
            code = self._decode()
        except Exception:
            self._send("RUN:ERROR:BAD_ENCODING")
            self.running = False
            self._send("RUN:DONE")
            return

        self._send("RUN:STARTED")

        ns = {"__name__": "__main__"}
        ns["print"] = self._make_print()

        if not self._load_prelude(ns):
            self.running = False
            self._send("RUN:DONE")
            return

        # Sleep INTERRUMPIBLE: duerme en tramos chequeando el stop flag y lanza
        # _PyBotStop para cortar cualquier bucle que use wait()/sleep.
        orig_sleep = time.sleep
        should_stop = self.should_stop

        def _checked_sleep(secs):
            try:
                total = float(secs)
            except Exception:
                total = 0.0
            if total <= 0:
                if should_stop():
                    raise _PyBotStop()
                return
            step = 0.02
            elapsed = 0.0
            while elapsed < total:
                if should_stop():
                    raise _PyBotStop()
                d = step if (total - elapsed) > step else (total - elapsed)
                orig_sleep(d)
                elapsed += d
            if should_stop():
                raise _PyBotStop()

        # 1) Siempre exponer wait()/sleep() interrumpibles en el namespace del
        #    programa (tienen prioridad sobre los del preludio). Cubre el caso
        #    tipico `while True: ...; wait(...)`.
        ns["wait"] = _checked_sleep
        ns["sleep"] = _checked_sleep

        # 2) Best-effort: parchear time.sleep para cubrir tambien `import time` /
        #    `from time import sleep` y los sleeps internos de las librerias. En
        #    algunos ports `time` es de solo lectura; si falla, seguimos con (1).
        patched = False
        try:
            time.sleep = _checked_sleep
            patched = True
        except Exception:
            patched = False

        try:
            exec(code, ns)
        except _PyBotStop:
            self._emit_out("\n[Detenido]\n")
        except Exception as e:
            self._emit_err_exc(e)
        finally:
            if patched:
                try:
                    time.sleep = orig_sleep
                except Exception:
                    pass
            self._eda6_cleanup(ns)
            self.running = False
            self._send("RUN:DONE")


class BluetoothTransport:
    """Capa BLE: advertising, conexion y RX/TX. Delega la logica a callbacks."""

    def __init__(self, name, on_command, on_disconnect=None):
        self._name = name
        self._on_command = on_command
        self._on_disconnect = on_disconnect
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
                # Abortar cualquier programa en ejecucion y volver a advertising.
                if self._on_disconnect:
                    try:
                        self._on_disconnect()
                    except Exception:
                        pass
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
        if len(self._rx_buf) > _RX_BUF_MAX:
            self._rx_buf = bytearray()
            return
        # Procesar SOLO lineas completas (delimitador '\n'). Esto es clave para
        # el protocolo RUN: nunca despachar un frame a medias.
        while True:
            idx = self._rx_buf.find(b"\n")
            if idx < 0:
                break
            line = self._rx_buf[:idx]
            self._rx_buf = self._rx_buf[idx + 1:]
            self._dispatch(line)
        # Fallback acotado: comando corto conocido enviado SIN '\n' (herramientas
        # BLE genericas). No aplica a frames RUN (que siempre llevan '\n').
        if self._rx_buf:
            try:
                probe = bytes(self._rx_buf).decode("utf-8").strip().upper()
            except Exception:
                probe = ""
            if probe in _NO_NL_COMMANDS:
                buf = self._rx_buf
                self._rx_buf = bytearray()
                self._dispatch(buf)

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
            piece = data[i: i + _TX_CHUNK]
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

    # send() se asigna despues de construir el transport (dependencia circular
    # controlada): el runner necesita enviar frames por TX.
    runner_holder = {}

    def _send(text):
        tr = runner_holder.get("transport")
        if tr:
            tr.send(text)

    runner = ProgramRunner(_send)

    def on_command(text):
        try:
            t = text.strip()
        except Exception:
            return "ERR,UNKNOWN_COMMAND"
        if not t:
            return None
        upper = t.upper()
        if upper == "STOP":
            runner.request_stop()
            return None
        if t.startswith("RUN:"):
            _handle_run(runner, t)
            return None
        return processor.process(t)

    def on_disconnect():
        # Si habia un programa corriendo, abortarlo al perder la conexion.
        runner.request_stop()

    transport = BluetoothTransport(dev_name, on_command, on_disconnect)
    runner_holder["transport"] = transport

    # Bucle principal: la recepcion ocurre en el IRQ; aca ejecutamos el programa
    # del alumno cuando quedo pendiente (fuera del IRQ, para poder recibir STOP).
    while True:
        if runner.pending and not runner.running:
            try:
                runner.run_pending()
            except Exception:
                runner.running = False
                runner.pending = False
                try:
                    _send("RUN:DONE")
                except Exception:
                    pass
        time.sleep_ms(50)


def _handle_run(runner, line):
    """Interpreta un frame RUN:* recibido de PyBot Web."""
    if line.startswith("RUN:BEGIN:"):
        rest = line[len("RUN:BEGIN:"):]
        parts = rest.split(":")
        mode = parts[0].strip().lower() if len(parts) >= 1 else "mpy"
        profile = parts[1].strip().upper() if len(parts) >= 2 else "WEMOS"
        runner.begin(mode, profile)
    elif line.startswith("RUN:CHUNK:"):
        runner.chunk(line[len("RUN:CHUNK:"):].strip())
    elif line == "RUN:END":
        runner.mark_end()
    else:
        runner._send("RUN:ERROR:BAD_FRAME")


main()
