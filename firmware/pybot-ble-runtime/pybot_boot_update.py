import os
import json

_MAIN = "main.py"
_NEW = "pybot_runtime.new"
_BAK = "pybot_runtime.bak"
_STATE = "pybot_update.json"
# Sidecar durable del commit applied (antes de reescribir pybot_update.json).
_APPLIED = "pybot_update.applied"
_PACK_MAGIC = b"PYBOTRT1\n"
_RUNTIME_FILES = (
    "main.py",
    "pybot_ble.py",
    "pybot_run.py",
    "pybot_deploy.py",
    "pybot_update.py",
    "pybot_boot_update.py",
    "pybot_repl.py",
    "pybot_rble.py",
    "pybot_net.py",
    "pybot_mpy.py",
)
_RTBAK = ".rtbak"
# Marcador: fase de backup del pack actual completada (contenido = hash OTA).
_RTBAK_READY = "pybot_runtime.rtbak_ready"
# Lectura/escritura de bodies OTA acotada (no cargar módulos enteros en RAM).
_COPY_CHUNK = 256

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

def _clear_applied_sidecar():
    _remove(_APPLIED)

def _read_rtbak_ready_hash():
    if not _exists(_RTBAK_READY):
        return ""
    try:
        with open(_RTBAK_READY, "r") as f:
            return (f.read() or "").strip().lower()
    except Exception:
        return ""

def _commit_pack_applied(st):
    """
    Commit pending→applied tolerante a power-loss.
    1) sidecar applied verificado
    2) state principal
    3) limpiar .new / markers
    Si el state queda corrupto, el sidecar permite recuperar en el próximo boot.
    """
    st["state"] = "applied"
    st["pack"] = 1
    if not _write_json(_APPLIED, st):
        return False
    if _read_json(_APPLIED) is None:
        _clear_applied_sidecar()
        return False
    if not _write_json(_STATE, st):
        return False
    if _read_json(_STATE) is None:
        # State ilegible; sidecar intacto → recuperación en próximo boot.
        return False
    _remove(_NEW)
    _clear_rtbak_ready()
    _clear_applied_sidecar()
    return True

def _finish_applied_from_sidecar(side):
    """Restaura state=applied desde sidecar sin rollback en el mismo boot."""
    if not _write_json(_STATE, side):
        return False
    if _read_json(_STATE) is None:
        return False
    _remove(_NEW)
    _clear_rtbak_ready()
    _clear_applied_sidecar()
    return True

def _try_recover_missing_state():
    """
    state ilegible/ausente:
      - sidecar applied válido → completar commit (NEW queda, confirm posible)
      - rtbak_ready + .new → reconstruir pending y reintentar apply
      - si no → limpiar huérfanos
    Devuelve st dict o None (ya manejado / nada que hacer).
    """
    side = _read_json(_APPLIED)
    if isinstance(side, dict) and side.get("state") == "applied":
        if _finish_applied_from_sidecar(side):
            return None  # applied durable; main puede confirmar
        return None
    ready_hash = _read_rtbak_ready_hash()
    if ready_hash and _exists(_NEW):
        st = {
            "state": "pending",
            "size": _size(_NEW),
            "hash": ready_hash,
            "pack": 1,
        }
        _write_json(_STATE, st)
        return st
    _remove(_NEW)
    _clear_rtbak_ready()
    _clear_applied_sidecar()
    return None

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

def _skip_bytes(f, n):
    """Avanza n bytes leyendo en chunks; False si hay truncamiento."""
    remaining = n
    while remaining > 0:
        chunk = f.read(min(_COPY_CHUNK, remaining))
        if not chunk:
            return False
        remaining -= len(chunk)
    return True

def _copy_bytes(src, dst, n):
    """Copia exactamente n bytes src→dst en chunks; False si truncamiento."""
    remaining = n
    while remaining > 0:
        chunk = src.read(min(_COPY_CHUNK, remaining))
        if not chunk:
            return False
        dst.write(chunk)
        remaining -= len(chunk)
    return True

