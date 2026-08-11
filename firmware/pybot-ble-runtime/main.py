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
# FUENTE DE VERDAD: esta version debe coincidir con PYBOT_RUNTIME_VERSION en
# src/bleProtocol.js (la web publica la MISMA version y compara contra la INFO
# instalada para ofrecer la actualizacion OTA por BLE).
PYBOT_RUNTIME_VERSION = "3.1.0"
# Protocolo 3.0: agrega STOP confiable (RUN:STOPPED + STOP:FORCE), DEPLOY
# persistente verificado, control de app (APP:*) y autostart con safe boot.
# 3.0.1 (compatible): DEPLOY realmente transaccional con backup/rollback,
# HASH obligatorio si se declara (DEPLOY:ERROR:HASH_UNAVAILABLE), APP:STOP/DELETE
# confirmados de verdad (detienen antes de responder) y errores de filesystem
# explicitos (APP:ERROR:WRITE_FAILED / DELETE_FAILED). El framing NO cambia.
# 3.1 (extension COMPATIBLE): actualizacion OTA del propio runtime por BLE
# (UPDATE:*), verificada por SHA-256, con apply transaccional en boot.py y
# rollback. Aditivo: no cambia RUN/DEPLOY/APP. La capability "runtime-update"
# permite a la web decidir por capabilities (no por numero de version).
PYBOT_PROTOCOL_VERSION = "3.1"
PYBOT_RUNTIME_NAME = "PyBot BLE Runtime"
PYBOT_BOARD = "ESP32"
# Capacidades declaradas en INFO para que la web prefiera capabilities sobre
# inferencias fragiles por numero de version.
PYBOT_CAPABILITIES = ("run", "stop", "deploy", "app-control", "autostart", "runtime-update")

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

# Tamano maximo del RUNTIME nuevo para una actualizacion OTA (bytes de fuente
# UTF-8). Holgado para el runtime actual (~45 KB) sin agotar el filesystem. Debe
# coincidir con MAX_RUNTIME_UPDATE_SIZE en src/bleProtocol.js.
MAX_RUNTIME_UPDATE_SIZE = const(65536)

# Archivos del canal de actualizacion OTA (los gestiona boot.py en el arranque):
#   - pybot_runtime.new : runtime nuevo descargado por BLE (NUNCA es main.py hasta
#                         que boot.py lo instala tras verificar).
#   - pybot_runtime.bak : backup del main.py anterior (para rollback).
#   - pybot_update.json : estado del update (pending/applied/...).
_RUNTIME_NEW = "pybot_runtime.new"
_RUNTIME_BAK = "pybot_runtime.bak"
_UPDATE_STATE = "pybot_update.json"

# Preludios instalados en la placa (por USB) que el runtime importa al ejecutar.
_MPY_LIB = "pybot_mpy"  # define pin/servo/motor/wait (GPIO directo)
_EDA6_LIB = "EDA6"      # define salidaDigital/servomotor/motorRC/... (EDA6)

# Archivos de la app persistente y estado (NO se tocan al actualizar el runtime).
_APP_FILE = "pybot_app.py"        # programa del alumno persistente
_APP_TMP = "pybot_app.tmp"        # escritura atomica: tmp -> verify -> rename
_APP_BAK = "pybot_app.bak"        # backup del programa anterior (rollback del commit)
_APP_META = "pybot_app.json"      # metadata: version/mode/profile/autostart/size/hash
_APP_META_TMP = "pybot_app.json.tmp"  # metadata transaccional (write -> verify -> rename)
_APP_META_BAK = "pybot_app.json.bak"  # backup de la metadata anterior (rollback)
_STATE_FILE = "pybot_state.json"  # safe boot + contador de fallos de autostart

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
    "UPDATE:INFO", "UPDATE:END", "UPDATE:APPLY", "UPDATE:ABORT",
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
    return _write_json(_STATE_FILE, st)


def _set_safe_boot(flag):
    """Persiste el flag safe_boot y CONFIRMA el write releyendo el archivo.
    Devuelve True solo si quedo escrito (usado antes de un reset para no
    relanzar una app problematica sabiendo que el flag pudo no persistir)."""
    st = _load_state()
    st["safe_boot"] = bool(flag)
    if not _save_state(st):
        return False
    check = _read_json(_STATE_FILE)
    return bool(check) and bool(check.get("safe_boot")) == bool(flag)


