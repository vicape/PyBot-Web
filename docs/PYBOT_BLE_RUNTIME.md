# PyBot BLE Runtime

Sistema para **preparar un ESP32 por USB** y luego usarlo de forma **inalámbrica por
Bluetooth BLE** desde PyBot Web. Todo lo nuevo está encapsulado en módulos/archivos
nuevos; no altera EDA6, USB/Firmata, Pyodide ni el mecanismo de ejecución existente.

> **Protocolo 2.0 (ejecución completa):** además de PING/INFO/LED (MVP 1.0), el runtime
> ejecuta los programas del alumno recibidos por BLE y transmite la salida por Bluetooth,
> en los dos modos **ESP32 MicroPython (GPIO directo)** y **ESP32 EDA6**, con Stop y manejo
> de errores. Ver la sección **5-bis. Protocolo de ejecución**.
>
> **Protocolo 3.0 (STOP confiable + DEPLOY autónomo):** el runtime ahora agrega **STOP
> confiable** (confirmación `RUN:STOPPED` + recuperación real `STOP:FORCE` con *safe boot*),
> **DEPLOY persistente verificado** (transferencia atómica con size+hash a `pybot_app.py`),
> **control de la app** (`APP:*`) y **autostart** al encender. Ver **5-ter. Protocolo 3.0**.
>
> **Runtime 3.0.1 (framing compatible, endurecimiento):** DEPLOY **realmente
> transaccional** con backup/rollback (`pybot_app.bak` / `pybot_app.json.tmp` / `.bak`),
> **hash obligatorio** si se declaró verificación (`DEPLOY:ERROR:HASH_UNAVAILABLE` cuando no hay
> `uhashlib`), **`APP:STOP`/`APP:DELETE` confirmados de verdad** (responden cuando la app
> **realmente** paró, no al recibir el pedido), errores de filesystem explícitos
> (`APP:ERROR:WRITE_FAILED` / `DELETE_FAILED`), *safe boot* verificado antes del reset y
> watchdog de recuperación del RUN temporal al perder el BLE. El framing 3.0 **no** cambia.
> EJECUTAR (temporal) vs BAJAR (persistente/autónomo): *EJECUTAR* corre el programa en la
> placa mientras estás conectado; *BAJAR* lo guarda en la placa para que corra **solo, sin PC/
> navegador/BLE/Internet**, y sobreviva un power cycle, mientras el BLE sigue disponible para
> administrarlo.
>
> **Runtime 3.1.0 / protocolo 3.1 (OTA Runtime Update):** el runtime puede **actualizarse a sí
> mismo por Bluetooth** (OTA), sin volver a USB salvo recuperación extrema. Nueva capability
> `runtime-update`, comandos `UPDATE:*` (transferencia verificada por SHA-256 a
> `pybot_runtime.new`), un `boot.py` **mínimo y estable** que aplica el swap con backup
> (`pybot_runtime.bak`) y **rollback** si el runtime nuevo no confirma su arranque, y estado
> transaccional en `pybot_update.json`. La primera instalación sigue siendo por **USB** (para
> dejar `boot.py` + `main.py`); a partir de ahí las futuras se hacen por **BLE**. El programa del
> alumno (`pybot_app.py`/`pybot_app.json`) y el autostart se **conservan** intactos. Ver
> **5-quater. Protocolo 3.1 — OTA Runtime Update**.
>
> **Runtime 3.2.0 (protocolo 3.1, shrink de RAM al boot):** el monolito `main.py` se parte en
> módulos con **lazy-load** (`pybot_ble` + stub `main.py` al boot; RUN/DEPLOY/UPDATE solo al
> usarse). `boot.py` queda mínimo y delega el apply en `pybot_boot_update.py`. El OTA envía un
> pack multi-archivo `PYBOTRT1`. El salto **3.1.x → 3.2.0 requiere una reinstalación USB**
> (el boot antiguo no entiende el pack); a partir de 3.2.0 el OTA multi-archivo vuelve a
> funcionar. Objetivo: que la ESP32 vuelva a `gap_advertise()` sin `MemoryError`.
>
> **Runtime 3.2.3:** los comandos no urgentes (`RUN:*`, PING/INFO, …) se encolan en el IRQ
> GATT y se procesan en el hilo principal (`poll_commands`). Así `RUN:READY` ya no hace
> `gatts_notify`+`sleep` dentro del IRQ (que tras un Run→Stop dejaba el segundo Run sin
> READY y caía el BLE). `STOP`/`STOP:FORCE` siguen siendo urgentes (solo flags en IRQ).
>
> **Runtime 3.2.4 (crítico aula):** con app persistente en `exec()`, el main loop no
> drena la cola — en 3.2.3 `STOP:FORCE` solo seteaba un flag que nunca se veía → placa
> zombie. Ahora `STOP:FORCE` agenda reset por **Timer**; `APP:STOP`/`APP:DELETE` son
> urgentes (flags en IRQ); tras FORCE, `safe_boot` es sticky y se apaga autostart.
> Recuperación USB: «Borrar programa BLE de la placa (USB)» (no alcanza solo reinstalar
> el runtime: ese flujo **preserva** `pybot_app.*`). Actualización desde 3.2.x: **OTA o USB**.
>
> **Runtime 3.2.5:** `APP:STOP` urgente/ACK diferido para **cualquier** programa en
> `exec` (no solo app persistente); Timer FORCE con fallback `0`/`1`; la UI Stop por
> BLE intenta siempre (aunque no haya `running` local — p.ej. autostart). Placas
> **&lt; 3.2.4** reciben aviso “actualizá runtime para Stop fiable”.

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
| `firmware/pybot-ble-runtime/main.py` | Stub de arranque (`import pybot_ble`). |
| `firmware/pybot-ble-runtime/pybot_ble.py` | Núcleo BLE (advertising / PING / INFO / dispatch). |
| `firmware/pybot-ble-runtime/pybot_run.py` | RUN/STOP (lazy). |
| `firmware/pybot-ble-runtime/pybot_deploy.py` | DEPLOY/APP (lazy). |
| `firmware/pybot-ble-runtime/pybot_update.py` | UPDATE OTA (lazy). |
| `firmware/pybot-ble-runtime/pybot_boot_update.py` | Apply/rollback OTA (legacy + pack). |
| `firmware/pybot-ble-runtime/boot.py` | Boot mínimo (solo si hay `pybot_update.json`). |
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
| `boot.py` | `firmware/pybot-ble-runtime/boot.py` | Boot mínimo OTA. |
| `main.py` | `firmware/pybot-ble-runtime/main.py` | Stub que importa el núcleo. |
| `pybot_ble.py` | `firmware/pybot-ble-runtime/pybot_ble.py` | Núcleo BLE al boot. |
| `pybot_run.py` / `pybot_deploy.py` / `pybot_update.py` / `pybot_boot_update.py` | mismos paths en `firmware/pybot-ble-runtime/` | Módulos lazy / OTA apply. |
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

