# PyBot BLE Runtime

Sistema para **preparar un ESP32 por USB** y luego usarlo de forma **inalámbrica por
Bluetooth BLE** desde PyBot Web. Todo lo nuevo está encapsulado en módulos/archivos
nuevos; no altera EDA6, USB/Firmata, Pyodide ni el mecanismo de ejecución existente.

## 1. Arquitectura y enfoque elegido

La arquitectura ESP32 de PyBot es **MicroPython + transferencia de archivos por raw
REPL** (no esptool/`.bin`/offsets). Por eso el runtime BLE se implementa como un
**programa MicroPython** que usa el módulo `bluetooth` incorporado, y se instala en la
placa **reutilizando el mecanismo existente `installFile`** (raw REPL), exactamente
igual que se instala `EDA6.py`.

**Por qué este enfoque (y no firmware compilado con esptool):**

- Respeta el guardrail: reutiliza una rutina de transferencia ya probada, sin inventar
  offsets, sin esptool nuevo, sin pedirle al usuario compilar ni descargar binarios.
- El "binario" es código fuente `.py` versionado en el repo, fácil de mantener y auditar.
- No toca el flujo USB/Firmata ni el de EDA6.

**Limitación (documentada):** el ESP32 debe tener **MicroPython** previamente (igual que
hoy para EDA6). Instalar MicroPython base en una placa en blanco requeriría `esptool-js`
y queda **fuera de este MVP**.

## 2. Ubicación de los archivos

| Archivo | Rol |
| --- | --- |
| `firmware/pybot-ble-runtime/main.py` | Runtime MicroPython (se instala como `main.py`). |
| `firmware/pybot-ble-runtime/README.md` | Doc breve del runtime. |
| `src/bleProtocol.js` | Protocolo puro: UUIDs, comandos, Device ID, parse/format (testeable). |
| `src/bluetoothTransport.js` | Capa aislada de Web Bluetooth (connect/disconnect/send/onData…). |
| `src/pybotBleRuntime.js` | Carga el fuente del runtime (`?raw`) + constantes de versión. |
| `src/BluetoothPanel.jsx` | UI de conexión BLE + panel de diagnóstico. |
| `src/hardwareBridge.js` | `installBleRuntime()` (reutiliza `installFile` + `softReset`). |
| `src/micropythonEsp32Session.js` | `installFile()` ahora acepta `onProgress` opcional. |

## 3. Instalación desde PyBot Web (preparar por USB)

1. Elegí una placa ESP32 (`ESP32 MicroPython` o `ESP32 EDA6 / WEMOS`) y conectá por **USB**.
2. Menú **Placa → Herramientas de la placa → "Instalar PyBot Bluetooth"**.
3. PyBot escribe el runtime como `main.py` por raw REPL (con **progreso real** %),
   verifica el archivo, y reinicia la placa (`softReset`).
4. Mensajes: *"PyBot Bluetooth instalado correctamente."* / *"El ESP32 ya puede
   utilizarse mediante Bluetooth."* / *"Podés desconectar el cable de datos."*

El usuario **no** elige `.bin`, **no** conoce offsets, **no** descarga firmware, **no**
usa terminal/esptool/Arduino IDE.

## 4. Servicio BLE (GATT)

| Rol | UUID | Propiedad |
| --- | --- | --- |
| PYBOT SERVICE | `8fbc0001-4d5a-4b8c-9a1f-123456789001` | — |
| RX (PyBot Web → ESP32) | `8fbc0002-4d5a-4b8c-9a1f-123456789002` | WRITE |
| TX (ESP32 → PyBot Web) | `8fbc0003-4d5a-4b8c-9a1f-123456789003` | NOTIFY |

Separación conceptual dentro del runtime: `BluetoothTransport` (solo bytes por BLE),
`CommandProcessor` (interpreta texto → respuesta) y `HardwareController` (LED). Flujo:
**BLE RX → CommandProcessor.process() → HardwareController → BLE TX notify**. Esto permite
reutilizar el mismo protocolo por USB/WiFi en el futuro.

## 5. Protocolo y comandos (MVP)

| Comando | Respuesta |
| --- | --- |
| `PING` | `PONG` |
| `INFO` | JSON compacto (ver abajo) |
| `LED,1` | `OK` (enciende LED integrado) |
| `LED,0` | `OK` (apaga) |
| (desconocido) | `ERR,UNKNOWN_COMMAND` |
| (muy largo) | `ERR,TOO_LONG` |

`INFO` (JSON **compacto** por el MTU BLE):

```json
{"device":"PYBOT-A34F21","id":"A34F21","firmware":"1.0.0","protocol":"1.0","runtime":"PyBot BLE Runtime","board":"ESP32"}
```

**Framing / MTU:** las respuestas se envían por TX en trozos de 20 bytes con `\n` como
delimitador de mensaje, para tolerar el MTU BLE por defecto (23 → ~20 útiles). PyBot Web
acumula notificaciones y separa por `\n`.

**Robustez:** longitud máxima `MAX_COMMAND_LENGTH = 64`; se rechazan comandos demasiado
grandes; mensajes vacíos se ignoran; errores de encoding → `ERR,BAD_ENCODING`; el IRQ BLE
nunca crashea (todo envuelto en try/except).

