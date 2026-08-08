# PyBot BLE Runtime (MicroPython)

Runtime BLE para ESP32 que corre **nativamente en MicroPython**. Se instala en la
placa como `main.py` reutilizando el mecanismo de transferencia por raw REPL de
PyBot (`installFile`), el mismo que instala `EDA6.py`. **No** usa esptool, `.bin`,
offsets ni compilacion: el "binario" es este archivo `.py` versionado en el repo.

## Archivos

- `main.py` — runtime completo (BluetoothTransport + CommandProcessor + HardwareController).

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

## Comandos (MVP)

| Comando | Respuesta |
| --- | --- |
| `PING` | `PONG` |
| `INFO` | JSON compacto (device/id/firmware/protocol/runtime/board) |
| `LED,1` | `OK` (enciende LED) |
| `LED,0` | `OK` (apaga LED) |
| (desconocido) | `ERR,UNKNOWN_COMMAND` |

Las respuestas se envian por TX en trozos de 20 bytes con `\n` final para tolerar
el MTU BLE por defecto. `INFO` usa JSON compacto por el mismo motivo.

## Identidad

- `deviceId` = ultimos 6 hex (MAYUSCULA) de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. `PYBOT-A34F21`). Estable entre reinicios.

Ver `docs/PYBOT_BLE_RUNTIME.md` para la doc completa y el checklist de pruebas manuales.
