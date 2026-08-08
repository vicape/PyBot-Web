# PyBot BLE Runtime

Sistema para **preparar un ESP32 por USB** y luego usarlo de forma **inalámbrica por
Bluetooth BLE** desde PyBot Web. Todo lo nuevo está encapsulado en módulos/archivos
nuevos; no altera EDA6, USB/Firmata, Pyodide ni el mecanismo de ejecución existente.

> **Protocolo 2.0 (ejecución completa):** además de PING/INFO/LED (MVP 1.0), el runtime
> ahora **ejecuta los programas del alumno recibidos por BLE** y transmite la salida por
> Bluetooth, en los dos modos **ESP32 MicroPython (GPIO directo)** y **ESP32 EDA6**, con
> Stop y manejo de errores. Ver la sección **5-bis. Protocolo de ejecución**.

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
| `src/bleProtocol.js` | Protocolo puro: UUIDs, comandos, Device ID, **framing RUN + base64** (testeable). |
| `src/bluetoothTransport.js` | Capa aislada de Web Bluetooth (connect/disconnect/send/**sendChunked**/onData…). |
| `src/bleRunSession.js` | **Ejecución por BLE**: envía el código en chunks, recibe OUT/ERR/DONE, manda STOP. |
| `src/pybotBleRuntime.js` | Carga el fuente del runtime (`?raw`) + constantes de versión. |
| `src/BluetoothPanel.jsx` | UI de conexión BLE + panel de diagnóstico (usa la conexión compartida del bridge). |
| `src/hardwareBridge.js` | `installBleRuntime()`, **adaptador serial/BLE** (`runOnBoard`, `interruptBoard`, `bleRunConnect`). |
| `src/micropythonEsp32Session.js` | `installFile()` con `onProgress` (reutilizado para grabar los preludios). |

**Archivos que viajan a la placa** (instalados por USB en "Instalar PyBot Bluetooth"):

| Archivo en la placa | Origen (única fuente) | Rol |
| --- | --- | --- |
| `main.py` | `firmware/pybot-ble-runtime/main.py` | Runtime BLE (arranca solo al boot). |
| `pybot_mpy.py` | `MPY_PRELUDE` (`src/micropythonEsp32Session.js`) | Preludio GPIO directo: `pin/servo/motor/wait`. |
| `EDA6.py` | `src/assets/EDA6.py` (con el perfil elegido) | Librería EDA6: `salidaDigital/servomotor/…`. |

## 3. Instalación desde PyBot Web (preparar por USB)

1. Elegí una placa ESP32 (`ESP32 MicroPython` o `ESP32 EDA6 / WEMOS`) y conectá por **USB**.
2. Menú **Placa → Herramientas de la placa → "Instalar PyBot Bluetooth"**.
3. PyBot instala **las librerías en la placa** (`pybot_mpy.py` y `EDA6.py` con el perfil
   elegido) y luego escribe el runtime como `main.py` por raw REPL (con **progreso real** %),
   verifica el archivo, y reinicia la placa (`softReset`). Así el runtime puede ejecutar
   código mpy/eda6 sin transferir las librerías por BLE.
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

## 5-bis. Protocolo de EJECUCIÓN (protocolo 2.0)

Permite correr el programa del alumno EN la placa y transmitir su salida por BLE, en los
modos **mpy** (GPIO directo) y **eda6**. Reutiliza las mismas características RX/TX.

**Idea clave — los preludios NO viajan por BLE.** Las librerías (`pybot_mpy.py` y `EDA6.py`)
se instalan como archivos `.py` en la placa (por USB, junto con el runtime). Por BLE solo
viaja el **código del alumno + modo + perfil**. Esto ahorra el escaso ancho de banda BLE.

**Framing.** Todo va por líneas (`\n` como delimitador). Los payloads arbitrarios (código,
salida, errores) se codifican en **base64** para no chocar con el delimitador. El envío de
frames largos se parte en escrituras GATT de ≤20 bytes (`sendChunked`) para tolerar el MTU
por defecto; el firmware reensambla por `\n`.

**PyBot Web → ESP32 (RX write):**

| Frame | Significado |
| --- | --- |
| `RUN:BEGIN:<mode>:<profile>` | Inicia una ejecución. `mode` ∈ `mpy`\|`eda6`; `profile` ∈ `WEMOS`\|`ESP32`. Resetea el buffer. |
| `RUN:CHUNK:<base64>` | Un fragmento del código fuente (base64). Se envían en orden. |
| `RUN:END` | Fin de la transferencia → la placa ejecuta. |
| `STOP` | Aborta el programa en ejecución. |

**ESP32 → PyBot Web (TX notify):**

