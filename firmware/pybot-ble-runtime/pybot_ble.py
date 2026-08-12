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

PYBOT_RUNTIME_VERSION = "3.2.6"
PYBOT_PROTOCOL_VERSION = "3.1"
PYBOT_RUNTIME_NAME = "PyBot BLE Runtime"
PYBOT_BOARD = "ESP32"
PYBOT_CAPABILITIES = ("run", "stop", "deploy", "app-control", "autostart", "runtime-update")

BUILTIN_LED_PIN = 2

MAX_COMMAND_LENGTH = const(96)
_TX_CHUNK = const(20)  # margen seguro para MTU BLE por defecto (23 -> 20 utiles)
_RX_BUF_MAX = const(600)  # una linea de protocolo (incluye DEPLOY:CHUNK) cabe holgada
# Sin prefijo _: en MicroPython, `_NAME = const(...)` se elimina del modulo y
# no se puede importar desde pybot_run / otros (ImportError al preload).
OUT_CHUNK = const(120)  # bytes de fuente por frame OUT antes de base64
MAX_RUN_B64 = const(12000)  # ~8 KB de fuente para RUN temporal (base64 ~1.34x)

MAX_RUN_PROGRAM_SIZE = const(8192)
MAX_DEPLOY_PROGRAM_SIZE = const(16384)

MAX_RUNTIME_UPDATE_SIZE = const(65536)

_RUNTIME_NEW = "pybot_runtime.new"
_RUNTIME_BAK = "pybot_runtime.bak"
_UPDATE_STATE = "pybot_update.json"
_RUNTIME_FILES = (
    "main.py",
    "pybot_ble.py",
    "pybot_run.py",
    "pybot_deploy.py",
    "pybot_update.py",
    "pybot_boot_update.py",
)
_RTBAK_SUFFIX = ".rtbak"

_MPY_LIB = "pybot_mpy"  # define pin/servo/motor/wait (GPIO directo)
_EDA6_LIB = "EDA6"      # define salidaDigital/servomotor/motorRC/... (EDA6)

_APP_FILE = "pybot_app.py"        # programa del alumno persistente
_APP_TMP = "pybot_app.tmp"        # escritura atomica: tmp -> verify -> rename
_APP_BAK = "pybot_app.bak"        # backup del programa anterior (rollback del commit)
_APP_META = "pybot_app.json"      # metadata: version/mode/profile/autostart/size/hash
_APP_META_TMP = "pybot_app.json.tmp"  # metadata transaccional (write -> verify -> rename)
_APP_META_BAK = "pybot_app.json.bak"  # backup de la metadata anterior (rollback)
_STATE_FILE = "pybot_state.json"  # safe boot + contador de fallos de autostart

_MAX_AUTOSTART_FAILS = const(3)

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)

_FLAG_READ = const(0x0002)
_FLAG_WRITE_NO_RESPONSE = const(0x0004)
_FLAG_WRITE = const(0x0008)
_FLAG_NOTIFY = const(0x0010)

_SERVICE_UUID = bluetooth.UUID("8fbc0001-4d5a-4b8c-9a1f-123456789001")
_RX_UUID = bluetooth.UUID("8fbc0002-4d5a-4b8c-9a1f-123456789002")
_TX_UUID = bluetooth.UUID("8fbc0003-4d5a-4b8c-9a1f-123456789003")

_RX_CHAR = (_RX_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE)
_TX_CHAR = (_TX_UUID, _FLAG_NOTIFY | _FLAG_READ)
_PYBOT_SERVICE = (_SERVICE_UUID, (_TX_CHAR, _RX_CHAR))

STATE_BOOT = "BOOT"
STATE_WAITING = "WAITING"
STATE_CONNECTED = "CONNECTED"
STATE_DISCONNECTED = "DISCONNECTED"

_NO_NL_COMMANDS = (
    "PING", "INFO", "LED,1", "LED,0", "STOP", "STOP:FORCE",
    "APP:INFO", "APP:START", "APP:STOP", "APP:DELETE",
    "UPDATE:INFO", "UPDATE:END", "UPDATE:APPLY", "UPDATE:ABORT",
)

_ADV_TYPE_FLAGS = const(0x01)
_ADV_TYPE_NAME = const(0x09)
_ADV_TYPE_UUID128_COMPLETE = const(0x07)

class _PyBotStop(Exception):
    pass

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
    st = _load_state()
    st["safe_boot"] = bool(flag)
    if not _save_state(st):
        return False
    check = _read_json(_STATE_FILE)
    return bool(check) and bool(check.get("safe_boot")) == bool(flag)

def _load_app_meta():
    return _read_json(_APP_META)

