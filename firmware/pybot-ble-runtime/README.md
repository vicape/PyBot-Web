# PyBot BLE Runtime (MicroPython)

Runtime BLE para ESP32 que corre **nativamente en MicroPython**. Se instala en la
placa como `main.py` reutilizando el mecanismo de transferencia por raw REPL de
PyBot (`installFile`), el mismo que instala `EDA6.py`. **No** usa esptool, `.bin`,
offsets ni compilacion: el "binario" es este archivo `.py` versionado en el repo.

## Archivos

- `main.py` — runtime completo (BluetoothTransport + CommandProcessor + **ProgramManager** +
  **DeployReceiver** + HardwareController). Además de PING/INFO/LED: **ejecuta** el programa del
  alumno recibido por BLE (RUN temporal) y **lo baja** de forma persistente (DEPLOY) para que
  corra solo al encender (autostart). Runtime **3.0.1**, protocolo **3.0** (framing compatible).

El runtime importa dos preludios instalados en la placa (por USB, junto con `main.py`):
`pybot_mpy.py` (`pin/servo/motor/wait` + cleanup `_pybot_cleanup`) y `EDA6.py` (funciones EDA6).
Por BLE solo viaja el código del alumno + modo + perfil.

Archivos que crea/gestiona el runtime en la placa (NO se borran al actualizar el runtime):
`pybot_app.py` (programa persistente), `pybot_app.json` (metadata), `pybot_state.json`
(safe boot / fallos de autostart) y los efímeros del reemplazo **transaccional** del DEPLOY:
`pybot_app.tmp`/`pybot_app.bak` (programa) y `pybot_app.json.tmp`/`pybot_app.json.bak` (metadata).
Al boot, un DEPLOY interrumpido por un corte de energía se **repara** desde los backups.

## Requisito

El ESP32 debe tener **MicroPython** previamente (igual que hoy para EDA6). Instalar
MicroPython base en una placa en blanco requeriria esptool-js y queda fuera de este MVP.

## Placa soportada

- ESP32 clasico (WROOM). LED integrado en **GPIO 2** (`BUILTIN_LED_PIN`).
- La API `bluetooth` de MicroPython es comun a las variantes ESP32; para S3/C3/C6
  ajustar `BUILTIN_LED_PIN` si el LED integrado difiere o no existe.

## Servicio BLE

| Rol | UUID | Propiedad |
| --- | --- | --- |
| Service | `8fbc0001-4d5a-4b8c-9a1f-123456789001` | — |
| RX (Web → ESP32) | `8fbc0002-4d5a-4b8c-9a1f-123456789002` | WRITE |
| TX (ESP32 → Web) | `8fbc0003-4d5a-4b8c-9a1f-123456789003` | NOTIFY |

## Comandos simples

| Comando | Respuesta |
| --- | --- |
| `PING` | `PONG` |
| `INFO` | JSON compacto (device/id/firmware/protocol/runtime/board) |
| `LED,1` | `OK` (enciende LED) |
| `LED,0` | `OK` (apaga LED) |
| (desconocido) | `ERR,UNKNOWN_COMMAND` |

## Ejecución temporal (RUN) — protocolo 2.0/3.0

| Web → ESP32 | ESP32 → Web |
| --- | --- |
| `RUN:BEGIN:<mode>:<profile>` | `RUN:READY` |
| `RUN:CHUNK:<base64>` | `RUN:STARTED` |
| `RUN:END` | `RUN:OUT:<base64>` / `RUN:ERR:<base64>` |
| `STOP` (cooperativo) | `RUN:DONE` (fin) / `RUN:STOPPED` (detenido) |
| `STOP:FORCE` (reset + safe boot) | `RUN:ERROR:<code>` |

## Deploy persistente (DEPLOY) — protocolo 3.0

| Web → ESP32 | ESP32 → Web |
| --- | --- |
| `DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash>` | `DEPLOY:READY` |
| `DEPLOY:CHUNK:<base64>` | `DEPLOY:ACK:<n>` (ACK por bloque) |
| `DEPLOY:END` | `DEPLOY:VERIFY:OK` / `DEPLOY:ERROR:<code>` |
| `DEPLOY:ABORT` | (conserva la app anterior) |

Escritura a `pybot_app.tmp` + verificación **size + SHA-256** + reemplazo **transaccional** de
`pybot_app.py` y metadata con **backup/rollback** (nunca queda programa nuevo + metadata vieja, ni
sin app válida si la había). Si se declaró hash pero el port **no** tiene `uhashlib`, responde
`DEPLOY:ERROR:HASH_UNAVAILABLE` (no afirma una verificación que no ocurrió). Errores:
`BUSY, TOO_LONG, BAD_ENCODING, BAD_HASH, HASH_UNAVAILABLE, WRITE_FAILED, VERIFY_FAILED,
INVALID_MODE, INVALID_PROFILE, NO_SPACE, BAD_FRAME`.

## Control de la app (APP) — protocolo 3.0

`APP:INFO` → `APP:INFO:<json>`; `APP:START`/`APP:STOP`/`APP:DELETE`/`APP:AUTOSTART:1|0` →
`APP:OK:<action>` / `APP:ERROR:<code>`. Autostart en boot con **safe boot** anti boot-loop.
`APP:STOP` y `APP:DELETE` se confirman **cuando la app realmente paró/se borró** (respuesta
diferida), no al recibir el pedido; si la persistencia falla, responden `APP:ERROR:WRITE_FAILED`
/ `DELETE_FAILED` (sin éxito ficticio). Errores APP: `NO_APP, BUSY, READ_FAILED, WRITE_FAILED,
DELETE_FAILED, BAD_FRAME`.

Ver `docs/PYBOT_BLE_RUNTIME.md` (secciones 5-bis y **5-ter**) para el detalle de modos,
streaming, STOP confiable, DEPLOY, autostart y límites. Las respuestas se envían por TX en
trozos de 20 bytes con `\n` final para tolerar el MTU BLE por defecto; los payloads arbitrarios
van en base64.

## Identidad

- `deviceId` = ultimos 6 hex (MAYUSCULA) de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. `PYBOT-A34F21`). Estable entre reinicios.

Ver `docs/PYBOT_BLE_RUNTIME.md` para la doc completa y el checklist de pruebas manuales.
