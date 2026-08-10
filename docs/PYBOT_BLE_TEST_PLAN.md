# PyBot BLE — Plan de pruebas físicas (protocolo 3.0)

> **Estado: NO EJECUTADO.** Este entorno **no** tiene una ESP32 real. Este documento es un
> *checklist* para verificar en hardware el STOP confiable y el DEPLOY autónomo por Bluetooth.
> Ninguna casilla debe marcarse como aprobada sin correrla en una placa física.

## Entorno

- **Navegador:** Chrome/Edge de escritorio (Web Bluetooth) sobre HTTPS o `localhost`.
- **Placa:** ESP32 con MicroPython y runtime PyBot **3.0** instalado por USB
  (`main.py` + `pybot_mpy.py` + `EDA6.py`).
- **Perfiles a cubrir:** `mpy` (GPIO directo) y `eda6` (WEMOS).
- **Versiones esperadas por `INFO`:** runtime `3.0.0`, protocolo `3.0`,
  `capabilities = ["run","stop","deploy","app-control","autostart"]`.

Convención: `[ ]` pendiente · `[x]` OK · `[!]` falla (anotar observación).

---

## 1. Instalación / actualización del runtime

- [ ] "Instalar PyBot Bluetooth" por USB graba `main.py` + `pybot_mpy.py` + `EDA6.py`.
- [ ] `INFO` reporta `3.0.0` / `3.0` y las 5 capabilities.
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
- [ ] Reemplazo de app existente: STOP → cleanup → tmp → verify → reemplazo atómico → ejecuta.
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