> **Nota de UI (solo BLE).** El mensaje del terminal *"Subiendo la librería EDA6…"*
> (`eda6RunUploading`) aplica **solo al camino serial** (donde el preludio EDA6 se inyecta al
> ejecutar). Por **BLE** la librería ya vive en la placa (instalada por USB): solo viaja el
> código del alumno, así que ese mensaje **no** se muestra.

**Chequeo de compatibilidad de versión (preflight BLE).** Antes de ejecutar por Bluetooth,
`runOnBoardBle()` verifica que la placa tenga el runtime con soporte RUN, usando el `INFO`
(cacheado o consultado al momento) y `runtimeSupportsRun(info)` (en `bleProtocol.js`). Si el
`INFO` confirma un runtime **viejo** (protocol/firmware `1.x`), lanza `BLE_RUNTIME_OUTDATED`
con un mensaje claro que guía a **reinstalar por USB** — en vez de dejar que el Run muera por
timeout a los 6 s. Si `INFO` no responde, no bloquea (fallback al timeout de `RUN:READY`). El
panel BLE de diagnóstico también muestra un aviso cuando el firmware es viejo.

## 5-ter. Protocolo 3.0 — STOP confiable + DEPLOY autónomo + control de app

Arquitectura de ejecución (motor único):

```
PyBot Web → BleRunSession / BleDeploySession → BluetoothTransport → GATT →
  Runtime (main.py) → ProgramManager [TEMPORARY | PERSISTENT] → EDA6 / pybot_mpy → hardware
```

`ProgramManager` es el **motor único** de ejecución: los modos TEMPORARY (RUN por BLE) y
PERSISTENT (app instalada por DEPLOY / autostart) comparten namespace, preludio (mpy/eda6),
`print`, manejo de errores, STOP cooperativo, cleanup de hardware, estado y recuperación.

### Archivos en la placa (protocolo 3.0)

