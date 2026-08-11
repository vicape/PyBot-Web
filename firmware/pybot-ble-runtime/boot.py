# PyBot BLE Runtime - BOOT / UPDATE MANAGER (MicroPython, ESP32)
#
# Se instala en la placa como `boot.py` (MicroPython lo ejecuta ANTES de `main.py`
# en cada arranque). Su UNICA responsabilidad es aplicar/revertir de forma SEGURA
# una actualizacion OTA del runtime (main.py) antes de que este corra. Es
# deliberadamente MINIMO y muy estable: NO usa BLE, NI EDA6, NI el hardware.
#
# Contrato con main.py (el runtime):
#   - El runtime, tras VERIFY:OK, escribe `pybot_update.json` con state="pending"
#     (from/to/size/hash) y hace machine.reset(). El nuevo runtime NUNCA se escribe
#     sobre main.py durante la transferencia: se descarga completo a
#     `pybot_runtime.new` y ESTE boot.py hace el swap con backup + rollback.
#   - En este arranque, boot.py mira `pybot_update.json`:
#       * state "pending": respalda main.py -> pybot_runtime.bak, instala
#         pybot_runtime.new -> main.py, marca state "applied" y arranca el nuevo.
#       * state "applied": significa que un arranque anterior ya instalo el nuevo
#         runtime PERO este NUNCA confirmo su arranque (no importo / no levanto BLE
#         / no registro GATT). Se asume fallo -> ROLLBACK: restaura el backup y
#         arranca el runtime anterior (conocido-bueno). Evita boot loops porque el
#         estado se limpia tras el rollback.
#   - El nuevo runtime, SOLO cuando ya importo OK + levanto BLE + registro GATT +
#     quedo operacional, limpia `pybot_update.json` y borra `pybot_runtime.bak`
#     (confirmacion de arranque). Desde ese momento no hay rollback posible.
#
# Modelo de fallo de energia (el filesystem de MicroPython NO garantiza atomicidad
# perfecta; se disena para dejar SIEMPRE un main.py o un backup valido):
#   - Durante la descarga: no hay `pending` todavia -> main.py anterior intacto; se
#     borra el `.new` incompleto.
#   - `pending` escrito, corte antes/durante el apply: el apply es RE-ENTRANTE
#     (idempotente). Si main.py ya es el nuevo (hash coincide) no se re-respalda; si
#     main.py falta se instala el `.new` o se restaura el backup.
#
# TODA la logica va dentro de un try/except que NUNCA impide que main.py arranque:
# ante cualquier imprevisto, se prefiere dejar el runtime existente corriendo.

_MAIN = "main.py"
_NEW = "pybot_runtime.new"
_BAK = "pybot_runtime.bak"
_STATE = "pybot_update.json"


def _boot_apply_update():
    import os
    import json

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
        # SHA-256 hex del contenido, o None si no hay uhashlib / falla la lectura.
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
        # El `.new` debe existir, tener el tamano declarado y (si se declaro hash)
        # coincidir en SHA-256. Sin uhashlib no podemos verificar un hash declarado:
        # se trata como invalido para NO instalar algo no verificado.
        if not _exists(_NEW):
            return False
        if size is not None and _size(_NEW) != size:
            return False
        if hexhash:
            d = _sha256_file(_NEW)
            if d is None or d != hexhash:
                return False
        return True

    def _do_apply(st, size, hexhash):
        # Re-entrada segura: si main.py YA es el runtime nuevo (el rename new->main
        # ya ocurrio antes de un corte), no re-respaldar (perderiamos el backup del
        # runtime anterior). Solo marcar applied para que el nuevo confirme.
        if hexhash and _exists(_MAIN) and _sha256_file(_MAIN) == hexhash:
            _remove(_NEW)
            st["state"] = "applied"
            _write_json(_STATE, st)
            return

        if not _new_is_valid(size, hexhash):
            # `.new` ausente/invalido:
            if _exists(_MAIN):
                # main.py intacto -> abortar el update, conservar el runtime actual.
                _remove(_NEW)
                _clear_state()
            elif _exists(_BAK):
                # main.py ausente (corte tras el backup) y `.new` inservible ->
                # restaurar el runtime anterior desde el backup.
                _rename(_BAK, _MAIN)
                _clear_state()
            return

        # `.new` valido: respaldar el main.py actual (si existe) antes del swap.
        if _exists(_MAIN):
            _remove(_BAK)
            if not _rename(_MAIN, _BAK):
                # No se pudo respaldar: NO tocar main.py; conservar el runtime
                # actual y limpiar el `.new` para no reintentar en loop.
                _remove(_NEW)
                _clear_state()
                return

        # main.py respaldado (o ausente por un corte previo): instalar el nuevo.
        if not _rename(_NEW, _MAIN):
            # Fallo el swap: si teniamos backup y main quedo ausente, restaurarlo.
            if not _exists(_MAIN) and _exists(_BAK):
                _rename(_BAK, _MAIN)
            _remove(_NEW)
            _clear_state()
            return

        # Swap exitoso: marcar applied. El nuevo runtime confirmara al arrancar
        # (limpia el estado + borra el backup) o, si no confirma, el proximo boot
        # hara rollback desde el backup.
        st["state"] = "applied"
        _write_json(_STATE, st)
        _remove(_NEW)

    def _do_rollback(st):
        # El runtime nuevo no confirmo su arranque: restaurar el runtime anterior.
        if _exists(_BAK):
            _remove(_MAIN)
            if _rename(_BAK, _MAIN):
                _clear_state()
                return
        # Sin backup no se puede revertir. No borrar el estado para dejar rastro
        # de diagnostico; main.py (nuevo) permanece y tendra otra chance de
        # confirmar. Se limpia el `.new` residual.
        _remove(_NEW)
        st["state"] = "rollback_failed"
        _write_json(_STATE, st)

    st = _read_json(_STATE)
    if not isinstance(st, dict):
        # No hay update en curso: limpiar un `.new` huerfano de una descarga
        # cortada. El runtime anterior queda intacto.
        _remove(_NEW)
        return

    state = st.get("state")
    size = st.get("size")
    hexhash = (st.get("hash") or "").lower()

    if state == "pending":
        _do_apply(st, size, hexhash)
    elif state == "applied":
        _do_rollback(st)
    # "confirmed" / "rollback_failed" / otros: nada que hacer aca.


try:
    _boot_apply_update()
except Exception:
    # boot.py NUNCA debe impedir el arranque de main.py: ante cualquier error se
    # deja correr el runtime existente (mecanismo de seguridad).
    pass