def _load_app_meta():
    return _read_json(_APP_META)


def _version_is_newer(candidate, current):
    """True si `candidate` es ESTRICTAMENTE mayor que `current` ("x.y.z").
    Tolerante: partes no numericas o faltantes cuentan como 0. Se usa para
    rechazar una actualizacion a la misma version o mas vieja (UPDATE BAD_VERSION).
    """
    def _parse(v):
        out = []
        for p in str(v).split("."):
            try:
                out.append(int(p))
            except Exception:
                out.append(0)
        return out
    a = _parse(candidate)
    b = _parse(current)
    n = len(a) if len(a) > len(b) else len(b)
    for i in range(n):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        if x > y:
            return True
        if x < y:
            return False
    return False


def _fs_free_bytes():
    """Bytes libres del filesystem raiz, o -1 si statvfs no esta disponible."""
    try:
        st = os.statvfs("/")
        return st[0] * st[3]  # f_frsize * f_bavail
    except Exception:
        return -1


def _confirm_update_if_pending():
    """Confirmacion de arranque del OTA: se llama SOLO cuando el runtime ya
    importo OK, levanto BLE y registro GATT (quedo operacional). Si venimos de un
    update recien aplicado (state 'applied'), limpiar el estado y borrar el backup:
    a partir de aca no hay rollback posible. Si el runtime nuevo hubiera fallado en
    importar/levantar BLE, esto NO se ejecutaria y el proximo boot haria rollback.
    """
    st = _read_json(_UPDATE_STATE)
    if isinstance(st, dict) and st.get("state") == "applied":
        _remove(_RUNTIME_BAK)
        _remove(_UPDATE_STATE)


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
        # Accion a CONFIRMAR cuando termine una app persistente detenida a pedido:
        #   "stop"   -> responder APP:OK:STOP (solo cuando realmente paro)
        #   "delete" -> borrar la app y responder APP:OK:DELETE / APP:ERROR:DELETE_FAILED
        self._app_ack = None

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

    def request_app_stop(self, action):
        """Pide detener la app persistente y DIFIERE la confirmacion (APP:OK:STOP /
        APP:OK:DELETE) hasta que realmente termine (RUN:STOPPED en _finish). Asi el
        ACK significa 'detenida de verdad', no 'pedido recibido'."""
        self._stop = True
        self._app_ack = action

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
        # Confirmacion diferida de APP:STOP / APP:DELETE: recien ahora la app
        # esta DETENIDA de verdad, asi que respondemos (o borramos + respondemos).
        ack = self._app_ack
        self._app_ack = None
        if ack == "stop":
            self._send("APP:OK:STOP")
        elif ack == "delete":
            if _delete_app():
                self._send("APP:OK:DELETE")
            else:
                self._send("APP:ERROR:DELETE_FAILED")


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


def _rename(src, dst):
    try:
        os.rename(src, dst)
        return True
    except Exception:
        return False