| Archivo | Rol | ¿Lo toca una actualización de runtime? |
| --- | --- | --- |
| `boot.py` | Updater/rollback manager (aplica/revierte OTA antes de `main.py`). | Sí (por USB; muy estable). |
| `main.py` | Runtime permanente (BLE + ProgramManager + DeployReceiver + RuntimeUpdateReceiver). | Sí (se reescribe, por OTA o USB). |
| `pybot_mpy.py` / `EDA6.py` | Preludios (GPIO directo / EDA6). | Sí (se reescriben). |
| `pybot_app.py` | **Programa del alumno persistente**. | **No** (se conserva). |
| `pybot_app.json` | Metadata: `version/mode/profile/autostart/size/hash/runtime`. | **No** (se conserva si es compatible). |
| `pybot_app.tmp` / `pybot_app.bak` | Temporal y **backup** del reemplazo transaccional del programa. | — (efímeros; se limpian al terminar o al boot). |
| `pybot_app.json.tmp` / `pybot_app.json.bak` | Temporal y **backup** del reemplazo transaccional de la metadata. | — (efímeros). |
| `pybot_state.json` | `safe_boot` + `fail_count` + `last_error` (autostart / recuperación). | **No**. |

El programa del alumno **nunca** reemplaza el runtime; son archivos distintos.

### STOP confiable

- **`STOP` (cooperativo):** el runtime parchea `time.sleep`/`sleep_ms`/`sleep_us` y ofrece
  `wait()`/`sleep()` interrumpibles; cualquier espera chequea la bandera y lanza `_PyBotStop`.
  Cubre `sensorDistancia`/`servomotor`/`motorRC`/LCD/PWM/`while` que usen esperas — es decir,
  prácticamente todos los programas educativos. `sleep_us` **no** se parte en tramos (timing
  crítico de HC-SR04/LCD): solo se chequea el stop tras el retardo exacto. La API pública de
  EDA6 **no** cambia. Al detener se confirma con **`RUN:STOPPED`** (distinto de `RUN:DONE`).
- **Cleanup SIEMPRE:** fin normal, STOP, excepción, STOP FORCE, reemplazo de programa y
  recuperación llaman `detenerTodo()` (EDA6) y `_pybot_cleanup()` (GPIO directo: apaga/libera
  PWM y salidas creadas por PyBot, no toca entradas).
- **`STOP:FORCE` (recuperación REAL):** un bucle que **no** cede (`while True: pass`) no puede
  cortarse por software cooperativo. `STOP:FORCE` marca *safe boot*, apaga autostart y agenda
  `machine.reset()` por **Timer** (el IRQ GATT solo setea flags / arma el Timer — nunca hace
  notify/sleep/reset en el IRQ). Esto funciona **aunque** el main loop esté bloqueado en
  `exec()` de la app persistente (regresión 3.2.3 → fix 3.2.4). La web escala a `STOP:FORCE`
  automáticamente si tras `STOP`/`APP:STOP` no llega confirmación (~3.5 s). La UI muestra
  *"Deteniendo…"* mientras espera y *"Programa detenido"* solo con evidencia (`RUN:STOPPED` o
  la desconexión por el reset). Si el FORCE venía de un `APP:DELETE` pendiente, borra
  `pybot_app.*` **antes** del reset.
- **SAFE BOOT (anti boot-loop, sticky en 3.2.4):** tras un `STOP:FORCE`, el runtime arranca con
  BLE pero **no** relanza la app y **mantiene** `safe_boot` hasta un `APP:START` explícito o un
  DEPLOY nuevo (no se limpia solo al boot). Además se apaga `autostart` en metadata.
- **Recuperación del RUN temporal sin desenchufar:** al perder el BLE con un RUN **temporal** en
  curso, el runtime pide STOP cooperativo y arma un *watchdog* (soft `Timer`) que, si el programa
  no cede en ~1.8 s y seguimos desconectados, fuerza el reset — así un programa temporal no queda
  huérfano ejecutando sin controlador. La **app persistente** autónoma, en cambio, **sigue**
  corriendo al perder el BLE (esa es su función). Si el port no soporta `Timer`, queda el STOP
  cooperativo (cubre los programas con `wait()`); un bucle 100% *tight* sin controlador requeriría
  power cycle.
- **STOP unificado (web).** Una sola abstracción `stopBoardExecution()` decide con el ESP32 como
  fuente de verdad: serial → `Ctrl-C`; BLE RUN temporal → `STOP`/escalado; **app persistente
  corriendo** (aunque haya arrancado por autostart, sin sesión web) → `APP:STOP` y, si no cede,
  `STOP:FORCE`.

### DEPLOY (transferencia atómica verificada)

```
PyBot Web → ESP32                     ESP32 → PyBot Web
DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash>   DEPLOY:READY
DEPLOY:CHUNK:<base64>   (una por bloque)      DEPLOY:ACK:<n>   (ACK por bloque)
DEPLOY:END                                    DEPLOY:VERIFY:OK | DEPLOY:ERROR:<code>
DEPLOY:ABORT                                  (cancela; conserva la app anterior)
```

