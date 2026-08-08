# PyBot BLE Runtime (MicroPython)

Runtime BLE para ESP32 que corre **nativamente en MicroPython**. Se instala en la
placa como `main.py` reutilizando el mecanismo de transferencia por raw REPL de
PyBot (`installFile`), el mismo que instala `EDA6.py`. **No** usa esptool, `.bin`,
offsets ni compilacion: el "binario" es este archivo `.py` versionado en el repo.

## Archivos

- `main.py` — runtime completo (BluetoothTransport + CommandProcessor + ProgramRunner +
  HardwareController). Además de PING/INFO/LED, **ejecuta el programa del alumno recibido
  por BLE** (modos `mpy`/`eda6`) y streamea la salida, con Stop (protocolo 2.0).

El runtime importa dos preludios instalados en la placa (por USB, junto con `main.py`):
`pybot_mpy.py` (`pin/servo/motor/wait`) y `EDA6.py` (funciones EDA6). Por BLE solo viaja el
código del alumno + modo + perfil.

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

## Ejecución de programas (protocolo 2.0)

| Web → ESP32 | ESP32 → Web |
| --- | --- |
| `RUN:BEGIN:<mode>:<profile>` | `RUN:READY` |
| `RUN:CHUNK:<base64>` | `RUN:STARTED` |
| `RUN:END` | `RUN:OUT:<base64>` / `RUN:ERR:<base64>` |
| `STOP` | `RUN:DONE` / `RUN:ERROR:<code>` |

Ver `docs/PYBOT_BLE_RUNTIME.md` (sección 5-bis) para el detalle de modos, streaming, stop y
límites. Las respuestas se envían por TX en trozos de 20 bytes con `\n` final para tolerar el
MTU BLE por defecto; los payloads arbitrarios van en base64.

## Identidad

- `deviceId` = ultimos 6 hex (MAYUSCULA) de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. `PYBOT-A34F21`). Estable entre reinicios.

Ver `docs/PYBOT_BLE_RUNTIME.md` para la doc completa y el checklist de pruebas manuales.