| Frame | Significado |
| --- | --- |
| `RUN:READY` | Buffer reseteado; listo para recibir chunks. |
| `RUN:STARTED` | El programa empezó a ejecutarse. |
| `RUN:OUT:<base64>` | Un trozo de la salida (`print`) del programa, en tiempo real. |
| `RUN:ERR:<base64>` | Error / traceback de runtime. |
| `RUN:DONE` | El programa terminó (fin normal **o** detenido por STOP/desconexión). |
| `RUN:ERROR:<code>` | Error de protocolo: `BUSY`, `TOO_LONG`, `NO_PROGRAM`, `BAD_ENCODING`, `BAD_FRAME`. |

**Modos y preludios en la placa.**

- **mpy:** el runtime hace `import pybot_mpy` y expone `pin/servo/motor/wait` en el namespace
  del `exec()`. ADC escalada 0–1023 (igual que el flujo serial).
- **eda6:** el runtime hace `import EDA6`, fija `EDA6.PLACA_ACTUAL = <profile>` (WEMOS/ESP32,
  dinámico según el menú), expone `salidaDigital/entradaDigital/entradaAnalogica/servomotor/
  motorRC/sensorDistancia/detenerTodo/printLCD/…` y llama `detenerTodo()` antes y después de
  correr (estado seguro). Además expone `pin/servo/motor/wait` (como el flujo serial EDA6).

**Streaming de salida.** El runtime reemplaza `print` en el namespace del programa por una
función que codifica el texto en base64 y lo envía como `RUN:OUT:` en trozos. Los errores se
capturan con `sys.print_exception` y se envían como `RUN:ERR:`.

**Stop / interrupción.** MicroPython es mono-hilo. El IRQ de BLE es un callback *soft* que
corre **entre bytecodes**, por eso el programa del alumno **no** se ejecuta dentro del IRQ
(bloquearía la recepción de STOP): el IRQ solo reensambla y marca `pending`, y el **bucle
principal** invoca la ejecución. Mientras el programa corre, un `STOP` entrante dispara el IRQ,
que setea una bandera de stop. El runtime **parchea `time.sleep`** por una versión que duerme
en tramos chequeando esa bandera y lanza `_PyBotStop` para cortar. Esto detiene cualquier
`while True` que use `wait()`/`time.sleep`/barridos de servo/etc. — es decir, prácticamente
todos los programas educativos. Al detener (o desconectar), en modo eda6 se llama
`detenerTodo()` y se envía `RUN:DONE`.

**Límites y robustez.**

- `MAX_PROGRAM_LENGTH = 8192` bytes de fuente (el web rechaza antes de enviar; el firmware
  responde `RUN:ERROR:TOO_LONG` si se excede).
- Frames corruptos / base64 inválido → `RUN:ERROR:BAD_ENCODING` / `BAD_FRAME`.
- `RUN:BEGIN` con un programa ya corriendo → `RUN:ERROR:BUSY`.
- Desconexión durante la ejecución → se aborta el programa y la placa vuelve a advertising.
- El buffer RX se limita (`_RX_BUF_MAX`) para no crecer sin control.

**Limitación honesta (documentada en la UI).** El ancho de banda BLE es bajo: programas
grandes o con **mucho** `print` van lentos. Se mantiene chunking; para programas grandes
conviene **grabar en la placa** por USB. Un `while True: pass` *sin* `wait()`/hardware no puede
interrumpirse por software (requiere apagar/prender) — igual que colgaría cualquier bucle sin
puntos de yield; los programas educativos casi siempre incluyen `wait()`.

**Elección de transporte (serial vs BLE), sin romper serial.** En `hardwareBridge.js`,
`runOnBoard()` usa el camino **serial EXACTAMENTE como hoy** cuando hay una sesión serial
activa (`_mpSession`); si no hay serial pero hay una ESP32 por BLE (`_bleRun`), ejecuta por
Bluetooth. `interruptBoard()` manda `Ctrl-C` por serial o `STOP` por BLE según corresponda.
El serial tiene prioridad, así su comportamiento no cambia.

## 6. Identidad única y estable

- `deviceId` = **últimos 6 hex en MAYÚSCULA** de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. **`PYBOT-A34F21`**).
- Es **estable entre reinicios** (derivada del hardware, no aleatoria).
- El `deviceId` queda disponible para futuros alias (no implementados en este MVP).

## 7. Versionado