- Escribe a `pybot_app.tmp`; al `END` verifica **tamaño** y **hash SHA-256** (`uhashlib` en la
  placa; JS puro en la web) y solo entonces hace el **reemplazo transaccional** de `pybot_app.py`
  + metadata. Si algo falla, borra el tmp y **conserva la app anterior intacta**.
- **Reemplazo REALMENTE transaccional (con backup/rollback).** Esquema
  `pybot_app.py` / `.bak` / `.tmp` y `pybot_app.json` / `.tmp` / `.bak`:
  metadata nueva → `pybot_app.json.tmp` (se verifica releyéndola) → si hay app actual `app→bak`
  → `tmp→app` → `meta→meta.bak` → `meta.tmp→meta` → **verificar** app (size) + metadata
  (relegible) → borrar backups. Si **cualquier** paso falla, se **restaura** desde el backup: nunca
  queda sin una app válida si la había, ni con **programa nuevo + metadata vieja** (o al revés):
  programa y metadata **siempre** se corresponden. Al boot, `_recover_incomplete_deploy()` repara
  un DEPLOY cortado por un corte de energía (restaura desde backup y limpia temporales).
- **Hash obligatorio si se declara VERIFY (P0-9).** Si se envió un hash pero el port **no** tiene
  `uhashlib` (no se puede verificar la integridad criptográfica), el runtime **no** afirma una
  verificación que no ocurrió: responde **`DEPLOY:ERROR:HASH_UNAVAILABLE`** y conserva la app
  anterior. En ESP32 `uhashlib` está presente (caso normal → `VERIFY:OK`).
- **ACK por bloque** (una línea `DEPLOY:CHUNK`, no por fragmento GATT de 20 B): da backpressure
  y detección de pérdidas sin miles de round-trips.
- Códigos de error: `BUSY`, `TOO_LONG`, `BAD_ENCODING`, `BAD_HASH`, `HASH_UNAVAILABLE`,
  `WRITE_FAILED`, `VERIFY_FAILED`, `INVALID_MODE`, `INVALID_PROFILE`, `NO_SPACE`, `BAD_FRAME`.
- Límites separados: **`MAX_RUN_PROGRAM_SIZE = 8192`** (RUN temporal, en RAM) y
  **`MAX_DEPLOY_PROGRAM_SIZE = 16384`** (persistente, a flash por chunks).

### Control de la app (APP:*)

| Comando | Respuesta | Efecto |
| --- | --- | --- |
| `APP:INFO` | `APP:INFO:<json>` | `installed/running/autostart/mode/profile/size/hash/safe/fail/error`. Fuente de verdad para la web. |
| `APP:START` | `APP:OK:START` + frames `RUN:*` | Ejecuta `pybot_app.py` y streamea salida. |
| `APP:STOP` | `APP:OK:STOP` (diferido) / `APP:ERROR:*` | Si hay app corriendo, pide STOP y responde **`APP:OK:STOP` cuando realmente paró** (no al recibir el pedido). Si no hay nada corriendo, confirma de inmediato. Un bucle que no cede **no** confirma: la web escala a `STOP:FORCE`. |
| `APP:DELETE` | `APP:OK:DELETE` / `APP:ERROR:DELETE_FAILED` | Si corre: detiene → borra al terminar. Si no: borra ya. En ambos casos **verifica la ausencia** de `pybot_app.py`/metadata (sin éxito ficticio). NO borra `main.py`/`EDA6.py`/`pybot_mpy.py`. |
| `APP:AUTOSTART:1\|0` | `APP:OK:AUTOSTART` / `APP:ERROR:WRITE_FAILED` | Habilita/deshabilita autostart; **no** confirma OK si la persistencia falló. |

Errores APP: `NO_APP`, `BUSY`, `READ_FAILED`, `WRITE_FAILED`, `DELETE_FAILED`, `BAD_FRAME`.

### Autostart en boot

El runtime arranca → levanta BLE → si hay app instalada con `autostart` y **no** hay safe boot
ni demasiados fallos, ejecuta `pybot_app.py`. Si la app lanza una excepción: captura el
traceback, hace cleanup de hardware, incrementa `fail_count`, **mantiene el BLE**, lo informa
por `APP:INFO` y **no** borra el código del alumno ni entra en boot-loop. La app autónoma
**no** se detiene al perder el controlador BLE (ese es el punto); un RUN temporal sí.

### "Bajar a ESP32" (BLE) — flujo

`Bajar = guardar + verificar (size+hash) + autostart + EJECUTAR inmediato`. Tras un DEPLOY
exitoso la web ejecuta la app guardada de una (`APP:START`) y streamea su salida — no se da por
terminado solo por guardar. **Reemplazo de app existente (redeploy):** antes del DEPLOY, la web
detiene la ejecución en curso (RUN temporal y/o app persistente) de forma **cooperativa** para no
chocar con `DEPLOY:ERROR:BUSY`; luego transfiere la nueva a `tmp` → verifica → reemplazo
transaccional → metadata → ejecuta. Si algo falla, la anterior queda intacta.

