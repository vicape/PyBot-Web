# PyBot BLE — Plan de pruebas físicas (runtime 3.0.1 / protocolo 3.0)

> **Estado: NO EJECUTADO.** Este entorno **no** tiene una ESP32 real. Este documento es un
> *checklist* para verificar en hardware el STOP confiable y el DEPLOY autónomo por Bluetooth.
> Ninguna casilla debe marcarse como aprobada sin correrla en una placa física. **Todos los
> casos de la sección 12 (endurecimiento 3.0.1) están PENDIENTES: requieren ESP32 real.**

## Entorno

- **Navegador:** Chrome/Edge de escritorio (Web Bluetooth) sobre HTTPS o `localhost`.
- **Placa:** ESP32 con MicroPython y runtime PyBot **3.0** instalado por USB
  (`main.py` + `pybot_mpy.py` + `EDA6.py`).
- **Perfiles a cubrir:** `mpy` (GPIO directo) y `eda6` (WEMOS).
- **Versiones esperadas por `INFO`:** runtime `3.0.1`, protocolo `3.0`,
  `capabilities = ["run","stop","deploy","app-control","autostart"]`.

Convención: `[ ]` pendiente · `[x]` OK · `[!]` falla (anotar observación).

---

## 1. Instalación / actualización del runtime

- [ ] "Instalar PyBot Bluetooth" por USB graba `main.py` + `pybot_mpy.py` + `EDA6.py`.
- [ ] `INFO` reporta `3.0.1` / `3.0` y las 5 capabilities.
- [ ] Reinstalar el runtime **NO** borra un `pybot_app.py`/`pybot_app.json` compatible ya presente.
- [ ] Migración incompatible (metadata de otra versión) se maneja sin romper el arranque.

## 2. Conexión BLE

- [ ] La placa aparece como `PYBOT-XXXXXX` y conecta.
- [ ] PING/INFO/LED responden.
- [ ] Reconexión tras desconectar/volver a conectar funciona.

## 3. RUN temporal (EJECUTAR)

- [ ] `mpy`: `pin/servo/motor/wait` — la salida `print` llega a la terminal.
- [ ] `eda6`: `salidaDigital(1,1)`, `servomotor`, `sensorDistancia`, LCD — corre y streamea.
- [ ] Programa que termina solo → **`RUN:DONE`** (UI: "Fin", no error).
- [ ] Programa con excepción → **`RUN:ERR`** con traceback + **`RUN:ERROR`**; hardware queda seguro.
- [ ] Encoding: acentos y `ñ` en `print(...)` se ven correctos (UTF-8).
- [ ] Tamaños: programas ~1/2/4/8 KB (cerca de `MAX_RUN_PROGRAM_SIZE`) corren; > máx → error claro.

## 4. STOP confiable

- [ ] **STOP durante `wait()`/`sleep()`**: se detiene rápido → **`RUN:STOPPED`** (UI: "Programa detenido").
- [ ] **Cleanup**: al detener, motores/PWM/salidas quedan **apagados**; en EDA6 se llamó `detenerTodo()`.
- [ ] **STOP con bucle que NO cede** (`while True: pass`): la web muestra "Deteniendo…", escala a
      **`STOP:FORCE`** (~3.5 s) y la placa **reinicia** (safe boot) — **sin desenchufar**.
- [ ] Tras `STOP:FORCE`, la placa vuelve con BLE vivo y **no** relanza el programa problemático.
- [ ] Motores en movimiento se **detienen** físicamente al hacer STOP (verificación visual).
- [ ] STOP no deja el runtime colgado: se puede volver a Ejecutar sin power cycle.

## 5. DEPLOY (BAJAR — persistente)

- [ ] "Bajar a ESP32 (Bluetooth)" transfiere, verifica (size + hash) y muestra
      *"Programa verificado y guardado en ESP32… Autostart activado."*