- `PYBOT_RUNTIME_VERSION = "2.0.0"`, `PYBOT_PROTOCOL_VERSION = "2.0"` (legibles por `INFO`).
- Se subió a **2.0** porque el protocolo agrega la ejecución de programas (RUN/OUT/STOP);
  PING/INFO/LED se mantienen 100% compatibles.
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
  - **Preexistentes:**
    - `test/bleProtocol.test.mjs`: Device ID, comandos (PING/INFO/LED/desconocido/vacío/
      too-long), parseo de INFO, framing por `\n`.
    - `test/bluetoothTransport.test.mjs`: estado del transporte con **mock** de
      `navigator.bluetooth` (connect filtra por SERVICE UUID, send, onData con chunks,
      sendAndWait/timeout, desconexión, errores).
  - **Nuevos (protocolo de ejecución 2.0):**
    - `test/bleRunProtocol.test.mjs`: base64 puro (round-trip + vectores conocidos),
      `chunkProgram`/`reassembleProgram` sin pérdida, `buildRunBegin`/`parseRunBegin`
      (modo/perfil), `parseRunFrame` (READY/STARTED/OUT/ERR/DONE/ERROR), límite de tamaño.
    - `test/bleRunSession.test.mjs`: `BleRunSession` con un **mock del firmware**: envía
      BEGIN con modo/perfil, reensambla el programa exacto, streamea OUT, resuelve en DONE;
      `stop()` y el poller `shouldStop()` abortan un programa largo; rechazo por tamaño;
      error si no hay conexión; desconexión durante la ejecución.
  - Total: **45 tests** en verde (14 preexistentes + 31 nuevos).
- `npm run build`: compila sin errores nuevos (solo el warning preexistente de tamaño de chunk).
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

### 12-bis. Ejecución de programas por BLE (protocolo 2.0)

> Requiere haber instalado por USB (deja `main.py` + `pybot_mpy.py` + `EDA6.py`).
> Elegí la placa correcta en el menú (`ESP32 MicroPython` o `ESP32 EDA6`) y conectá por BLE.

13. **RUN 1 — mpy print**: placa `ESP32 MicroPython`, conectar por BLE. Programa
    `for i in range(5): print(i); wait(0.3)`. **Ejecutar** → la salida aparece en la consola
    en tiempo real; al final `RUN:DONE`/`[Fin]`.
14. **RUN 2 — mpy salida digital / PWM**: `pin(2, 1)` / `pin(2, 0)` (LED), y `pin("pwm", 5, 128)`.
    Verificar el pin físico.
15. **RUN 3 — mpy servo y motor**: `servo(13, 0, 180)` (barrido) y `motor(13, 50)`. Verificar
    movimiento.
16. **RUN 4 — mpy entrada analógica**: `print(pin(34))` con un potenciómetro; valor 0–1023.
17. **RUN 5 — Stop mpy**: `while True: print("x"); wait(0.5)`. **Detener** → el programa corta,
    la consola muestra `[Detenido]` y la placa queda lista para otro Run **sin reset**.
18. **RUN 6 — eda6 salida/entrada**: placa `ESP32 EDA6`, perfil WEMOS o ESP32. Programa con
    `salidaDigital(1, True)`, `entradaDigital(1)`, `entradaAnalogica(1)`. Verificar puertos.
19. **RUN 7 — eda6 servo/motor**: `servomotor(1, 90)` y `motorRC(1, 50)`. Verificar movimiento.
20. **RUN 8 — eda6 sensor de distancia**: `print(sensorDistancia(1))`.
21. **RUN 9 — eda6 LCD**: `printLCD(0, 0, "Hola")` con un LCD I2C conectado.
22. **RUN 10 — perfil eda6**: cambiar WEMOS↔ESP32 en el menú y verificar que los pines cambian
    (el `profile` viaja en `RUN:BEGIN`).
23. **RUN 11 — Stop eda6**: `while True: salidaDigital(1, True); wait(0.5); salidaDigital(1, False); wait(0.5)`.
    **Detener** → corta y `detenerTodo()` apaga salidas.
24. **RUN 12 — errores**: programa con error (`print(no_existe)`); el traceback llega como
    `RUN:ERR` a la consola, sin colgar la placa.
25. **RUN 13 — desconexión durante ejecución**: correr un `while True` y alejar/apagar la placa;
    al reconectar debe volver a funcionar (advertising + Run).
26. **RUN 14 — serial intacto**: con la MISMA placa por **USB** (sin BLE), verificar que Run,
    EDA6, flashear y Detener siguen funcionando **igual que antes**.

## 13. Fuera de alcance (no incluido, a propósito)

WiFi/MQTT/OTA, alias, Supabase. **Sí** están incluidos ahora: ejecución de programas por BLE
en modos **mpy** y **eda6** (servos/motores/sensores/LCD según el hardware), streaming de
salida y Stop. Queda fuera instalar MicroPython base en una placa en blanco (requiere
`esptool-js`).
