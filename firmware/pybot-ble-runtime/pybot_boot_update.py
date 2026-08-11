import os
import json

_MAIN = "main.py"
_NEW = "pybot_runtime.new"
_BAK = "pybot_runtime.bak"
_STATE = "pybot_update.json"
_PACK_MAGIC = b"PYBOTRT1\n"
_RUNTIME_FILES = (
    "main.py",
    "pybot_ble.py",
    "pybot_run.py",
    "pybot_deploy.py",
    "pybot_update.py",
    "pybot_boot_update.py",
)
_RTBAK = ".rtbak"

try:
    import uhashlib
    import ubinascii
except ImportError:
    uhashlib = None
    ubinascii = None

def _exists(path):
    try:
        os.stat(path)
        return True
    except Exception:
        return False

def _size(path):
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

def _rename(src, dst):
    try:
        os.rename(src, dst)
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
    if uhashlib is None or ubinascii is None:
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

def _clear_state():
    _remove(_STATE)

def _new_is_valid(size, hexhash):
    if not _exists(_NEW):
        return False
    if size is not None and _size(_NEW) != size:
        return False
    if hexhash:
        d = _sha256_file(_NEW)
        if d is None or d != hexhash:
            return False
    return True

def _is_pack():
    try:
        with open(_NEW, "rb") as f:
            return f.read(len(_PACK_MAGIC)) == _PACK_MAGIC
    except Exception:
        return False

def _parse_pack():
    files = []
    with open(_NEW, "rb") as f:
        magic = f.readline()
        if magic != _PACK_MAGIC:
            return None
        while True:
            name_b = f.readline()
            if not name_b:
                break
            name = name_b.strip().decode()
            size_b = f.readline()
            if not size_b:
                return None
            try:
                sz = int(size_b.strip())
            except Exception:
                return None
            if sz < 0 or sz > 200000:
                return None
            data = f.read(sz)
            if len(data) != sz:
                return None
            if name not in _RUNTIME_FILES:
                return None
            files.append((name, data))
    return files if files else None

def _backup_runtime_files(names):
    for name in names:
        bak = name + _RTBAK
        _remove(bak)
        if _exists(name):
            if not _rename(name, bak):
                return False
    return True

def _restore_runtime_files():
    for name in _RUNTIME_FILES:
        bak = name + _RTBAK
        if _exists(bak):
            _remove(name)
            _rename(bak, name)

def _clear_rtbaks():
    for name in _RUNTIME_FILES:
        _remove(name + _RTBAK)

def _apply_pack(st, size, hexhash):
    if not _new_is_valid(size, hexhash):
        if _exists(_MAIN):
            _remove(_NEW)
            _clear_state()
        else:
            _restore_runtime_files()
            if _exists(_BAK) and not _exists(_MAIN):
                _rename(_BAK, _MAIN)
            _clear_state()
        return
    files = _parse_pack()
    if not files:
        _remove(_NEW)
        _clear_state()
        return
    names = [n for n, _ in files]
    if not _backup_runtime_files(names):
        _restore_runtime_files()
        _remove(_NEW)
        _clear_state()
        return
    try:
        for name, data in files:
            with open(name, "wb") as f:
                f.write(data)
    except Exception:
        _restore_runtime_files()
        _remove(_NEW)
        _clear_state()
        return
    st["state"] = "applied"
    st["pack"] = 1
    _write_json(_STATE, st)
    _remove(_NEW)

def _do_apply_legacy(st, size, hexhash):
    if hexhash and _exists(_MAIN) and _sha256_file(_MAIN) == hexhash:
        _remove(_NEW)
        st["state"] = "applied"
        _write_json(_STATE, st)
        return
    if not _new_is_valid(size, hexhash):
        if _exists(_MAIN):
            _remove(_NEW)
            _clear_state()
        elif _exists(_BAK):
            _rename(_BAK, _MAIN)
            _clear_state()
        return
    if _exists(_MAIN):
        _remove(_BAK)
        if not _rename(_MAIN, _BAK):
            _remove(_NEW)
            _clear_state()
            return
    if not _rename(_NEW, _MAIN):
        if not _exists(_MAIN) and _exists(_BAK):
            _rename(_BAK, _MAIN)
        _remove(_NEW)
        _clear_state()
        return
    st["state"] = "applied"
    _write_json(_STATE, st)
    _remove(_NEW)

def _do_apply(st, size, hexhash):
    if _exists(_NEW) and _is_pack():
        _apply_pack(st, size, hexhash)
    else:
        _do_apply_legacy(st, size, hexhash)

def _do_rollback(st):
    if st.get("pack"):
        _restore_runtime_files()
        _clear_rtbaks()
        _remove(_NEW)
        _clear_state()
        return
    if _exists(_BAK):
        _remove(_MAIN)
        if _rename(_BAK, _MAIN):
            _clear_state()
            return
    _remove(_NEW)
    st["state"] = "rollback_failed"
    _write_json(_STATE, st)

def apply():
    st = _read_json(_STATE)
    if not isinstance(st, dict):
        _remove(_NEW)
        return
    state = st.get("state")
    size = st.get("size")
    hexhash = (st.get("hash") or "").lower()
    if state == "pending":
        _do_apply(st, size, hexhash)
    elif state == "applied":
        _do_rollback(st)