- [ ] `APP:INFO` reporta `installed=1`, `autostart=1`, `mode`/`profile`/`size`/`hash` correctos.
- [ ] Tamaños ~1/2/4/8 KB y cerca de `MAX_DEPLOY_PROGRAM_SIZE` transfieren OK.
- [ ] **Hash correcto → `DEPLOY:VERIFY:OK`**.
- [ ] **Hash/encoding forzado incorrecto → `DEPLOY:ERROR`** y la **app anterior queda intacta**.
- [ ] Reemplazo de app existente: STOP cooperativo → tmp → verify → reemplazo **transaccional**
      (backup/rollback) → metadata → **ejecuta inmediato**.
- [ ] Desconexión BLE **a mitad del DEPLOY**: se cancela, se borra el tmp, se **conserva** la app
      anterior y la web informa el fallo.

## 6. Autostart / power cycle / autonomía

- [ ] Con autostart ON, **apagar y encender** la placa (sin PC): la app corre sola.
- [ ] Sin PC/navegador/BLE/Internet la app sigue funcionando (autonomía real).
- [ ] Mientras la app autónoma corre, se puede **conectar por BLE** para administrarla.
- [ ] **Perder el BLE NO detiene** la app autónoma (a diferencia del RUN temporal).

## 7. Recuperación / safe boot / app defectuosa

- [ ] App que lanza excepción en autostart: se captura traceback, cleanup, **BLE sigue**,
      `APP:INFO` muestra `fail`/`last_error`, **no** se borra el código del alumno.
- [ ] Tras 3 fallos consecutivos de autostart, el runtime deja de relanzar (anti boot-loop).
- [ ] `pybot_state.json` refleja `safe_boot`/`fail_count` coherentes.

## 8. Control remoto de la app (APP:*)

- [ ] `APP:START` (Ejecutar guardado): corre y streamea salida.
- [ ] `APP:STOP` (Detener): detiene la app con cleanup.
- [ ] `APP:AUTOSTART:0` / `:1`: cambia y persiste el autostart (verificar con power cycle).
- [ ] `APP:DELETE` (Borrar): detiene + cleanup + borra `pybot_app.py`/metadata; **NO** borra
      `main.py`/`EDA6.py`/`pybot_mpy.py`; el BLE sigue disponible.

## 9. Compatibilidad con runtime 2.x

- [ ] Placa con runtime **2.x**: **Ejecutar (RUN)** sigue funcionando.
- [ ] "Bajar a ESP32" se deshabilita/avisa: *"Esta placa necesita actualizar PyBot Bluetooth
      para usar Bajar a ESP32"*.

## 10. No-regresiones (rápido)

- [ ] Arduino/StandardFirmata en vivo, "Bajar a Arduino", Web Serial.
- [ ] ESP32 USB (MicroPython y EDA6): Ejecutar y Bajar por **USB** siguen igual
      (serial tiene prioridad si hay `_mpSession`).
- [ ] Pyodide, Monaco, PyBlock, Canvas, pseudocódigo, Flow, auth/Supabase/Classroom, routing.

## 11. Stress test (opcional, aula)

- [ ] 10+ ciclos Ejecutar/STOP seguidos sin power cycle ni cuelgues.
- [ ] 10+ ciclos Bajar/Ejecutar guardado/Borrar seguidos.
- [ ] Deploy repetido de programas grandes cerca del máximo sin corrupción (hash siempre OK).

## 12. Endurecimiento 3.0.1 — 20 casos (NO EJECUTADO, requieren ESP32 real)

> Casos que cubren específicamente los arreglos del release de endurecimiento. **Ninguno**
> ejecutado en este entorno (sin hardware). Marcar solo tras correrlos en una placa física.

- [ ] **C1 — RUN normal:** programa que termina solo → salida completa + **`RUN:DONE`** → UI "[Fin]".
- [ ] **C2 — STOP con `wait()`:** STOP durante espera cooperativa → **`RUN:STOPPED`** rápido; UI pasa
      por "Deteniendo…" y termina en "Programa detenido". No permite Ejecutar hasta confirmar.