def _atomic_install_app(meta, expected_size):
    """Reemplazo REALMENTE transaccional de pybot_app.py + pybot_app.json.

    Esquema de backup (pybot_app.py / .bak / .tmp y pybot_app.json / .tmp / .bak):
      0) metadata nueva -> pybot_app.json.tmp (y se verifica releyendola)
      1) si hay app actual: pybot_app.py -> pybot_app.bak
      2) pybot_app.tmp -> pybot_app.py
      3) si hay metadata actual: pybot_app.json -> pybot_app.json.bak
      4) pybot_app.json.tmp -> pybot_app.json
      5) verificar app (size) + metadata (relegible) -> si algo falla, RESTAURAR.
      6) exito: borrar backups y resetear estado de fallos / safe boot.
    Nunca se queda sin una app valida si habia una, ni con programa nuevo + metadata
    vieja (o al reves): programa y metadata SIEMPRE se corresponden.
    """
    # 0) metadata transaccional: escribir tmp y confirmar que se relee.
    _remove(_APP_META_TMP)
    if not _write_json(_APP_META_TMP, meta) or _read_json(_APP_META_TMP) is None:
        _remove(_APP_META_TMP)
        return False

    had_app = _file_exists(_APP_FILE)
    had_meta = _file_exists(_APP_META)
    _remove(_APP_BAK)
    _remove(_APP_META_BAK)

    # 1) backup de la app actual.
    if had_app and not _rename(_APP_FILE, _APP_BAK):
        _remove(_APP_META_TMP)
        return False

    # 2) activar la app nueva.
    if not _rename(_APP_TMP, _APP_FILE):
        if had_app:
            _rename(_APP_BAK, _APP_FILE)  # restaurar la anterior
        _remove(_APP_META_TMP)
        return False

    # 3) backup de la metadata actual.
    if had_meta:
        _rename(_APP_META, _APP_META_BAK)

    # 4) activar la metadata nueva.
    if not _rename(_APP_META_TMP, _APP_META):
        # revertir app y metadata para no quedar con nuevo+vieja.
        _remove(_APP_FILE)
        if had_app:
            _rename(_APP_BAK, _APP_FILE)
        if had_meta:
            _rename(_APP_META_BAK, _APP_META)
        _remove(_APP_META_TMP)
        return False

    # 5) verificar correspondencia app + metadata.
    if _file_size(_APP_FILE) != expected_size or _read_json(_APP_META) is None:
        _remove(_APP_FILE)
        _remove(_APP_META)
        if had_app:
            _rename(_APP_BAK, _APP_FILE)
        if had_meta:
            _rename(_APP_META_BAK, _APP_META)
        return False

    # 6) exito: limpiar backups y estado.
    _remove(_APP_BAK)
    _remove(_APP_META_BAK)
    st = _load_state()
    st["fail_count"] = 0
    st["last_error"] = ""
    st["safe_boot"] = False
    _save_state(st)
    return True


def _delete_app():
    """Borra pybot_app.py + metadata (NO el runtime) y VERIFICA la ausencia.
    Devuelve True solo si ambos archivos ya no existen. Limpia estado."""
    _remove(_APP_TMP)
    _remove(_APP_BAK)
    _remove(_APP_META_TMP)
    _remove(_APP_META_BAK)
    if _file_exists(_APP_FILE):
        _remove(_APP_FILE)
    if _file_exists(_APP_META):
        _remove(_APP_META)
    st = _load_state()
    st["fail_count"] = 0
    st["last_error"] = ""
    st["safe_boot"] = False
    _save_state(st)
    # Sin exito ficticio: confirmar que realmente se borro.
    if _file_exists(_APP_FILE) or _file_exists(_APP_META):
        return False
    return True


def _recover_incomplete_deploy():
    """Si un DEPLOY se corto entre pasos (corte de energia), dejar un estado
    consistente al boot: restaurar la app/metadata anterior desde el backup y
    limpiar temporales. Se llama antes del autostart."""
    if not _file_exists(_APP_FILE) and _file_exists(_APP_BAK):
        _rename(_APP_BAK, _APP_FILE)
    if not _file_exists(_APP_META) and _file_exists(_APP_META_BAK):
        _rename(_APP_META_BAK, _APP_META)
    _remove(_APP_TMP)
    _remove(_APP_META_TMP)
    _remove(_APP_BAK)
    _remove(_APP_META_BAK)


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
            # HASH obligatorio si se declaro: si uhashlib no esta disponible no
            # podemos verificar la integridad criptografica, asi que NO afirmamos
            # una verificacion que no ocurrio: se rechaza con HASH_UNAVAILABLE y la
            # app anterior queda intacta. En ESP32 uhashlib esta presente.
            if digest is None:
                self._cleanup_tmp()
                self._send("DEPLOY:ERROR:HASH_UNAVAILABLE")
                return
            if digest != self._hash:
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
        """Reemplazo REALMENTE transaccional (con backup/rollback). Conserva la
        app anterior intacta si algo falla; nunca deja programa nuevo + metadata
        vieja. Ver _atomic_install_app."""
        meta = {
            "version": 3,
            "mode": self._mode,
            "profile": self._profile,
            "autostart": True,
            "size": self._size,
            "hash": self._hash,
            "runtime": PYBOT_RUNTIME_VERSION,
        }
        return _atomic_install_app(meta, self._size)