def _version_is_newer(candidate, current):
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
    try:
        st = os.statvfs("/")
        return st[0] * st[3]  # f_frsize * f_bavail
    except Exception:
        return -1

def _confirm_update_if_pending():
    st = _read_json(_UPDATE_STATE)
    if isinstance(st, dict) and st.get("state") == "applied":
        _remove(_RUNTIME_BAK)
        for name in _RUNTIME_FILES:
            _remove(name + _RTBAK_SUFFIX)
        _remove(_UPDATE_STATE)

def _advertising_payload(name=None, services=None):
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
    try:
        raw = ubinascii.hexlify(machine.unique_id()).decode()
    except Exception:
        raw = "000000000000"
    return raw[-6:].upper()

def device_name():
    return "PYBOT-" + device_id()

class HardwareController:

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

class BluetoothTransport:

    def __init__(self, name, on_command, on_disconnect=None, on_urgent=None):
        self._name = name
        self._on_command = on_command
        self._on_disconnect = on_disconnect
        # on_urgent(text) -> True si se consumio en IRQ (solo flags; SIN notify/sleep).
        self._on_urgent = on_urgent
        self.state = STATE_BOOT
        self._conn_handle = None
        self._rx_buf = bytearray()
        # Cola de lineas para el hilo principal. Evita gatts_notify+sleep dentro del
        # IRQ GATTS_WRITE (tras un Run puede tumbar el stack BLE y el 2.do READY).
        self._cmd_q = []

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
            # Encolar respuesta de error para enviarla fuera del IRQ.
            self._cmd_q.append("\x00ERR,BAD_ENCODING")
            return
        # STOP debe marcar el flag YA (el main puede estar bloqueado en exec).
        # Todo lo demas (RUN:BEGIN/READY, PING, INFO, ...) va al hilo principal.
        try:
            if self._on_urgent and self._on_urgent(text):
                return
        except Exception:
            pass
        self._cmd_q.append(text)

    def poll_commands(self):
        """Procesa la cola RX en el hilo principal (notify+sleep seguros)."""
        while self._cmd_q:
            text = self._cmd_q.pop(0)
            if text == "\x00ERR,BAD_ENCODING":
                self.send("ERR,BAD_ENCODING")
                continue
            try:
                response = self._on_command(text)
            except Exception:
                response = "ERR,INTERNAL"
            if response:
                self.send(response)

    def send(self, message):
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

_mod_run = None
_mod_deploy = None
_mod_update = None
_load_err_run = None
_load_err_deploy = None
_load_err_update = None

def _load_err_tag(exc):
    try:
        name = type(exc).__name__
    except Exception:
        name = "Error"
    try:
        msg = str(exc)
    except Exception:
        msg = ""
    tag = name if not msg else (name + ":" + msg)
    tag = tag.replace("\n", " ").replace("\r", " ")
    if len(tag) > 48:
        tag = tag[:48]
    return tag

def _load_run():
    global _mod_run, _load_err_run
    if _mod_run is None:
        try:
            import pybot_run as _m
            _mod_run = _m
            _load_err_run = None
        except Exception as e:
            _load_err_run = _load_err_tag(e)
            raise
    return _mod_run

def _load_deploy():
    global _mod_deploy, _load_err_deploy
    if _mod_deploy is None:
        try:
            import pybot_deploy as _m
            _mod_deploy = _m
            _load_err_deploy = None
        except Exception as e:
            _load_err_deploy = _load_err_tag(e)
            raise
    return _mod_deploy

def _load_update():
    global _mod_update, _load_err_update
    if _mod_update is None:
        try:
            import pybot_update as _m
            _mod_update = _m
            _load_err_update = None
        except Exception as e:
            _load_err_update = _load_err_tag(e)
            raise
    return _mod_update

def _maybe_autostart(manager):
    st = _load_state()
    # safe_boot sticky: no autostart y no se limpia aqui (solo APP:START/DEPLOY).
    if st.get("safe_boot"):
        return
    if int(st.get("fail_count", 0)) >= _MAX_AUTOSTART_FAILS:
        return
    meta = _load_app_meta()
    if not meta or not meta.get("autostart"):
        return
    if not _file_exists(_APP_FILE):
        return
    manager.start_app()

