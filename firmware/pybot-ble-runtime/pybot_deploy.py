import os
import ubinascii
from pybot_ble import (
    MAX_DEPLOY_PROGRAM_SIZE,
    PYBOT_RUNTIME_VERSION,
    _APP_BAK,
    _APP_FILE,
    _APP_META,
    _APP_META_BAK,
    _APP_META_TMP,
    _APP_TMP,
    _file_exists,
    _file_size,
    _load_app_meta,
    _load_state,
    _remove,
    _read_json,
    _save_state,
    _sha256_file,
    _write_json,
    uhashlib,
)

def _rename(src, dst):
    try:
        os.rename(src, dst)
        return True
    except Exception:
        return False

def _atomic_install_app(meta, expected_size):
    _remove(_APP_META_TMP)
    if not _write_json(_APP_META_TMP, meta) or _read_json(_APP_META_TMP) is None:
        _remove(_APP_META_TMP)
        return False

    had_app = _file_exists(_APP_FILE)
    had_meta = _file_exists(_APP_META)
    _remove(_APP_BAK)
    _remove(_APP_META_BAK)

    if had_app and not _rename(_APP_FILE, _APP_BAK):
        _remove(_APP_META_TMP)
        return False

    if not _rename(_APP_TMP, _APP_FILE):
        if had_app:
            _rename(_APP_BAK, _APP_FILE)  # restaurar la anterior
        _remove(_APP_META_TMP)
        return False

    if had_meta:
        _rename(_APP_META, _APP_META_BAK)

    if not _rename(_APP_META_TMP, _APP_META):
        _remove(_APP_FILE)
        if had_app:
            _rename(_APP_BAK, _APP_FILE)
        if had_meta:
            _rename(_APP_META_BAK, _APP_META)
        _remove(_APP_META_TMP)
        return False

    if _file_size(_APP_FILE) != expected_size or _read_json(_APP_META) is None:
        _remove(_APP_FILE)
        _remove(_APP_META)
        if had_app:
            _rename(_APP_BAK, _APP_FILE)
        if had_meta:
            _rename(_APP_META_BAK, _APP_META)
        return False

    _remove(_APP_BAK)
    _remove(_APP_META_BAK)
    st = _load_state()
    st["fail_count"] = 0
    st["last_error"] = ""
    st["safe_boot"] = False
    _save_state(st)
    return True

def _delete_app():
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
    if _file_exists(_APP_FILE) or _file_exists(_APP_META):
        return False
    return True

def _recover_incomplete_deploy():
    if not _file_exists(_APP_FILE) and _file_exists(_APP_BAK):
        _rename(_APP_BAK, _APP_FILE)
    if not _file_exists(_APP_META) and _file_exists(_APP_META_BAK):
        _rename(_APP_META_BAK, _APP_META)
    _remove(_APP_TMP)
    _remove(_APP_META_TMP)
    _remove(_APP_BAK)
    _remove(_APP_META_BAK)

class DeployReceiver:

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

def recover_incomplete_deploy():
    _recover_incomplete_deploy()

def handle_deploy(deploy, line):
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

def handle_app(send, manager, cmd):
    if cmd == "APP:INFO":
        send("APP:INFO:" + _app_info_json(manager))
    elif cmd == "APP:START":
        if manager.start_app():
            send("APP:OK:START")
    elif cmd == "APP:STOP":
        # Cualquier exec en curso (RUN temporal o app): pedir stop y ACK diferido
        # en _finish. Evita APP:OK:STOP falso mientras el programa sigue vivo.
        if manager.running:
            manager.request_app_stop("stop")
        elif manager.pending:
            manager.pending = False
            try:
                manager.reset_idle()
            except Exception:
                pass
            send("APP:OK:STOP")
        else:
            send("APP:OK:STOP")
    elif cmd == "APP:DELETE":
        if manager.running and manager._persistent:
            manager.request_app_stop("delete")
        elif _delete_app():
            send("APP:OK:DELETE")
        else:
            send("APP:ERROR:DELETE_FAILED")
    elif cmd.startswith("APP:AUTOSTART:"):
        val = cmd[len("APP:AUTOSTART:"):].strip()
        meta = _load_app_meta()
        if not meta:
            send("APP:ERROR:NO_APP")
            return
        meta["autostart"] = (val == "1")
        if _write_json(_APP_META, meta):
            send("APP:OK:AUTOSTART")
        else:
            send("APP:ERROR:WRITE_FAILED")
    else:
        send("APP:ERROR:BAD_FRAME")
