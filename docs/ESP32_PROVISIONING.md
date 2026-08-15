# Preparar ESP32 (Web Serial)

Estado: **SOFTWARE VERIFIED** (tests Node + build). **PENDIENTE FÍSICO** en placa real.
Nada de lo siguiente se afirma ejecutado en hardware en este cambio.

## Qué hace

Deja una ESP32 lista para PyBot **desde Chrome o Edge**, sin Thonny, Arduino IDE,
esptool local, Python en la PC ni terminal.

Dos capas, en este orden:

| Capa | Cuándo | Qué |
| --- | --- | --- |
| A — ROM bootloader | Placa virgen o reinstalación confirmada | `esptool-js` (Espressif, Apache-2.0) graba MicroPython oficial |
| B — raw REPL | Solo después de que MicroPython responde | Reutiliza `installBleRuntime` / `getBleRuntimeInstallFiles` |

Nunca se entra a raw REPL antes de MicroPython.

El programa del editor **no** se copia en este flujo. `pybot_app.py` del alumno no
se instala aquí. BLE legacy no es el default.

## Estados de la placa

| Estado | Cómo se decide | Acción |
| --- | --- | --- |
| **VIRGIN** | No hay REPL MicroPython | Preparar ESP32 (flash + PyBot) |
| **MPY_ONLY** | Hay MicroPython, no `pybot_ble.py` | Instalar PyBot (sin reflash) |
| **OLD_PYBOT** | Hay runtime con versión &lt; 4.0.0 o sin `pybot_repl.py` | Actualizar PyBot (sin reflash) |
| **READY** | Runtime actual + archivos nativos | Conectar. No erase automático. Cancel / Reinstall con confirmación |

No se muestra el mismo mensaje rojo para todos.

## Firmware MicroPython

Fuente de verdad: `src/esp32/firmwareManifest.js` y `public/firmware/micropython/manifest.json`.

| Campo | Valor |
| --- | --- |
| Variante | `ESP32_GENERIC` (ESP32 clásico / WROOM, 4 MiB+) |
| Versión | 1.27.0 (2025-12-09) |
| Origen | https://micropython.org/download/ESP32_GENERIC/ |
| Archivo | `ESP32_GENERIC-20251209-v1.27.0.bin` |
| Licencia | MIT (MicroPython) |
| SHA-256 | `aa4be80ec695911ba0f13f7558e559ce540f90efbf40c23b853ca49162136b9f` |
| Offset | `0x1000` (oficial MicroPython para ESP32) |
| Features | BLE, WLAN, HTTPS/TLS, `os.dupterm` |

El hash se verifica **antes** de flashear. Si no coincide, no se escribe nada.

Otras familias (S2/S3/C3/C6/H2/P4/ESP8266): mensaje “variant not yet supported”.
No se flashea la imagen de ESP32 clásico en otro chip.

## Flasher

- Paquete npm `esptool-js` (Espressif Systems, Apache-2.0), import **dinámico**
  (`src/esp32/esptoolLoader.js`) para no inflar el bundle inicial de Arduino.
- DTR/RTS auto-download (`default_reset`). Si falla: instrucciones del botón BOOT.
- Selector de puerto: siempre `navigator.serial.requestPort()` (gesto del usuario).
  Nunca se elige en silencio `getPorts()[0]`.
- Progreso real: `reportProgress(fileIndex, written, total)` de `writeFlash`.
- Tras el write: `flashMd5sum` si la API está. **READY** exige además boot MP + REPL + archivos PyBot.

## Máquina de estados

Un solo `phase` (`src/esp32/provisioningPhases.js`): `IDLE`, `SELECTING_PORT`,
`PROBING`, `CONFIRM_*`, `CONNECTING_BOOTLOADER`, `ERASING`, `FLASHING`,
`VERIFYING_FLASH`, `WAITING_REPL`, `INSTALLING_PYBOT`, `VERIFYING_FILES`,
`READY`, `ERROR`, `CANCELLED`, `UNSUPPORTED_VARIANT`, `NEED_BOOT_BUTTON`, …

Fases críticas (no se puede cerrar el modal): `ERASING`, `FLASHING`, `VERIFYING_FLASH`.

## Flujo virgen

1. Preparar ESP32 → diálogo de puerto.
2. Probe REPL (si no hay MicroPython → VIRGIN).
3. Confirmación destructiva.
4. Bootloader + chip ID.
5. Cargar imagen del deploy + SHA-256.
6. Erase + write + verify flash.
7. Reset, soltar readers/writers, reabrir puerto.
8. REPL MicroPython.
9. `installBleRuntime` (BLE nativo + `pybot/` + EDA6 + net).
10. Verificar archivos, reconectar REPL → “ESP32 lista”.

## Archivos instalados (capa B)

Los mismos que `getBleRuntimeInstallFiles()` más `EDA6.py` (como `installBleRuntime`):

`boot.py`, `main.py`, `pybot_ble.py`, `pybot_run.py`, `pybot_deploy.py`,
`pybot_update.py`, `pybot_boot_update.py`, `pybot_repl.py`, `pybot_net.py`,
`pybot_mpy.py`, `EDA6.py`.

## Recuperación

- Fallo de bootloader: botón BOOT + Reintentar.
- Fallo a 10/50/95 % del write: ERROR, no READY; Reintentar.
- Puerto ocupado: cerrar Thonny / Arduino IDE.
- Hash mismatch: no se flashea.
- Placa ya preparada: no erase; Cancel o Reinstall con confirmación.

## Pendiente físico (no ejecutado aquí)

- Entrada real al bootloader por DTR/RTS.
- Erase / flash real.
- Boot de MicroPython tras el reset.
- REPL, install PyBot, BLE, Wi-Fi en placa.

Ver también `docs/MICROPYTHON_PHYSICAL_TEST_PLAN.md` (P1–P10).