def main():
    dev_id = device_id()
    dev_name = device_name()
    hardware = HardwareController()
    processor = CommandProcessor(hardware, dev_name, dev_id)
    holder = {}
    ctx = {"manager": None, "deploy": None, "updater": None}

    def _send(text):
        tr = holder.get("transport")
        if tr:
            tr.send(text)

    def _ensure_manager():
        if ctx["manager"] is None:
            m = _load_run().ProgramManager(_send)
            # Callback via ctx: _cancel_force_reset se define mas abajo en main().
            def _coop_stop():
                fn = ctx.get("cancel_force")
                if fn:
                    fn()

            m._on_cooperative_stop = _coop_stop
            ctx["manager"] = m
        return ctx["manager"]

    def _ensure_deploy():
        if ctx["deploy"] is None:
            ctx["deploy"] = _load_deploy().DeployReceiver(_send, _ensure_manager())
        return ctx["deploy"]

    def _ensure_updater():
        if ctx["updater"] is None:
            ctx["updater"] = _load_update().RuntimeUpdateReceiver(
                _send, _ensure_manager(), _ensure_deploy()
            )
        return ctx["updater"]

    def _disable_autostart():
        try:
            meta = _load_app_meta()
            if meta and meta.get("autostart"):
                meta["autostart"] = False
                _write_json(_APP_META, meta)
        except Exception:
            pass

    def _force_reset():
        # Si APP:DELETE pidio borrar y el programa no cedia, borrar ANTES del reset.
        m = ctx.get("manager")
        if m and getattr(m, "_app_ack", None) == "delete":
            try:
                from pybot_deploy import _delete_app
                _delete_app()
            except Exception:
                pass
            try:
                m._app_ack = None
            except Exception:
                pass
        ok = False
        try:
            ok = _set_safe_boot(True)
        except Exception:
            ok = False
        # Siempre apagar autostart en FORCE: el aula no debe revivir el zombie
        # en el siguiente power-cycle aunque safe_boot se limpie.
        _disable_autostart()
        if not ok:
            _disable_autostart()
        try:
            _send("RUN:STOPPED")
        except Exception:
            pass
        try:
            time.sleep_ms(60)
        except Exception:
            pass
        machine.reset()

    def _cancel_force_reset():
        """Cancela un FORCE pendiente. Critico tras STOP cooperativo / nuevo RUN:
        un Timer huerfano haria machine.reset() y tumbaria el GATT en el 2º Run."""
        ctx["force_reset"] = False
        ctx["force_timer_armed"] = False
        t = ctx.get("force_timer")
        ctx["force_timer"] = None
        if t is not None:
            try:
                t.deinit()
            except Exception:
                pass

    def _schedule_force_reset():
        """Agenda reset fuera del IRQ. Critico: exec() bloquea el main loop, asi
        que un flag force_reset solo NO alcanza — hay que usar Timer."""
        ctx["force_reset"] = True
        if ctx.get("force_timer_armed"):
            return
        ctx["force_timer_armed"] = True

        def _cb(_t):
            ctx["force_timer"] = None
            ctx["force_timer_armed"] = False
            try:
                _force_reset()
            except Exception:
                try:
                    machine.reset()
                except Exception:
                    pass

        # Soft timer (-1) primero; hardware 0/1 como fallback en ports viejos.
        for timer_id in (-1, 0, 1):
            try:
                t = machine.Timer(timer_id)
                t.init(period=40, mode=machine.Timer.ONE_SHOT, callback=_cb)
                ctx["force_timer"] = t
                return
            except Exception:
                pass
        # Sin Timer: el main loop (si no esta en exec) todavia puede resetear.

    def on_urgent(text):
        """Solo flags / agenda Timer en IRQ: NUNCA notify/sleep/reset directo."""
        try:
            upper = text.strip().upper()
        except Exception:
            return False
        if upper == "STOP":
            m = ctx["manager"]
            if m:
                m.request_stop()
            return True
        if upper == "STOP:FORCE":
            m = ctx["manager"]
            if m:
                m.request_force_stop()
            # Siempre agendar: recuperacion real aunque exec() tenga el main ocupado.
            _schedule_force_reset()
            return True
        # APP:STOP/DELETE deben marcar flags YA: si van a la cola RX y el main
        # esta bloqueado en exec(), nunca se procesan → placa zombie (regresion 3.2.3).
        # 3.2.5: cualquier programa en exec (RUN temporal o app), no solo persistent.
        if upper == "APP:STOP":
            m = ctx["manager"]
            if m and m.running:
                m.request_app_stop("stop")
                return True
            return False
        if upper == "APP:DELETE":
            m = ctx["manager"]
            if m and m.running and m._persistent:
                m.request_app_stop("delete")
                return True
            return False
        return False

    def on_command(text):
        try:
            t = text.strip()
        except Exception:
            return "ERR,UNKNOWN_COMMAND"
        if not t:
            return None
        upper = t.upper()
        # STOP/FORCE ya se consumen en on_urgent; defensa si llegan a la cola.
        if upper == "STOP":
            m = ctx["manager"]
            if m:
                m.request_stop()
            return None
        if upper == "STOP:FORCE":
            m = ctx["manager"]
            if m:
                m.request_force_stop()
            _schedule_force_reset()
            return None
        if t.startswith("RUN:"):
            # Nuevo RUN del usuario: anular FORCE huerfano (Stop previo) para no
            # resetear la placa a mitad del handshake / chunks del 2º Run.
            if t.startswith("RUN:BEGIN:"):
                _cancel_force_reset()
            # Nunca silenciar fallos de lazy-import: el web espera RUN:READY.
            try:
                _load_run().handle_run(_ensure_manager(), t)
            except Exception as e:
                tag = _load_err_run or _load_err_tag(e)
                try:
                    _send("RUN:ERROR:LOAD:" + tag)
                except Exception:
                    pass
            return None
        if t.startswith("DEPLOY:"):
            try:
                _load_deploy().handle_deploy(_ensure_deploy(), t)
            except Exception as e:
                tag = _load_err_deploy or _load_err_tag(e)
                try:
                    _send("DEPLOY:ERROR:LOAD:" + tag)
                except Exception:
                    pass
            return None
        if t.startswith("APP:"):
            try:
                _load_deploy().handle_app(_send, _ensure_manager(), t)
            except Exception as e:
                tag = _load_err_deploy or _load_err_run or _load_err_tag(e)
                try:
                    _send("APP:ERROR:LOAD:" + tag)
                except Exception:
                    pass
            return None
        if t.startswith("UPDATE:"):
            try:
                _load_update().handle_update(_ensure_updater(), t)
            except Exception as e:
                tag = _load_err_update or _load_err_tag(e)
                try:
                    _send("UPDATE:ERROR:LOAD:" + tag)
                except Exception:
                    pass
            return None
        return processor.process(t)

    recovery = {"timer": None}
    ctx["force_reset"] = False
    ctx["force_timer_armed"] = False
    ctx["force_timer"] = None
    ctx["cancel_force"] = _cancel_force_reset

    def _arm_disconnect_recovery():
        try:
            t = recovery.get("timer")
            if t is None:
                t = machine.Timer(-1)
                recovery["timer"] = t

            def _cb(_t):
                tr = holder.get("transport")
                reconnected = tr is not None and tr.state == STATE_CONNECTED
                m = ctx["manager"]
                if m and m.running and not m._persistent and not reconnected:
                    _schedule_force_reset()

            t.init(period=1800, mode=machine.Timer.ONE_SHOT, callback=_cb)
        except Exception:
            pass

    def on_disconnect():
        d = ctx["deploy"]
        if d:
            d.abort()
        u = ctx["updater"]
        if u:
            u.abort()
        m = ctx["manager"]
        if m and m.running and not m._persistent:
            m.request_stop()
            _arm_disconnect_recovery()

    transport = BluetoothTransport(dev_name, on_command, on_disconnect, on_urgent)
    holder["transport"] = transport
    _confirm_update_if_pending()

    # Precargar pybot_run en el hilo principal DESPUÉS de advertising.
    # El import lazy dentro del IRQ GATTS_WRITE (stack/heap limitados) puede
    # fallar o colgarse: PING/INFO siguen OK pero RUN:BEGIN nunca emite READY.
    try:
        _ensure_manager()
    except Exception:
        pass

    try:
        need = (
            _file_exists(_APP_TMP)
            or _file_exists(_APP_META_TMP)
            or _file_exists(_APP_BAK)
            or _file_exists(_APP_META_BAK)
            or (not _file_exists(_APP_FILE) and _file_exists(_APP_BAK))
            or (not _file_exists(_APP_META) and _file_exists(_APP_META_BAK))
        )
        if need:
            _load_deploy().recover_incomplete_deploy()
    except Exception:
        pass

    try:
        st = _load_state()
        # safe_boot STICKY: no autostart y NO se limpia aqui. Solo APP:START /
        # DEPLOY nuevo / clear USB lo quitan. Evita que un power-cycle reviva
        # el programa problematico tras STOP:FORCE.
        if st.get("safe_boot"):
            pass
        elif int(st.get("fail_count", 0)) < _MAX_AUTOSTART_FAILS:
            meta = _load_app_meta()
            if meta and meta.get("autostart") and _file_exists(_APP_FILE):
                _maybe_autostart(_ensure_manager())
    except Exception:
        pass

    while True:
        try:
            if ctx.get("force_reset"):
                ctx["force_reset"] = False
                _force_reset()
            transport.poll_commands()
            m = ctx["manager"]
            if m and m.pending and not m.running:
                try:
                    m.run_pending()
                except Exception:
                    m.running = False
                    m.pending = False
                    try:
                        m.reset_idle()
                    except Exception:
                        pass
                    try:
                        _send("RUN:DONE")
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            time.sleep_ms(20)
        except Exception:
            pass
