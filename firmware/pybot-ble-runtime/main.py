# PyBot BLE Runtime - MicroPython (ESP32)
#
# Se instala en la placa como `main.py` (arranca solo al encender) usando el
# mecanismo existente de transferencia por raw REPL de PyBot (installFile).
# NO usa esptool ni binarios: es codigo fuente MicroPython versionado en el repo.
#
# Al encender:
#   init hardware -> uniqueId/MAC -> deviceId + nombre PYBOT-XXXXXX ->
#   init BLE -> servidor GATT -> servicio PyBot (RX write / TX notify) ->
#   advertising -> (autostart de la app persistente si corresponde) ->
#   espera conexion.
#
# Separacion conceptual (aunque en un solo archivo por simplicidad de instalacion):
#   - BluetoothTransport : solo recibe/envia bytes por BLE.
#   - CommandProcessor   : interpreta texto simple y decide la respuesta (PING/INFO/LED).
#   - ProgramManager     : MOTOR UNICO de ejecucion. Corre el programa del alumno en
#                          dos modos que comparten namespace/preludio/print/STOP/cleanup:
#                            * TEMPORARY : recibido por BLE (RUN), no persiste.
#                            * PERSISTENT: leido de pybot_app.py (DEPLOY + autostart).
#   - DeployReceiver     : transferencia ATOMICA verificada (size+hash) de la app
#                          persistente a pybot_app.py + metadata (pybot_app.json).
#   - HardwareController : acciones fisicas (LED integrado).
#
# Los PRELUDIOS (pin/servo/motor/wait de "GPIO directo" y las funciones EDA6) NO
# viajan por BLE: viven como archivos .py instalados en la placa (`pybot_mpy.py`
# y `EDA6.py`, instalados por USB junto con este runtime). Por BLE solo viaja el
# codigo del alumno + el modo (mpy/eda6) + el perfil (WEMOS/ESP32).
#
# Concurrencia y STOP (limitacion real de MicroPython):
#   MicroPython es mono-hilo: un exec() que no cede (p.ej. `while True: pass`)
#   monopoliza el interprete. El IRQ de BLE es un soft-callback que corre ENTRE
#   bytecodes: por eso SIEMPRE recibe comandos (setea banderas) aunque el programa
#   este corriendo. Con eso:
#     * STOP cooperativo: parcheamos time.sleep/sleep_ms/sleep_us y ofrecemos
#       wait()/sleep() interrumpibles; cualquier espera chequea la bandera y corta.
#       Cubre el caso tipico `while True: ...; wait(...)`.
#     * STOP:FORCE (recuperacion REAL): para un bucle que NO cede, no hay forma
#       cooperativa de cortarlo. STOP:FORCE marca SAFE BOOT y hace machine.reset()
#       DESDE el propio IRQ (que corre entre bytecodes): eso si detiene cualquier
#       bucle. Tras el reinicio arranca el runtime + BLE pero NO se relanza la app
#       (safe boot) para evitar boot-loop. Ver docs/PYBOT_BLE_RUNTIME.md.
#
# Placa objetivo: ESP32 clasico (WROOM). LED integrado en GPIO 2.

import bluetooth
import struct
import time
import sys
import os
import json
import machine
import ubinascii
from micropython import const

try:
    import uhashlib
except ImportError:  # pragma: no cover - depende del port
    uhashlib = None

# --- Version / protocolo (legibles por el comando INFO) ---
PYBOT_RUNTIME_VERSION = "3.0.0"
# Protocolo 3.0: agrega STOP confiable (RUN:STOPPED + STOP:FORCE), DEPLOY
# persistente verificado, control de app (APP:*) y autostart con safe boot.
PYBOT_PROTOCOL_VERSION = "3.0"
PYBOT_RUNTIME_NAME = "PyBot BLE Runtime"
PYBOT_BOARD = "ESP32"
# Capacidades declaradas en INFO para que la web prefiera capabilities sobre
# inferencias fragiles por numero de version.
PYBOT_CAPABILITIES = ("run", "stop", "deploy", "app-control", "autostart")

