import machine
import time
import ubinascii
from pybot_ble import (
    MAX_RUNTIME_UPDATE_SIZE,
    PYBOT_PROTOCOL_VERSION,
    PYBOT_RUNTIME_VERSION,
    _RUNTIME_NEW,
    _UPDATE_STATE,
    _file_exists,
    _file_size,
    _fs_free_bytes,
    _read_json,
    _remove,
    _sha256_file,
    _version_is_newer,
    _write_json,
    uhashlib,
)

class RuntimeUpdateReceiver:

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

def handle_update(updater, line):
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