> **Limitación honesta (redeploy).** La detención previa al redeploy es **cooperativa** (cubre los
> programas con `wait()`, que son casi todos). Si la app en curso es un bucle que **no** cede, el
> DEPLOY responde `BUSY` y la UI lo informa (no se fuerza un reset a mitad del deploy porque el
> reset caería el BLE y abortaría la transferencia). En ese caso, detené con **Detener** (que sí
> escala a `STOP:FORCE`) y reintentá. Si un `STOP:FORCE` reinicia la placa, la reconexión GATT por
> **Web Bluetooth** puede requerir volver a elegir el dispositivo según el navegador.

Mensaje de éxito: *"Programa verificado y guardado en ESP32. La placa puede ejecutarlo sin la
computadora. Autostart activado."*

### Compatibilidad e INFO.capabilities

`INFO` ahora expone `"capabilities":["run","stop","deploy","app-control","autostart","runtime-update"]`
(la última, `runtime-update`, se agregó en 3.1 para el OTA). La web
**prefiere capabilities** sobre inferencias por versión: `runtimeSupportsDeploy(info)`. Un
runtime **2.x** permite RUN pero **no** DEPLOY: la web informa *"Esta placa necesita actualizar
PyBot Bluetooth para usar Bajar a ESP32"* y **no** impide RUN.

## 5-quater. Protocolo 3.1 — OTA Runtime Update (actualización del runtime por BLE)

Permite que una ESP32 con runtime compatible **actualice su propio `main.py`** a una versión
más nueva **por Bluetooth**, de forma **transaccional, verificada (SHA-256) y con rollback**,
sin volver a USB salvo recuperación extrema. Es un canal **administrativo** (no una función
educativa expuesta al alumno).

### Arquitectura: `boot.py` (updater) + `main.py` (runtime)

```
Arranque ESP32:
  boot.py  (MÍNIMO, sin BLE/EDA6/hardware)  → aplica/revierte update pendiente → 
  main.py  (runtime BLE, ProgramManager, RuntimeUpdateReceiver) → confirma su arranque
```

- **`boot.py`** MicroPython lo ejecuta **antes** de `main.py` en cada boot. Su única
  responsabilidad es aplicar o revertir de forma segura una actualización antes de que el
  runtime corra. Es deliberadamente estable: **no** usa BLE, EDA6 ni hardware, y **nunca**
  impide que `main.py` arranque (todo va envuelto en try/except → ante cualquier imprevisto se
  prefiere dejar el runtime existente corriendo).
- **`main.py`** (el runtime) recibe la transferencia por BLE, la verifica y, tras `UPDATE:APPLY`,
  escribe el estado y hace `machine.reset()`. **Nunca** se sobrescribe `main.py` durante la
  transferencia: el runtime nuevo se descarga completo a `pybot_runtime.new` y **`boot.py`** hace
  el swap con backup + rollback.

### Archivos en la placa (OTA)

| Archivo | Rol | Efímero |
| --- | --- | --- |
| `boot.py` | Updater/rollback manager (se instala por USB, muy estable). | No |
| `pybot_runtime.new` | Runtime nuevo descargado por BLE (aún no aplicado). | Sí (se limpia) |
| `pybot_runtime.bak` | Backup del `main.py` anterior (conocido-bueno) para rollback. | Sí |
| `pybot_update.json` | Estado transaccional: `state` + `from/to/size/hash`. | Sí |

`pybot_app.py`/`pybot_app.json`/`pybot_state.json` **no se tocan** durante un update de runtime.

### Comandos `UPDATE:*` (protocolo 3.1)

```
PyBot Web → ESP32                              ESP32 → PyBot Web
UPDATE:INFO                                    UPDATE:INFO:<json>
UPDATE:BEGIN:<version>:<size>:<hash>           UPDATE:READY | UPDATE:ERROR:<code>
UPDATE:CHUNK:<base64>   (una por bloque)       UPDATE:ACK:<n>
UPDATE:END                                     UPDATE:VERIFY:OK | UPDATE:ERROR:<code>
UPDATE:APPLY                                   (la placa resetea → boot.py hace el swap)
UPDATE:ABORT                                   (borra el .new; main.py intacto)
```