# --- LED integrado (ESP32 clasico / WROOM DevKit) ---
BUILTIN_LED_PIN = 2

# --- Limites de robustez ---
MAX_COMMAND_LENGTH = const(96)
_TX_CHUNK = const(20)  # margen seguro para MTU BLE por defecto (23 -> 20 utiles)
_RX_BUF_MAX = const(600)  # una linea de protocolo (incluye DEPLOY:CHUNK) cabe holgada
_OUT_CHUNK = const(120)  # bytes de fuente por frame OUT antes de base64
_MAX_RUN_B64 = const(12000)  # ~8 KB de fuente para RUN temporal (base64 ~1.34x)

# Limites de tamano del programa del alumno (bytes de fuente UTF-8):
#   - RUN temporal: chico, se reensambla en RAM.
#   - DEPLOY persistente: mas grande, se escribe a flash por chunks.
MAX_RUN_PROGRAM_SIZE = const(8192)
MAX_DEPLOY_PROGRAM_SIZE = const(16384)

# Preludios instalados en la placa (por USB) que el runtime importa al ejecutar.
_MPY_LIB = "pybot_mpy"  # define pin/servo/motor/wait (GPIO directo)
_EDA6_LIB = "EDA6"      # define salidaDigital/servomotor/motorRC/... (EDA6)

# Archivos de la app persistente y estado (NO se tocan al actualizar el runtime).
_APP_FILE = "pybot_app.py"       # programa del alumno persistente
_APP_TMP = "pybot_app.tmp"       # escritura atomica: tmp -> verify -> rename
_APP_META = "pybot_app.json"     # metadata: version/mode/profile/autostart/size/hash
_STATE_FILE = "pybot_state.json" # safe boot + contador de fallos de autostart

# Tras N fallos consecutivos de autostart, no relanzar (safe boot por fallos).
_MAX_AUTOSTART_FAILS = const(3)

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
_NO_NL_COMMANDS = (
    "PING", "INFO", "LED,1", "LED,0", "STOP", "STOP:FORCE",
    "APP:INFO", "APP:START", "APP:STOP", "APP:DELETE",
)

# Tipos de dato para el payload de advertising
_ADV_TYPE_FLAGS = const(0x01)
_ADV_TYPE_NAME = const(0x09)
_ADV_TYPE_UUID128_COMPLETE = const(0x07)


class _PyBotStop(Exception):
    """Se lanza para abortar el programa del alumno cuando llega STOP/desconexion."""
    pass


# ===========================================================================
# Helpers de filesystem / hash / estado (JSON compacto)
# ===========================================================================

def _file_exists(path):
    try:
        os.stat(path)
        return True
    except Exception:
        return False


def _file_size(path):
    try:
        return os.stat(path)[6]
    except Exception:
        return -1


def _remove(path):
    try:
        os.remove(path)
        return True
    except Exception:
        return False


def _read_json(path):
    try:
        with open(path) as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _write_json(path, obj):
    try:
        with open(path, "w") as f:
            json.dump(obj, f)
        return True
    except Exception:
        return False


def _sha256_file(path):
    """SHA-256 (hex) del contenido de un archivo. None si no hay uhashlib."""
    if uhashlib is None:
        return None
    try:
        h = uhashlib.sha256()
        with open(path, "rb") as f:
            while True:
                b = f.read(256)
                if not b:
                    break
                h.update(b)
        return ubinascii.hexlify(h.digest()).decode()
    except Exception:
        return None


def _load_state():
    st = _read_json(_STATE_FILE)
    return st if isinstance(st, dict) else {}


def _save_state(st):
    _write_json(_STATE_FILE, st)


def _set_safe_boot(flag):
    st = _load_state()
    st["safe_boot"] = bool(flag)
    _save_state(st)