**Estados BLE:** `BOOT → WAITING (advertising) → CONNECTED → DISCONNECTED`. Al desconectar,
el ESP32 vuelve a advertising automáticamente (sin reset manual).

## 6. Identidad única y estable

- `deviceId` = **últimos 6 hex en MAYÚSCULA** de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. **`PYBOT-A34F21`**).
- Es **estable entre reinicios** (derivada del hardware, no aleatoria).
- El `deviceId` queda disponible para futuros alias (no implementados en este MVP).

## 7. Versionado

- `PYBOT_RUNTIME_VERSION = "1.0.0"`, `PYBOT_PROTOCOL_VERSION = "1.0"` (legibles por `INFO`).
- Definidos tanto en el runtime (`main.py`) como en `src/bleProtocol.js`.

## 8. Cómo se genera / instala el runtime

- Fuente: `firmware/pybot-ble-runtime/main.py` (versionado).
- `src/pybotBleRuntime.js` lo importa con Vite `?raw` y lo expone como texto.
- `hardwareBridge.installBleRuntime()` lo escribe con `installFile(...)` (base64 en chunks
  por raw REPL), verifica tamaño y ejecuta `softReset()`.

## 9. Placas soportadas (SUPPORTED_BOARDS)

- **ESP32 clásico (WROOM)** — objetivo inicial. LED integrado en **GPIO 2**
  (`BUILTIN_LED_PIN` en `main.py`).
- La API `bluetooth` de MicroPython es común a las variantes ESP32. Para **S3 / C3 / C6**
  debería funcionar ajustando `BUILTIN_LED_PIN` si el LED integrado difiere o no existe.
  No se ponen en riesgo las demás variantes por soportar todo en el MVP.

## 10. Conexión inalámbrica desde PyBot Web

Menú **Placa → "Conectar por Bluetooth (BLE)"** abre el panel BLE:

- `navigator.bluetooth.requestDevice()` filtra por **SERVICE UUID** (no solo por nombre).
- `device.gatt.connect()` → `getPrimaryService()` → `getCharacteristic(RX/TX)` →
  `TX.startNotifications()`.
- Muestra *"Bluetooth conectado / PYBOT-XXXXXX / ID / Firmware"* (si `INFO` responde) y
  botón **Desconectar**.
- Reconexión: escucha `gattserverdisconnected`, limpia el estado y permite reconectar.

USB conserva **exactamente** su comportamiento actual: BLE es un transporte independiente
y opcional; no reemplaza el cable.

## 11. Tests automatizados

- `npm test` (Node `--test`, sin dependencias nuevas):
  - `test/bleProtocol.test.mjs`: Device ID (MAC → `A34F21` → `PYBOT-A34F21`), comandos
    (PING/INFO/LED/desconocido/vacío/too-long), parseo de INFO, framing por `\n`.
  - `test/bluetoothTransport.test.mjs`: estado del transporte con **mock** de
    `navigator.bluetooth` (connect filtra por SERVICE UUID, send, onData con chunks,
    sendAndWait/timeout, desconexión, errores).
- `npm run build`: compila sin errores nuevos.
- **No** hay lint/typecheck configurados en el repo (proyecto JS con Vite); no se agregaron.

## 12. Pruebas MANUALES con hardware (checklist para el usuario)

> No hay ESP32 físico en el entorno de desarrollo: estas pruebas **quedan pendientes de
> validación del usuario**. No están marcadas como aprobadas.

1. **TEST 1 — Requisito**: ESP32 con MicroPython. Conectar por USB y elegir la placa ESP32.
2. **TEST 2 — Instalar**: Menú → "Instalar PyBot Bluetooth". Verificar progreso %, mensaje
   de éxito y que sugiere desconectar el cable.
3. **TEST 3 — Boot autónomo**: desconectar y reconectar energía; el LED/BLE debe arrancar
   solo (advertising) sin PC.
4. **TEST 4 — Descubrir**: en PyBot Web, Menú → "Conectar por Bluetooth"; aparece
   `PYBOT-XXXXXX` en el diálogo del navegador (Chrome/Edge de escritorio).
5. **TEST 5 — Conectar**: seleccionar el dispositivo; ver "Bluetooth conectado" + ID + firmware.
6. **TEST 6 — PING**: botón PING → respuesta `PONG`.
7. **TEST 7 — INFO**: botón INFO → JSON con device/id/firmware/protocol/runtime/board.
8. **TEST 8 — LED ON**: `LED,1` → `OK` y el LED integrado enciende.
9. **TEST 9 — LED OFF**: `LED,0` → `OK` y el LED apaga.
10. **TEST 10 — Comando desconocido**: enviar algo inválido → `ERR,UNKNOWN_COMMAND`
    (se puede probar con herramientas BLE genéricas).
11. **TEST 11 — Desconexión**: apagar/alejar el ESP32; la UI vuelve a estado desconectado y
    la placa vuelve a advertising sola.
12. **TEST 12 — Reconexión y múltiples placas**: reconectar; con dos placas, verificar que
    cada una aparece con su `PYBOT-XXXXXX` distinto (Device ID estable por hardware).

## 13. Fuera de alcance (no incluido, a propósito)

EDA6 por BLE, servos/motores/sensores por BLE, PWM/I2C/SPI/UART, WiFi/MQTT/OTA, alias,
Supabase. El MVP se limita a PING/INFO/LED + identidad + conexión BLE estable.
