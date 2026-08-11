import sys
import time
import ubinascii
from pybot_ble import (
    MAX_RUN_B64,
    OUT_CHUNK,
    _APP_FILE,
    _EDA6_LIB,
    _MPY_LIB,
    _PyBotStop,
    _file_exists,
    _load_app_meta,
    _load_state,
    _save_state,
)

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

class _StrSink:

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
        self._app_ack = None

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
        if self._b64_len > MAX_RUN_B64:
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
        self._stop = True
        self._app_ack = action

    def request_force_stop(self):
        self._stop = True
        self._force = True

    def should_stop(self):
        return self._stop

    def _emit_frames(self, tag, text):
        try:
            data = text.encode("utf-8")
        except Exception:
            return
        for i in range(0, len(data), OUT_CHUNK):
            piece = data[i:i + OUT_CHUNK]
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
                try:
                    mod_eda6.detenerTodo()
                except Exception:
                    pass
            mod_mpy = __import__(_MPY_LIB)
            for k in dir(mod_mpy):
                if not k.startswith("_"):
                    ns[k] = getattr(mod_mpy, k)
            return True
        except Exception as e:
            self._emit_err_exc(e)
            return False

    def _cleanup(self, ns):
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
        ack = self._app_ack
        self._app_ack = None
        if ack == "stop":
            self._send("APP:OK:STOP")
        elif ack == "delete":
            from pybot_deploy import _delete_app
            if _delete_app():
                self._send("APP:OK:DELETE")
            else:
                self._send("APP:ERROR:DELETE_FAILED")

def handle_run(manager, line):
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