- Escribe a `pybot_runtime.new`; al `END` verifica **tamaño** y **hash SHA-256** (`uhashlib` en
  la placa; JS puro en la web). Solo si coinciden responde **`UPDATE:VERIFY:OK`**. Si el port
  **no** tiene `uhashlib`, responde **`UPDATE:ERROR:HASH_UNAVAILABLE`** (nunca afirma una
  verificación que no ocurrió).
- **ACK por bloque** (backpressure/detección de pérdidas) reutilizando la infra de DEPLOY
  (base64/chunking/pacing/cleanup) sin acoplarse: sesión propia `src/bleRuntimeUpdateSession.js`
  con timeouts propios (`UPDATE_READY/ACK/VERIFY/RECONNECT_TIMEOUT`, distintos de los de RUN) y
  `onProgress(percent)` basado en **bytes confirmados** (no falsos).
- `MAX_RUNTIME_UPDATE_SIZE` acota el tamaño; si MicroPython expone el espacio libre y no alcanza →
  `UPDATE:ERROR:NO_SPACE`.
- Códigos de error: `BUSY, UNSUPPORTED, BAD_VERSION, TOO_LONG, BAD_ENCODING, BAD_HASH,
  HASH_UNAVAILABLE, WRITE_FAILED, VERIFY_FAILED, NO_SPACE, BAD_FRAME, INCOMPATIBLE`.

### Estados y transacción (rollback)

`pybot_update.json.state` ∈ `pending → applied → confirmed` (o `rollback_failed`):

1. **`pending`** — el runtime, tras `VERIFY:OK` y `UPDATE:APPLY`, escribe `pending` (from/to/
   size/hash) y hace `machine.reset()`. En el próximo boot, **`boot.py`** valida el `.new`
   (existe + tamaño + SHA-256), respalda `main.py`→`pybot_runtime.bak`, instala
   `pybot_runtime.new`→`main.py`, marca **`applied`** y arranca el nuevo.
2. **`applied`** — significa que un boot ya instaló el nuevo runtime **pero este nunca confirmó**
   su arranque (no importó / no levantó BLE / no registró GATT). Se asume fallo → **ROLLBACK**:
   `boot.py` restaura `pybot_runtime.bak`→`main.py` y arranca el runtime anterior (conocido-bueno).
3. **`confirmed`** — el runtime nuevo, **solo** tras importar OK + iniciar BLE + registrar GATT +
   quedar operacional, limpia `pybot_update.json` y borra `pybot_runtime.bak` (confirmación de
   arranque). Desde ese momento **no** hay rollback posible.

**Modelo de falla de energía** (el filesystem de MicroPython **no** garantiza atomicidad
perfecta; se diseñó para dejar **siempre** un `main.py` o un backup válido):

- **Durante la descarga:** aún no hay `pending` → `main.py` anterior intacto; se borra el `.new`
  incompleto.
- **`pending` escrito, corte antes/durante el apply:** el apply es **re-entrante** (idempotente):
  si `main.py` ya es el nuevo (hash coincide) no se re-respalda; si `main.py` falta, se instala el
  `.new` válido o se restaura el backup.
- **Anti boot-loop:** el estado se limpia tras el rollback, así no se reintenta en ciclo.

### Llevar a estado seguro antes de actualizar

No se actualiza si hay actividad: **RUN temporal** (se detiene primero, *"Deteniendo programa
antes de actualizar…"*), **APP corriendo** (`APP:STOP` cooperativo + cleanup; si no coopera, la
recuperación existente) o **DEPLOY en curso** (`UPDATE:ERROR:BUSY`). El runtime **nunca** se
escribe mientras hay una APP corriendo.

### UI, reconexión y verificación final

Panel: *"Runtime instalado: X / Última versión: Y / [Actualizar PyBot Bluetooth]"*, con progreso
real (**Actualizando…% → Verificando… → Aplicando… → Reiniciando… → Reconectando…**). Tras
`UPDATE:APPLY` la placa resetea y el BLE se cae: la web intenta **reconectar automáticamente al
mismo `BluetoothDevice`** (sin volver a mostrar el chooser), espera el advertising/GATT y lee
`INFO`. El éxito **no** se declara por `VERIFY`: recién tras reconectar + `INFO` con
`firmware == target` se muestra *"PyBot Bluetooth actualizado correctamente."* Si la reconexión
automática no es posible (limitación de Web Bluetooth), **no** se trata como corrupción:
*"La actualización fue instalada. La placa se reinició. Volvé a conectar por Bluetooth para
verificar la nueva versión."*

### Compatibilidad hacia atrás (capability `runtime-update`)

