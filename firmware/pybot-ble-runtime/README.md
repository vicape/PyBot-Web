# PyBot BLE Runtime (MicroPython)

Runtime BLE para ESP32 que corre **nativamente en MicroPython**. Se instala por
USB con `installFile` (raw REPL), el mismo mecanismo que `EDA6.py`.

## Runtime 3.2.0 — layout modular

Para reducir RAM al boot (evitar `MemoryError` antes de `gap_advertise`), el
runtime ya **no** es un `main.py` monolítico:

| Archivo en la placa | Rol | Carga al boot |
| --- | --- | --- |
| `boot.py` | Chequeo mínimo de OTA (`pybot_update.json`) | Sí (~200 B) |
| `main.py` | Stub: `import pybot_ble; pybot_ble.main()` | Sí |
| `pybot_ble.py` | Núcleo: advertising, GATT, ADMIN + REPL | Sí |
| `pybot_repl.py` | BLE UART + `os.dupterm` (REPL nativo) | Tras advertising |
| `pybot_net.py` | Wi-Fi + HTTP GET/POST | Import del alumno / EDA6 |
| `pybot_mpy.py` | `pin` / `servo` / `motor` / `wait` + red | Import |
| `pybot_run.py` | LEGACY RUN / STOP / ProgramManager | Lazy (flag legacy) |
| `pybot_deploy.py` | DEPLOY / APP:* | Lazy |
| `pybot_update.py` | UPDATE:* (OTA) | Lazy |
| `pybot_boot_update.py` | Apply/rollback OTA (legacy + pack `PYBOTRT1`) | Solo si hay update pendiente |

**Versión:** runtime **4.0.0**, protocolo **3.2** (ADMIN 3.1 compatible + REPL_RX/REPL_TX).
Precarga `pybot_run` fuera del IRQ BLE y reporta `RUN:ERROR:LOAD:...` si falla el import.
En **3.2.3+** los comandos no urgentes (`RUN:*`, PING/INFO, …) se encolan en el IRQ y se
procesan en el hilo principal (`poll_commands`), para que `RUN:READY` no use
`gatts_notify`+`sleep` dentro del IRQ (rompe el segundo Run tras Stop).
En **3.2.4** `STOP:FORCE` agenda reset por Timer (aunque `exec()` bloquee el main),
`APP:STOP`/`APP:DELETE` son urgentes en IRQ, y `safe_boot` es sticky hasta `APP:START`.
En **3.2.5** `APP:STOP` aplica a cualquier `exec` (RUN temporal o app), Timer FORCE
prueba ids `-1`/`0`/`1`, y la web Stop BLE no exige `running` local.
En **3.2.6** se cancela el Timer FORCE huerfano en `RUN:BEGIN` y tras STOP cooperativo.
En **3.2.7** `STOP:FORCE` / Timer / flag `force_reset` **no resetean** si `running=False`
(tras `RUN:STOPPED` cooperativo); evita tumbar el GATT en el 2º Run.
Recuperación USB (web): «Borrar programa BLE de la placa» elimina `pybot_app.*` sin tocar el runtime.
Constantes compartidas entre módulos usan nombres exportables (`MAX_RUN_B64`, etc.):
en MicroPython `_NAME = const(...)` no existe para `from … import`.

El runtime importa dos preludios instalados en la placa (por USB, junto con el runtime):
`pybot_mpy.py` (`pin/servo/motor/wait`) y `EDA6.py`. Por BLE solo viaja el código del alumno.

Archivos del alumno (NO se borran al actualizar el runtime): `pybot_app.py`,
`pybot_app.json`, `pybot_state.json`.

## Reinstalación por USB (obligatoria desde 3.1.x → 3.2.0)

1. Conectar la ESP32 por USB en PyBot Web (modo ESP32 MicroPython o EDA6).
2. Pulsar **Instalar PyBot Bluetooth**.
3. Esperar verificación + reset.
4. Abrir el panel Bluetooth: debe aparecer `PYBOT-XXXXXX` y `INFO.firmware == 4.0.0`.
5. Si hay un programa zombie del alumno: **Borrar programa BLE de la placa (USB)**
   (Instalar runtime solo NO borra `pybot_app.*`).

Las placas con runtime **&lt; 3.2.0** no pueden recibir el pack OTA multi-archivo
(el `boot.py` antiguo no lo entiende): hace falta **una** instalación USB.

## OTA (3.2.0 → 3.2.x+)

La web envía un pack `PYBOTRT1` (varios `.py`) a `pybot_runtime.new`. Tras
`UPDATE:APPLY`, `boot.py` importa `pybot_boot_update` y aplica el pack con backup
por archivo (`*.rtbak`) + rollback si el nuevo runtime no confirma el arranque.

## Servicio BLE

| Rol | UUID | Propiedad |
| --- | --- | --- |
| Service | `8fbc0001-4d5a-4b8c-9a1f-123456789001` | — |
| RX (Web → ESP32) | `8fbc0002-4d5a-4b8c-9a1f-123456789002` | WRITE |
| TX (ESP32 → Web) | `8fbc0003-4d5a-4b8c-9a1f-123456789003` | NOTIFY |

## Comandos (protocolo 3.1, sin cambios de framing)

`PING` / `INFO` / `LED,0|1` · `RUN:*` · `STOP` / `STOP:FORCE` · `DEPLOY:*` ·
`APP:*` · `UPDATE:*`