def _load_app_meta():
    return _read_json(_APP_META)


def _advertising_payload(name=None, services=None):
    """Construye un payload de advertising valido (<=31 bytes)."""
    payload = bytearray()

    def _append(adv_type, value):
        payload.extend(struct.pack("BB", len(value) + 1, adv_type) + value)

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
        caps = '","'.join(PYBOT_CAPABILITIES)
        return (
            '{"device":"%s","id":"%s","firmware":"%s",'
            '"protocol":"%s","runtime":"%s","board":"%s",'
            '"capabilities":["%s"]}'
            % (
                self._name,
                self._id,
                PYBOT_RUNTIME_VERSION,
                PYBOT_PROTOCOL_VERSION,
                PYBOT_RUNTIME_NAME,
                PYBOT_BOARD,
                caps,
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


def _exc_text(exc):
    sink = _StrSink()
    try:
        sys.print_exception(exc, sink)
        return sink.text()
    except Exception:
        try:
            return str(exc)
        except Exception:
            return "error"


class ProgramManager:
    """Motor UNICO de ejecucion del programa del alumno (TEMPORARY y PERSISTENT).

    Comparten: construccion del namespace, carga de preludio (mpy/eda6), print,
    manejo de errores, STOP cooperativo, cleanup de hardware y actualizacion de
    estado. La unica diferencia es de DONDE viene el codigo y que se hace al
    terminar:
      * TEMPORARY (RUN por BLE): codigo recibido en chunks base64; frames RUN:*.
      * PERSISTENT (app): codigo leido de pybot_app.py; actualiza pybot_state.json.
    """

    def __init__(self, send):
        self._send = send            # send(text): envia un frame por TX
        self._chunks = []            # chunks base64 acumulados (RUN temporal)
        self._b64_len = 0
        self._mode = "mpy"
        self._profile = "WEMOS"
        self._collecting = False
        self.running = False
        self.pending = False
        self._persistent = False
        self._stop = False
        self._force = False
        self._pending_code = None

    # --- Fase de recepcion RUN temporal (llamada desde el IRQ: debe ser rapida) ---

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
        self._force = False
        self.pending = False
        self._persistent = False
        self._pending_code = None
        self._send("RUN:READY")

    def chunk(self, b64):
        if not self._collecting:
            return
        self._b64_len += len(b64)
        if self._b64_len > _MAX_RUN_B64:
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
        try:
            code = self._decode_chunks()
        except Exception:
            self._send("RUN:ERROR:BAD_ENCODING")
            return
        self._pending_code = code
        self._persistent = False
        self.pending = True

    def _decode_chunks(self):
        out = bytearray()
        for c in self._chunks:
            out.extend(ubinascii.a2b_base64(c))
        self._chunks = []
        return out.decode("utf-8")

    # --- Fase de arranque PERSISTENT (app instalada por DEPLOY / autostart) ---

    def start_app(self):
        if self.running:
            self._send("APP:ERROR:BUSY")
            return False
        meta = _load_app_meta()
        if not meta or not _file_exists(_APP_FILE):
            self._send("APP:ERROR:NO_APP")
            return False
        try:
            with open(_APP_FILE) as f:
                code = f.read()
        except Exception:
            self._send("APP:ERROR:READ_FAILED")
            return False
        self._pending_code = code
        self._mode = "eda6" if meta.get("mode") == "eda6" else "mpy"
        self._profile = "ESP32" if meta.get("profile") == "ESP32" else "WEMOS"
        self._persistent = True
        self._stop = False
        self._force = False
        self.pending = True
        return True

    def request_stop(self):
        self._stop = True

    def request_force_stop(self):
        self._stop = True
        self._force = True

    def should_stop(self):
        return self._stop

    # --- Salida ---

    def _emit_frames(self, tag, text):
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
            self._send(tag + b64)

    def _emit_out(self, text):
        self._emit_frames("RUN:OUT:", text)

    def _emit_err(self, text):
        self._emit_frames("RUN:ERR:", text)

    def _emit_err_exc(self, exc):
        self._emit_err(_exc_text(exc))

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

    def _cleanup(self, ns):
        """Cleanup de hardware SIEMPRE (fin normal, STOP, excepcion, reemplazo).
        EDA6 -> detenerTodo(); GPIO directo -> _pybot_cleanup() (apaga PWM/salidas
        creadas por PyBot, no toca entradas)."""
        try:
            fn = ns.get("detenerTodo")
            if fn:
                fn()
        except Exception:
            pass
        try:
            mod_mpy = __import__(_MPY_LIB)
            cu = getattr(mod_mpy, "_pybot_cleanup", None)
            if cu:
                cu()
        except Exception:
            pass

    # --- Fase de ejecucion (llamada desde el bucle principal, fuera del IRQ) ---

    def run_pending(self):
        if not self.pending:
            return
        self.pending = False
        self.running = True
        persistent = self._persistent
        code = self._pending_code
        self._pending_code = None
        if code is None:
            self.running = False
            return

        self._send("RUN:STARTED")

        ns = {"__name__": "__main__"}
        ns["print"] = self._make_print()

        if not self._load_prelude(ns):
            self.running = False
            self._force = False
            self._finish(persistent, "error", "prelude")
            return

        # Sleep INTERRUMPIBLE: cubre wait()/sleep()/time.sleep/sleep_ms/sleep_us.
        # sleep_us NO se parte en tramos (timing critico de HC-SR04/LCD): solo se
        # chequea el stop tras dormir el tiempo exacto pedido.
        orig_sleep = time.sleep
        orig_sleep_ms = getattr(time, "sleep_ms", None)
        orig_sleep_us = getattr(time, "sleep_us", None)
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

        def _checked_sleep_ms(ms):
            try:
                m = int(ms)
            except Exception:
                m = 0
            if m <= 30:
                if orig_sleep_ms:
                    orig_sleep_ms(m)
                else:
                    orig_sleep(m / 1000.0)
                if should_stop():
                    raise _PyBotStop()
                return
            _checked_sleep(m / 1000.0)

        def _checked_sleep_us(us):
            if orig_sleep_us:
                orig_sleep_us(us)
            else:
                orig_sleep(us / 1000000.0)
            if should_stop():
                raise _PyBotStop()

        ns["wait"] = _checked_sleep
        ns["sleep"] = _checked_sleep

        patched = False
        try:
            time.sleep = _checked_sleep
            if orig_sleep_ms:
                time.sleep_ms = _checked_sleep_ms
            if orig_sleep_us:
                time.sleep_us = _checked_sleep_us
            patched = True
        except Exception:
            patched = False

        outcome = "done"
        err_text = None
        try:
            exec(code, ns)
        except _PyBotStop:
            outcome = "stopped"
        except Exception as e:
            outcome = "error"
            self._emit_err_exc(e)
            err_text = _exc_text(e)
        finally:
            if patched:
                try:
                    time.sleep = orig_sleep
                    if orig_sleep_ms:
                        time.sleep_ms = orig_sleep_ms
                    if orig_sleep_us:
                        time.sleep_us = orig_sleep_us
                except Exception:
                    pass
            self._cleanup(ns)
            self.running = False
            self._force = False
            self._finish(persistent, outcome, err_text)

    def _finish(self, persistent, outcome, err_text):
        if outcome == "stopped":
            self._send("RUN:STOPPED")
        else:
            self._send("RUN:DONE")
        if persistent:
            _update_app_run_state(outcome, err_text)


def _update_app_run_state(outcome, err_text):
    st = _load_state()
    if outcome == "error":
        st["fail_count"] = int(st.get("fail_count", 0)) + 1
        st["last_error"] = (err_text or "error")[:200]
        st["last_outcome"] = "error"
    else:
        st["fail_count"] = 0
        st["last_error"] = ""
        st["last_outcome"] = outcome
    _save_state(st)


class DeployReceiver:
    """Recibe la app persistente por BLE y la escribe de forma ATOMICA.

    Protocolo: DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash> -> DEPLOY:READY
      DEPLOY:CHUNK:<b64> (ACK por bloque: DEPLOY:ACK:<n>) ... DEPLOY:END ->
      DEPLOY:VERIFY:OK | DEPLOY:ERROR:<code>.

    Escribe a pybot_app.tmp, verifica size+hash (SHA-256), y solo entonces hace
    el reemplazo atomico de pybot_app.py + metadata. Si algo falla, borra el tmp
    y CONSERVA la app anterior intacta.
    """

    def __init__(self, send, manager):
        self._send = send
        self._manager = manager
        self._active = False
        self._fh = None
        self._mode = "mpy"
        self._profile = "WEMOS"
        self._size = 0
        self._hash = ""
        self._written = 0
        self._chunk_index = 0

    def begin(self, mode, profile, size, hexhash):
        if self._manager.running:
            self._send("DEPLOY:ERROR:BUSY")
            return
        if self._active:
            self._abort_file()
        m = mode if mode in ("mpy", "eda6") else None
        if m is None:
            self._send("DEPLOY:ERROR:INVALID_MODE")
            return
        if profile not in ("WEMOS", "ESP32"):
            self._send("DEPLOY:ERROR:INVALID_PROFILE")
            return
        try:
            sz = int(size)
        except Exception:
            self._send("DEPLOY:ERROR:BAD_FRAME")
            return
        if sz <= 0 or sz > MAX_DEPLOY_PROGRAM_SIZE:
            self._send("DEPLOY:ERROR:TOO_LONG")
            return
        _remove(_APP_TMP)
        try:
            self._fh = open(_APP_TMP, "wb")
        except Exception:
            self._send("DEPLOY:ERROR:WRITE_FAILED")
            return
        self._active = True
        self._mode = m
        self._profile = profile
        self._size = sz
        self._hash = (hexhash or "").lower()
        self._written = 0
        self._chunk_index = 0
        self._send("DEPLOY:READY")

    def chunk(self, b64):
        if not self._active:
            self._send("DEPLOY:ERROR:BAD_FRAME")
            return
        try:
            data = ubinascii.a2b_base64(b64)
        except Exception:
            self._fail("BAD_ENCODING")
            return
        self._written += len(data)
        if self._written > self._size:
            self._fail("TOO_LONG")
            return
        try:
            self._fh.write(data)
        except Exception:
            self._fail("WRITE_FAILED")
            return
        idx = self._chunk_index
        self._chunk_index += 1
        self._send("DEPLOY:ACK:%d" % idx)

    def end(self):
        if not self._active:
            self._send("DEPLOY:ERROR:BAD_FRAME")
            return
        try:
            self._fh.flush()
            self._fh.close()
        except Exception:
            pass
        self._fh = None
        self._active = False

        actual = _file_size(_APP_TMP)
        if actual != self._size:
            self._cleanup_tmp()
            self._send("DEPLOY:ERROR:VERIFY_FAILED")
            return
        if self._hash:
            digest = _sha256_file(_APP_TMP)
            # Si el port no tiene uhashlib, digest es None: no podemos verificar
            # el hash pero si el tamano (arriba). En ESP32 uhashlib esta presente.
            if digest is not None and digest != self._hash:
                self._cleanup_tmp()
                self._send("DEPLOY:ERROR:BAD_HASH")
                return
        if not self._commit():
            self._cleanup_tmp()
            self._send("DEPLOY:ERROR:WRITE_FAILED")
            return
        self._send("DEPLOY:VERIFY:OK")

    def abort(self):
        if self._active or self._fh:
            self._abort_file()

    def _abort_file(self):
        if self._fh:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._active = False
        self._cleanup_tmp()

    def _cleanup_tmp(self):
        _remove(_APP_TMP)

    def _fail(self, code):
        if self._fh:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._active = False
        self._cleanup_tmp()
        self._send("DEPLOY:ERROR:" + code)

    def _commit(self):
        """Reemplazo atomico: metadata + rename tmp->app. Conserva la anterior si falla."""
        meta = {
            "version": 3,
            "mode": self._mode,
            "profile": self._profile,
            "autostart": True,
            "size": self._size,
            "hash": self._hash,
            "runtime": PYBOT_RUNTIME_VERSION,
        }
        try:
            _remove(_APP_FILE)  # os.rename no reemplaza en algunos ports
            os.rename(_APP_TMP, _APP_FILE)
        except Exception:
            return False
        if not _write_json(_APP_META, meta):
            return False
        # Nueva app valida: resetear estado de fallos / safe boot.
        st = _load_state()
        st["fail_count"] = 0
        st["last_error"] = ""
        st["safe_boot"] = False
        _save_state(st)
        return True


def _app_info_json(manager):
    meta = _load_app_meta()
    st = _load_state()
    obj = {
        "installed": bool(meta) and _file_exists(_APP_FILE),
        "running": bool(manager.running and manager._persistent),
        "autostart": bool(meta.get("autostart")) if meta else False,
        "mode": (meta.get("mode") if meta else "") or "",
        "profile": (meta.get("profile") if meta else "") or "",
        "size": int(meta.get("size", 0)) if meta else 0,
        "hash": (meta.get("hash") if meta else "") or "",
        "safe": bool(st.get("safe_boot")),
        "fail": int(st.get("fail_count", 0)),
        "error": (st.get("last_error", "") or "")[:120],
    }
    try:
        return json.dumps(obj)
    except Exception:
        return "{}"


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
        if len(self._rx_buf) > _RX_BUF_MAX:
            self._rx_buf = bytearray()
            return
        while True:
            idx = self._rx_buf.find(b"\n")
            if idx < 0:
                break
            line = self._rx_buf[:idx]
            self._rx_buf = self._rx_buf[idx + 1:]
            self._dispatch(line)
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


def _maybe_autostart(manager):
    """Autostart en boot con proteccion de boot-loop (safe boot + fail_count)."""
    st = _load_state()
    if st.get("safe_boot"):
        # Se honra una vez: se limpia para que el proximo power cycle vuelva a
        # intentar el autostart (salvo que el usuario lo desactive).
        st["safe_boot"] = False
        _save_state(st)
        return
    if int(st.get("fail_count", 0)) >= _MAX_AUTOSTART_FAILS:
        return
    meta = _load_app_meta()
    if not meta or not meta.get("autostart"):
        return
    if not _file_exists(_APP_FILE):
        return
    manager.start_app()  # deja pending; el bucle principal lo ejecuta


def main():
    dev_id = device_id()
    dev_name = device_name()
    hardware = HardwareController()
    processor = CommandProcessor(hardware, dev_name, dev_id)

    holder = {}

    def _send(text):
        tr = holder.get("transport")
        if tr:
            tr.send(text)

    manager = ProgramManager(_send)
    deploy = DeployReceiver(_send, manager)

    def _force_reset():
        # Recuperacion REAL desde el IRQ (corre entre bytecodes -> corta cualquier
        # bucle). Marca safe boot para NO relanzar la app tras el reinicio.
        try:
            _set_safe_boot(True)
        except Exception:
            pass
        try:
            _send("RUN:STOPPED")
        except Exception:
            pass
        try:
            time.sleep_ms(60)
        except Exception:
            pass
        machine.reset()

    def _handle_app(cmd):
        if cmd == "APP:INFO":
            _send("APP:INFO:" + _app_info_json(manager))
        elif cmd == "APP:START":
            if manager.start_app():
                _send("APP:OK:START")
        elif cmd == "APP:STOP":
            manager.request_stop()
            _send("APP:OK:STOP")
        elif cmd == "APP:DELETE":
            manager.request_stop()
            _remove(_APP_FILE)
            _remove(_APP_META)
            _remove(_APP_TMP)
            st = _load_state()
            st["fail_count"] = 0
            st["last_error"] = ""
            st["safe_boot"] = False
            _save_state(st)
            _send("APP:OK:DELETE")
        elif cmd.startswith("APP:AUTOSTART:"):
            val = cmd[len("APP:AUTOSTART:"):].strip()
            meta = _load_app_meta()
            if not meta:
                _send("APP:ERROR:NO_APP")
                return
            meta["autostart"] = (val == "1")
            _write_json(_APP_META, meta)
            _send("APP:OK:AUTOSTART")
        else:
            _send("APP:ERROR:BAD_FRAME")

    def on_command(text):
        try:
            t = text.strip()
        except Exception:
            return "ERR,UNKNOWN_COMMAND"
        if not t:
            return None
        upper = t.upper()
        if upper == "STOP":
            manager.request_stop()
            return None
        if upper == "STOP:FORCE":
            if manager.running:
                manager.request_force_stop()
                _force_reset()  # no retorna
            return None
        if t.startswith("RUN:"):
            _handle_run(manager, t)
            return None
        if t.startswith("DEPLOY:"):
            _handle_deploy(deploy, t)
            return None
        if t.startswith("APP:"):
            _handle_app(t)
            return None
        return processor.process(t)

    def on_disconnect():
        # DEPLOY en curso -> cancelar (conserva la app anterior).
        deploy.abort()
        # RUN temporal -> detener al perder el controlador BLE.
        # APP persistente autonoma -> NO detener (ese es el punto).
        if manager.running and not manager._persistent:
            manager.request_stop()

    transport = BluetoothTransport(dev_name, on_command, on_disconnect)
    holder["transport"] = transport

    # Autostart de la app persistente (si corresponde) tras levantar el BLE.
    _maybe_autostart(manager)

    while True:
        if manager.pending and not manager.running:
            try:
                manager.run_pending()
            except Exception:
                manager.running = False
                manager.pending = False
                try:
                    _send("RUN:DONE")
                except Exception:
                    pass
        time.sleep_ms(50)


def _handle_run(manager, line):
    """Interpreta un frame RUN:* recibido de PyBot Web (RUN temporal)."""
    if line.startswith("RUN:BEGIN:"):
        rest = line[len("RUN:BEGIN:"):]
        parts = rest.split(":")
        mode = parts[0].strip().lower() if len(parts) >= 1 else "mpy"
        profile = parts[1].strip().upper() if len(parts) >= 2 else "WEMOS"
        manager.begin(mode, profile)
    elif line.startswith("RUN:CHUNK:"):
        manager.chunk(line[len("RUN:CHUNK:"):].strip())
    elif line == "RUN:END":
        manager.mark_end()
    else:
        manager._send("RUN:ERROR:BAD_FRAME")


def _handle_deploy(deploy, line):
    """Interpreta un frame DEPLOY:* (transferencia de la app persistente)."""
    if line.startswith("DEPLOY:BEGIN:"):
        rest = line[len("DEPLOY:BEGIN:"):]
        parts = rest.split(":")
        if len(parts) < 4:
            deploy._send("DEPLOY:ERROR:BAD_FRAME")
            return
        mode = parts[0].strip().lower()
        profile = parts[1].strip().upper()
        size = parts[2].strip()
        hexhash = parts[3].strip().lower()
        deploy.begin(mode, profile, size, hexhash)
    elif line.startswith("DEPLOY:CHUNK:"):
        deploy.chunk(line[len("DEPLOY:CHUNK:"):].strip())
    elif line == "DEPLOY:END":
        deploy.end()
    elif line == "DEPLOY:ABORT":
        deploy.abort()
    else:
        deploy._send("DEPLOY:ERROR:BAD_FRAME")


main()