`INFO.capabilities` ahora incluye `"runtime-update"`. La web se basa en **capabilities**, no en
la versión: una placa **sin** `runtime-update` (p. ej. 3.0.x) muestra *"Esta placa necesita una
última actualización por USB para habilitar futuras actualizaciones por Bluetooth."* y **no**
envía `UPDATE:*`, pero sigue permitiendo RUN/STOP/DEPLOY/APP. Esa **última instalación por USB**
(que agrega `boot.py` + el runtime 3.1) es la que habilita el OTA de ahí en adelante.

### Instalación por USB (habilita OTA)

"Instalar PyBot Bluetooth" ahora graba **`boot.py`** (updater estable) + **`main.py`** (runtime
3.1) + `pybot_mpy.py` + `EDA6.py`, sin borrar `pybot_app.py`/`pybot_app.json` si existen.

### Limitaciones honestas

- **No** se afirma "imposible de brickear": es una **actualización transaccional con rollback**.
  El diseño garantiza que una transferencia interrumpida **no** deja `main.py` corrupto (siempre
  queda el runtime anterior o un backup válido), pero un fallo de hardware/flash catastrófico
  fuera del modelo requeriría **recuperación por USB** como último recurso.
- La reconexión automática depende del navegador (Web Bluetooth); si no es posible, la web pide
  reconectar manualmente (sin tratarlo como fallo del update).

## 6. Identidad única y estable

- `deviceId` = **últimos 6 hex en MAYÚSCULA** de `machine.unique_id()` (MAC del chip).
- Nombre BLE = `PYBOT-XXXXXX` (ej. **`PYBOT-A34F21`**).
- Es **estable entre reinicios** (derivada del hardware, no aleatoria).
- El `deviceId` queda disponible para futuros alias (no implementados en este MVP).

## 7. Versionado

- `PYBOT_RUNTIME_VERSION = "3.1.0"`, `PYBOT_PROTOCOL_VERSION = "3.1"` (legibles por `INFO`).
- Se subió a **3.1** porque el protocolo agrega, de forma **compatible/aditiva**, el OTA Runtime
  Update: nueva capability `runtime-update` y los comandos `UPDATE:*` (BEGIN/READY/CHUNK/ACK/END/
  VERIFY/APPLY/ABORT/INFO + `UPDATE:ERROR:<code>`). El framing 3.0 (RUN/DEPLOY/APP) **no** cambia;
  un runtime 3.0.x sigue interoperando (sin la capability `runtime-update`).
- `PYBOT_RUNTIME_VERSION` es la **única fuente de verdad** de la versión publicada: `bleProtocol.js`
  la exporta y la UI/detección de OTA la usan para comparar contra el `INFO` de la placa. No se
  tocó `package.json` (esta release es del runtime BLE, no de la app web).
- Se subió a **3.0** porque el protocolo agrega STOP confiable (`RUN:STOPPED` + `STOP:FORCE`),
  DEPLOY persistente verificado, control de app (`APP:*`) y autostart. RUN 2.0 y PING/INFO/LED
  se mantienen compatibles.
- **3.0.1** es un *release de endurecimiento* **compatible en framing** (no cambia el 3.0): DEPLOY
  realmente transaccional con backup/rollback, hash obligatorio si se declara VERIFY
  (`HASH_UNAVAILABLE`), `APP:STOP`/`APP:DELETE` confirmados de verdad, errores de filesystem
  explícitos (`WRITE_FAILED`/`DELETE_FAILED`/`STATE_FAILED`), *safe boot* verificado antes del
  reset y watchdog de recuperación del RUN temporal al perder el BLE. Por ser aditivo/compatible
  **no** se subió a 3.1.
- Definidos en una **única fuente coherente**: el runtime (`main.py`), `src/bleProtocol.js`,
  los tests y esta doc. `INFO` incluye `capabilities`.
- **Compatibilidad de ejecución:** una placa con el MVP **1.x** responde PING/INFO/LED pero
  **no** entiende `RUN:*`. `runtimeSupportsRun(info)` (protocol/firmware mayor `>= 2`) habilita
  RUN; `runtimeSupportsDeploy(info)` (capability `deploy` o mayor `>= 3`) habilita BAJAR. Un
  runtime 2.x permite RUN pero pide **reinstalar por USB** para usar DEPLOY.

### 7-bis. Troubleshooting: "La placa no respondió por Bluetooth"

Si al **Ejecutar** por BLE aparece *"The board did not respond over Bluetooth"* /
*"La placa tiene una versión vieja del PyBot BLE Runtime…"* y el `INFO` muestra **FW 1.0.0**:

1. La placa tiene el runtime **MVP viejo** (1.0.0), que no ejecuta programas por BLE.
2. Conectá la placa por **USB** y elegí la placa correcta (`ESP32 MicroPython` o `ESP32 EDA6`).
3. Menú **Placa → Herramientas de la placa → "Instalar PyBot Bluetooth"**. Esperá el progreso
   y el mensaje de éxito (instala `main.py` 2.0.0 + `pybot_mpy.py` + `EDA6.py` y reinicia).