class RuntimeUpdateReceiver:
    """Recibe por BLE un runtime NUEVO (main.py) y lo actualiza de forma segura.

    Protocolo (canal ADMINISTRATIVO, no educativo):
      UPDATE:INFO                          -> UPDATE:INFO:<json>
      UPDATE:BEGIN:<version>:<size>:<hash> -> UPDATE:READY | UPDATE:ERROR:<code>
      UPDATE:CHUNK:<b64>  (por bloque)     -> UPDATE:ACK:<n> | UPDATE:ERROR:<code>
      UPDATE:END                           -> UPDATE:VERIFY:OK | UPDATE:ERROR:<code>
      UPDATE:APPLY                         -> UPDATE:APPLYING (la placa resetea)

    NUNCA sobrescribe main.py durante la transferencia: descarga completo a
    pybot_runtime.new, verifica size + SHA-256, y solo en APPLY escribe
    pybot_update.json (state pending) y hace machine.reset(): el swap con backup y
    rollback lo hace boot.py en el proximo arranque. Antes de actualizar hay que
    estar en estado seguro (sin RUN/APP corriendo ni DEPLOY en curso): si no, BUSY.
    """

    def __init__(self, send, manager, deploy):
        self._send = send
        self._manager = manager
        self._deploy = deploy
        self._active = False
        self._fh = None
        self._version = ""
        self._size = 0
        self._hash = ""
        self._written = 0
        self._chunk_index = 0
        self._verified = False

    def _busy(self):
        # Estado seguro: no actualizar con un programa (RUN temporal o APP
        # persistente) corriendo ni con un DEPLOY en curso.
        if self._manager.running:
            return True
        if getattr(self._deploy, "_active", False):
            return True
        return False

    def info(self):
        has_hash = uhashlib is not None
        st = _read_json(_UPDATE_STATE)
        state = st.get("state") if isinstance(st, dict) else "idle"
        return (
            'UPDATE:INFO:{"runtime":"%s","protocol":"%s","max":%d,'
            '"hash":%s,"state":"%s"}'
            % (
                PYBOT_RUNTIME_VERSION,
                PYBOT_PROTOCOL_VERSION,
                MAX_RUNTIME_UPDATE_SIZE,
                "true" if has_hash else "false",
                state or "idle",
            )
        )

    def begin(self, version, size, hexhash):
        if self._busy():
            self._send("UPDATE:ERROR:BUSY")
            return
        if self._active:
            self._abort_file()
        v = (version or "").strip()
        # Rechazar version invalida o que NO sea mas nueva que la instalada.
        if not v or not _version_is_newer(v, PYBOT_RUNTIME_VERSION):
            self._send("UPDATE:ERROR:BAD_VERSION")
            return
        try:
            sz = int(size)
        except Exception:
            self._send("UPDATE:ERROR:BAD_FRAME")
            return
        if sz <= 0 or sz > MAX_RUNTIME_UPDATE_SIZE:
            self._send("UPDATE:ERROR:TOO_LONG")
            return
        # Verificar espacio si el port expone statvfs (si no, no afirmar NO_SPACE:
        # el open/write fallara con WRITE_FAILED si realmente no hay lugar).
        free = _fs_free_bytes()
        if free >= 0 and free < (sz + 4096):
            self._send("UPDATE:ERROR:NO_SPACE")
            return
        _remove(_RUNTIME_NEW)
        try:
            self._fh = open(_RUNTIME_NEW, "wb")
        except Exception:
            self._send("UPDATE:ERROR:WRITE_FAILED")
            return
        self._active = True
        self._version = v
        self._size = sz
        self._hash = (hexhash or "").lower()
        self._written = 0
        self._chunk_index = 0
        self._verified = False
        self._send("UPDATE:READY")

    def chunk(self, b64):
        if not self._active:
            self._send("UPDATE:ERROR:BAD_FRAME")
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
        self._send("UPDATE:ACK:%d" % idx)

    def end(self):
        if not self._active:
            self._send("UPDATE:ERROR:BAD_FRAME")
            return
        try:
            self._fh.flush()
            self._fh.close()
        except Exception:
            pass
        self._fh = None
        self._active = False

        actual = _file_size(_RUNTIME_NEW)
        if actual != self._size:
            self._cleanup()
            self._send("UPDATE:ERROR:VERIFY_FAILED")
            return
        if self._hash:
            digest = _sha256_file(_RUNTIME_NEW)
            # HASH obligatorio si se declaro: sin uhashlib no podemos verificar la
            # integridad, asi que NO afirmamos una verificacion que no ocurrio.
            if digest is None:
                self._cleanup()
                self._send("UPDATE:ERROR:HASH_UNAVAILABLE")
                return
            if digest != self._hash:
                self._cleanup()
                self._send("UPDATE:ERROR:BAD_HASH")
                return
        self._verified = True
        self._send("UPDATE:VERIFY:OK")

    def apply(self):
        # Solo tras VERIFY:OK, con el .new presente y del tamano correcto.
        if not self._verified or not _file_exists(_RUNTIME_NEW):
            self._send("UPDATE:ERROR:BAD_FRAME")
            return
        if _file_size(_RUNTIME_NEW) != self._size:
            self._cleanup()
            self._send("UPDATE:ERROR:VERIFY_FAILED")
            return
        st = {
            "state": "pending",
            "from": PYBOT_RUNTIME_VERSION,
            "to": self._version,
            "size": self._size,
            "hash": self._hash,
        }
        # Confirmar que el estado quedo persistido ANTES de resetear (si no, boot.py
        # no aplicaria y quedariamos con el runtime viejo, sin corrupcion).
        if not _write_json(_UPDATE_STATE, st) or _read_json(_UPDATE_STATE) is None:
            self._send("UPDATE:ERROR:WRITE_FAILED")
            return
        self._send("UPDATE:APPLYING")
        try:
            time.sleep_ms(80)  # dar tiempo a que salga el frame por BLE
        except Exception:
            pass
        machine.reset()  # boot.py hara el swap con backup + rollback

    def abort(self):
        if self._active or self._fh:
            self._abort_file()
        self._verified = False

    def _abort_file(self):
        if self._fh:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._active = False
        self._cleanup()

    def _cleanup(self):
        _remove(_RUNTIME_NEW)

    def _fail(self, code):
        if self._fh:
            try:
                self._fh.close()
            except Exception:
                pass
        self._fh = None
        self._active = False
        self._verified = False
        self._cleanup()
        self._send("UPDATE:ERROR:" + code)


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
    updater = RuntimeUpdateReceiver(_send, manager, deploy)

    def _force_reset():
        # Recuperacion REAL desde el IRQ (soft-callback: corre entre bytecodes ->
        # corta cualquier bucle, incluso `while True: pass`). El reset por hardware
        # ES el mecanismo final de recuperacion: al reiniciar, todos los GPIO/PWM
        # vuelven a su estado por defecto (entradas), por lo que el hardware queda
        # seguro sin ejecutar cleanup complejo dentro del IRQ (que seria arriesgado).
        # Antes del reset marcamos SAFE BOOT para NO relanzar la app problematica.
        ok = False
        try:
            ok = _set_safe_boot(True)
        except Exception:
            ok = False
        if not ok:
            # Fallback seguro (P1-2): si no se pudo persistir safe_boot, intentar
            # desactivar el autostart para no relanzar la app tras el reset. El
            # fail_count (3 fallos) sigue siendo la ultima red de seguridad.
            try:
                meta = _load_app_meta()
                if meta:
                    meta["autostart"] = False
                    _write_json(_APP_META, meta)
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
            # APP:OK:STOP debe significar "detenida de verdad": si hay una app
            # persistente corriendo, DIFERIMOS el ACK hasta que realmente pare
            # (RUN:STOPPED en _finish). Si no hay nada persistente corriendo, ya
            # esta detenida. Un bucle que no cede no respondera: la web escala a
            # STOP:FORCE (timeout) para la recuperacion real.
            if manager.running and manager._persistent:
                manager.request_app_stop("stop")
            else:
                _send("APP:OK:STOP")
        elif cmd == "APP:DELETE":
            # Detener antes de borrar: si la app corre, se detiene y el borrado +
            # APP:OK:DELETE ocurre al terminar (_finish). Si no corre, borramos ya
            # y verificamos la ausencia (sin exito ficticio).
            if manager.running and manager._persistent:
                manager.request_app_stop("delete")
            elif _delete_app():
                _send("APP:OK:DELETE")
            else:
                _send("APP:ERROR:DELETE_FAILED")
        elif cmd.startswith("APP:AUTOSTART:"):
            val = cmd[len("APP:AUTOSTART:"):].strip()
            meta = _load_app_meta()
            if not meta:
                _send("APP:ERROR:NO_APP")
                return
            meta["autostart"] = (val == "1")
            # No afirmar OK si la persistencia fallo.
            if _write_json(_APP_META, meta):
                _send("APP:OK:AUTOSTART")
            else:
                _send("APP:ERROR:WRITE_FAILED")
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
        if t.startswith("UPDATE:"):
            _handle_update(updater, t)
            return None
        return processor.process(t)

    recovery = {"timer": None}

    def _arm_disconnect_recovery():
        # Watchdog de recuperacion (P0-11): si tras perder el BLE un RUN TEMPORAL
        # no cede al STOP cooperativo en una ventana corta, forzamos un reset para
        # recuperar la placa SIN desenchufar. Se usa un soft timer (id=-1): su
        # callback corre entre bytecodes (como el IRQ BLE), por eso puede cortar
        # incluso `while True: pass`. Solo actua si seguimos desconectados y el
        # programa temporal sigue vivo (un stop cooperativo ya lo habria terminado).
        try:
            t = recovery.get("timer")
            if t is None:
                t = machine.Timer(-1)
                recovery["timer"] = t

            def _cb(_t):
                tr = holder.get("transport")
                reconnected = tr is not None and tr.state == STATE_CONNECTED
                if manager.running and not manager._persistent and not reconnected:
                    _force_reset()  # no retorna

            t.init(period=1800, mode=machine.Timer.ONE_SHOT, callback=_cb)
        except Exception:
            # Si el port no soporta Timer, queda el STOP cooperativo (cubre los
            # programas con wait()); un bucle 100% tight sin controlador requeriria
            # power cycle. Documentado como limitacion.
            pass

    def on_disconnect():
        # DEPLOY en curso -> cancelar (conserva la app anterior).
        deploy.abort()
        # UPDATE en curso -> cancelar (borra el .new incompleto; main.py intacto).
        updater.abort()
        # RUN temporal -> detener al perder el controlador BLE (cooperativo) y
        # armar el watchdog de reset por si el programa no cede.
        # APP persistente autonoma -> NO detener (ese es el punto).
        if manager.running and not manager._persistent:
            manager.request_stop()
            _arm_disconnect_recovery()

    transport = BluetoothTransport(dev_name, on_command, on_disconnect)
    holder["transport"] = transport

    # CONFIRMACION DE ARRANQUE del OTA: el runtime ya importo OK, levanto BLE y
    # registro el GATT (quedo operacional). Si venimos de un update recien
    # aplicado por boot.py, confirmarlo aca (limpia el estado + borra el backup).
    # Si el runtime nuevo hubiera fallado antes de este punto, esto no correria y
    # el proximo boot haria rollback al runtime anterior.
    _confirm_update_if_pending()

    # Si un DEPLOY quedo a medias por un corte de energia, restaurar un estado
    # consistente (app/metadata anterior desde el backup) y limpiar temporales.
    _recover_incomplete_deploy()

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


def _handle_update(updater, line):
    """Interpreta un frame UPDATE:* (actualizacion OTA del runtime por BLE)."""
    if line == "UPDATE:INFO":
        updater._send(updater.info())
    elif line.startswith("UPDATE:BEGIN:"):
        rest = line[len("UPDATE:BEGIN:"):]
        parts = rest.split(":")
        if len(parts) < 3:
            updater._send("UPDATE:ERROR:BAD_FRAME")
            return
        version = parts[0].strip()
        size = parts[1].strip()
        hexhash = parts[2].strip().lower()
        updater.begin(version, size, hexhash)
    elif line.startswith("UPDATE:CHUNK:"):
        updater.chunk(line[len("UPDATE:CHUNK:"):].strip())
    elif line == "UPDATE:END":
        updater.end()
    elif line == "UPDATE:APPLY":
        updater.apply()
    elif line == "UPDATE:ABORT":
        updater.abort()
    else:
        updater._send("UPDATE:ERROR:BAD_FRAME")


main()