- [ ] **C3 — STOP con `while True: pass`:** no cede → UI "Deteniendo…" → escalado **`STOP:FORCE`**
      (~3.5 s) → placa reinicia (safe boot) → BLE vuelve → programa **no** se relanza.
- [ ] **C4 — FORCE deja hardware seguro:** durante C3, verificar que motores/PWM/salidas quedan
      apagados tras el reset (estado por defecto de GPIO).
- [ ] **C5 — Disconnect con RUN temporal `while True`:** desconectar BLE con el bucle corriendo →
      watchdog fuerza el reset (~1.8 s) → la placa **no** queda con el programa huérfano.
- [ ] **C6 — Disconnect con RUN temporal cooperativo:** desconectar con programa con `wait()` →
      se detiene por STOP cooperativo, sin necesidad de reset.
- [ ] **C7 — APP deploy:** "Bajar por Bluetooth" transfiere, verifica (size+hash) y responde
      **`DEPLOY:VERIFY:OK`**; `APP:INFO` reporta `installed=1`, `autostart=1`, `mode/profile/size/hash`.
- [ ] **C8 — APP start inmediato:** tras C7, la app **arranca sola** (sin apretar Ejecutar) y su
      salida se streamea (`APP:OK:START` + `RUN:*`).
- [ ] **C9 — Disconnect con APP autónoma:** desconectar BLE con la app corriendo → **sigue**
      ejecutando (diferencia clave con C5).
- [ ] **C10 — Power cycle con autostart:** apagar/encender sin PC → la app corre sola al boot.
- [ ] **C11 — Connect tras autostart:** con la app ya corriendo (arrancó por autostart, **sin**
      sesión web previa), conectar por BLE → `APP:INFO` reporta `running=1`.
- [ ] **C12 — STOP de app autostart cooperativa:** sobre C11, "Detener" → `APP:STOP` → la app para
      **de verdad** y **`APP:OK:STOP`** llega **después** de la detención (no antes).
- [ ] **C13 — STOP de app autostart NO cooperativa:** app persistente con bucle que no cede →
      `APP:STOP` sin confirmación → escalado **`STOP:FORCE`** → reset + recuperación (stopped).
- [ ] **C14 — Redeploy con app corriendo:** con la app en ejecución, "Bajar por Bluetooth" de un
      programa nuevo → STOP cooperativo → deploy/verify → autostart → arranque; **no** queda en BUSY
      permanente (si la app previa no cede, se informa BUSY y "Detener" escala a FORCE).
- [ ] **C15 — Deploy corrupto (hash/size incorrecto):** forzar hash/size erróneo → **`DEPLOY:ERROR`**
      (`BAD_HASH`/`VERIFY_FAILED`) y la **app anterior queda intacta** (verificar con `APP:INFO`).
- [ ] **C16 — `HASH_UNAVAILABLE`:** (si se dispone de un port sin `uhashlib`) deploy con hash
      declarado → **`DEPLOY:ERROR:HASH_UNAVAILABLE`**, nunca `VERIFY:OK`. En ESP32 normal no aplica.
- [ ] **C17 — DELETE:** app parada → `APP:OK:DELETE`; app cooperativa → detiene + borra; app no
      cooperativa → force + recover + borra; en todos, `pybot_app.py`/metadata **ausentes** después
      (`APP:INFO` `installed=0`); `main.py`/`EDA6.py`/`pybot_mpy.py` intactos.
- [ ] **C18 — Power cycle tras delete:** apagar/encender tras C17 → la app **no** arranca (no quedó
      metadata/autostart) y el BLE sigue disponible.
- [ ] **C19 — 20 ciclos Run/STOP:** 20 iteraciones Ejecutar → STOP (mezclando `wait()` y `while True`)
      sin cuelgues, sin fugas, con cleanup consistente.
- [ ] **C20 — 20 ciclos Deploy + 20 ciclos autostart/reconnect:** 20 deploys de programas grandes
      cerca del máximo (hash siempre OK, sin corrupción) y 20 power cycle/reconexión con la app
      autónoma corriendo, verificando `APP:INFO` coherente en cada vuelta.