def _validate_pack():
    """
    Pasada 1: valida estructura PYBOTRT1 completa SIN conservar bodies en RAM.
    Devuelve [(name, size), ...] o None.
    """
    meta = []
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
            if name not in _RUNTIME_FILES:
                return None
            if not _skip_bytes(f, sz):
                return None
            meta.append((name, sz))
    return meta if meta else None

def _install_pack_files(meta):
    """
    Pasada 2: vuelve a recorrer el pack y copia cada body por chunks al destino.
    Asume meta ya validada y backups hechos.
    """
    with open(_NEW, "rb") as src:
        magic = src.readline()
        if magic != _PACK_MAGIC:
            raise OSError("pack magic")
        for expected_name, expected_sz in meta:
            name_b = src.readline()
            if not name_b:
                raise OSError("pack truncated")
            name = name_b.strip().decode()
            size_b = src.readline()
            if not size_b:
                raise OSError("pack truncated")
            sz = int(size_b.strip())
            if name != expected_name or sz != expected_sz:
                raise OSError("pack mismatch")
            with open(name, "wb") as dst:
                if not _copy_bytes(src, dst, sz):
                    raise OSError("pack truncated")

def _clear_rtbak_ready():
    _remove(_RTBAK_READY)

def _is_rtbak_ready(hexhash):
    """True si el marker pertenece al mismo update (mismo hash)."""
    if not _exists(_RTBAK_READY):
        return False
    want = (hexhash or "").lower()
    try:
        with open(_RTBAK_READY, "r") as f:
            got = (f.read() or "").strip().lower()
        return got == want and want != ""
    except Exception:
        return False

def _mark_rtbak_ready(hexhash):
    try:
        with open(_RTBAK_READY, "w") as f:
            f.write((hexhash or "").lower())
        return True
    except Exception:
        return False

def _backup_runtime_files(names):
    """
    Backup idempotente: si name.rtbak ya existe, NO se toca.
    Si no hay bak y el target existe, target -> bak.
    Si ambos faltan, el archivo no existía en el runtime anterior.
    """
    for name in names:
        bak = name + _RTBAK
        if _exists(bak):
            continue
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

def _abort_pack_update():
    _restore_runtime_files()
    _remove(_NEW)
    _clear_state()
    _clear_rtbak_ready()
    _clear_applied_sidecar()

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
        _clear_rtbak_ready()
        _clear_applied_sidecar()
        return
    # Validar pack COMPLETO antes de cualquier backup/escritura.
    meta = _validate_pack()
    if not meta:
        _remove(_NEW)
        _clear_state()
        _clear_rtbak_ready()
        _clear_applied_sidecar()
        return
    names = [n for n, _ in meta]
    # Marker listo => backups del ORIGINAL ya hechos; no re-respaldar.
    if not _is_rtbak_ready(hexhash):
        if not _backup_runtime_files(names):
            _abort_pack_update()
            return
        if not _mark_rtbak_ready(hexhash):
            _abort_pack_update()
            return
    try:
        _install_pack_files(meta)
    except Exception:
        _abort_pack_update()
        return
    _commit_pack_applied(st)

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
        _clear_rtbak_ready()
        _clear_applied_sidecar()
        return
    if _exists(_BAK):
        _remove(_MAIN)
        if _rename(_BAK, _MAIN):
            _clear_state()
            _clear_rtbak_ready()
            _clear_applied_sidecar()
            return
    _remove(_NEW)
    st["state"] = "rollback_failed"
    _write_json(_STATE, st)
    _clear_rtbak_ready()
    _clear_applied_sidecar()

def apply():
    st = _read_json(_STATE)
    if not isinstance(st, dict):
        st = _try_recover_missing_state()
        if not isinstance(st, dict):
            return
    state = st.get("state")
    size = st.get("size")
    hexhash = (st.get("hash") or "").lower()
    if state == "pending":
        # Sidecar applied ya durable: completar commit sin re-instalar.
        side = _read_json(_APPLIED)
        if isinstance(side, dict) and side.get("state") == "applied":
            _finish_applied_from_sidecar(side)
            return
        _do_apply(st, size, hexhash)
    elif state == "applied":
        _do_rollback(st)