4. Desconectá el cable, **reconectá por Bluetooth** y verificá con **INFO** que ahora reporta
   **FW 2.0.0 / protocol 2.0**. Volvé a Ejecutar.

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

> **Limitación conocida (USB "Bajar a ESP32" vs. runtime BLE) — P1-5.** El flujo histórico
> **"Bajar a ESP32" por USB** (`flashProgramToBoard` / `flashGpioProgramToBoard`) escribe el
> programa del alumno **como `main.py`** y reinicia. Si la placa tenía instalado el **runtime BLE
> 3.x** (que también vive en `main.py`), ese flujo USB lo **reemplaza** y la placa deja de exponer
> BLE hasta reinstalar el runtime (Placa → *Instalar PyBot Bluetooth*). Es el comportamiento USB
> **histórico** y se mantiene deliberadamente sin cambios para no romperlo. **No** se modificó para
> escribir en `pybot_app.py` en su lugar porque hacerlo a ciegas rompería el flujo USB clásico
> (placas sin runtime BLE) y la ejecución `main.py`-autoarranque que muchos usan. Queda como
> **limitación documentada**: si querés app persistente **conservando** el runtime BLE, usá
> **"Bajar por Bluetooth"** (DEPLOY → `pybot_app.py`), no el "Bajar a ESP32" por USB.

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
      error si no hay conexión; desconexión durante la ejecución. Incluye: **el camino BLE
    envía SOLO el código del alumno** (nunca la librería EDA6) y `runtimeSupportsRun()`
    distingue el runtime viejo (1.x) del nuevo (2.0) por la versión de `INFO`.
  - **Nuevos (protocolo 3.0):**
    - `test/bleProtocolV3.test.mjs`: versión 3.x, capabilities, SHA-256 (vectores NIST),
      builders/parsers DEPLOY y APP, `runtimeSupportsDeploy`, límites RUN vs DEPLOY,
      `RUN:STOPPED` como terminal distinto de `RUN:DONE`.
    - `test/bleDeploySession.test.mjs`: DEPLOY con **mock de firmware** (READY/ACK/VERIFY),
      tamaños ~1/2/4/8 KB y cerca del máximo, hash correcto→OK / incorrecto→`BAD_HASH`
      **sin destruir la app anterior**, errores `BAD_ENCODING/WRITE_FAILED/TOO_LONG/BAD_FRAME`,
      desconexión a mitad, y control `APP:INFO/START/STOP/DELETE/AUTOSTART`.
    - `test/bleRunStop.test.mjs`: `RUN:STOPPED`, STOP durante `wait()`, poller `shouldStop`,
      escalado a `STOP:FORCE` cuando el programa no cede, excepción→ERR+DONE, y desconexiones
      (antes de STARTED → rechazo; inesperada → `disconnected`; tras stop → `stopped`).
    - `test/hardwareBridgeSerialPriority.test.mjs`: regresión — `runOnBoard` prioriza serial
      (`_mpSession`) antes que BLE (`_bleRun`).
  - **Nuevos (protocolo 3.1 — OTA Runtime Update):**
    - `test/bleRuntimeUpdateProtocol.test.mjs`: versión/protocolo `3.1`, capability
      `runtime-update`, `compareRuntimeVersions` (same/older/newer), `runtimeUpdateStatus`
      (al día / disponible / necesita USB / sin soporte), tokens `UPDATE:*`, códigos de error,
      builders y parsers.
    - `test/bleRuntimeUpdateSession.test.mjs`: `BleRuntimeUpdateSession` con **mock fiel** del
      firmware (`RuntimeUpdateReceiver`): transferencia + verify + apply OK, progreso por **bytes
      confirmados**, y errores (`BUSY/BAD_VERSION/NO_SPACE/WRITE_FAILED/BAD_HASH/HASH_UNAVAILABLE`)
      + desconexión a mitad (**runtime viejo intacto**, nunca *bricked*).
    - `test/firmwareBootUpdate.test.mjs`: **modelo fiel del `boot.py`** — ciclo OTA completo
      (swap/boot/confirm), `.new` huérfano, pending válido/corrupto, `.new` ausente, backup
      presente, `main.py` ausente, confirmación faltante → **rollback**, y **power-loss** en cada
      etapa (durante descarga / tras verify / tras backup / tras rename / antes de confirmar) →
      siempre queda un `main.py` o backup válido; preserva `pybot_app.py`/metadata.
  - Total: **155 tests** en verde (110 previos + 45 nuevos: protocolo OTA, sesión OTA y boot manager).
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
