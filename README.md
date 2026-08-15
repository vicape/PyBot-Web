# PyBot-Web — IDE en el navegador

IDE **tipo PyBot de escritorio**: barra de actividad, sidebar con **ejemplos**, **editor Monaco** (Python), **terminal**, **Run/Stop**, **Conectar USB** (Web Serial + **StandardFirmata**), **ajustes** (tema claro/oscuro, idioma ES/EN), **ayuda**.

Repo: https://github.com/vicape/PyBot-Web  
Proyecto **aparte** del PyBot de escritorio; no lo modifica.

## Python en el navegador

- **Pyodide** (carga desde CDN la primera vez; puede tardar).
- Misma API que PyBot de escritorio: `pin`, `servo`, `motor`, `wait`, `print` — **sin `async`/`await` en tu código** (`def main():` … `main()`). Pyodide usa `run_sync` por debajo para hablar con el USB.

## Hardware

- **Chrome** + **HTTPS** (Vercel) o `localhost`.
- Arduino con **StandardFirmata** (57600 / 115200).
- Firmata en JS: digital in/out, PWM, servo, motor, analógico A0–A5.

### Selección de placa

En el menú de la barra hay un selector **Placa** (cerca del modo Hardware/Solo Python):

- **Arduino Uno/Nano compatible** (por defecto) → usa **StandardFirmata**, igual que siempre. El código corre en Pyodide y manda comandos por Firmata. No cambia nada del flujo anterior.
- **ESP32 MicroPython - GPIO directo** → el programa corre **nativamente en la placa** con MicroPython (no en Pyodide). API PyBot: `pin`, `servo`, `motor`, `wait` por número de GPIO. También `wifi_conectar` / `web_get` / `web_post` (en la placa, no en el navegador).
- **ESP32 EDA6 / WEMOS** → compatible con programas **Thonny/EDA6** (`from EDA6 import *`, `servomotor`, `salidaDigital`, etc.). Perfil **WEMOS** por defecto (puertos 1–4). Permite grabar `EDA6.py` + `main.py` en la placa.

Elegí la placa **antes** de conectar el USB. Para cambiarla, desconectá primero. La opción queda guardada en `localStorage` (`pybot_board_type`).

### ESP32 EDA6 / WEMOS (v0.3)

- Programas copiados desde **Thonny** con `from EDA6 import *` y `from time import sleep`.
- Perfil de pinout: **WEMOS** (recomendado) o **ESP32** (otro pinout).
- Menú (conectado): **Grabar en ESP32**, **Instalar librería EDA6**, **Borrar programa**, **Verificar EDA6**.
- Ejemplos EDA6 en el explorador cuando esa placa está seleccionada.

### ESP32 MicroPython (modo principal)

- **El código del alumno es el mismo**: `pin`, `servo`, `motor`, `wait`, `print`.
- Al **Ejecutar**, PyBot inyecta un *prelude* MicroPython (define `pin/servo/motor/wait`), envía el programa por el **raw REPL** y lo corre **en la ESP32**. Los `print(...)` aparecen en la terminal del IDE.
- **Pines por número de GPIO directo** (no se usa A0–A5): `pin("out", 2, 1)`, `pin("in", 4)`, `pin("pwm", 18, 128)`, `servo(18, 90)`, `motor(18, 50)`.
- **Lectura analógica**: en pines ADC (GPIO 32–39) `pin("in", 34)` devuelve el valor **escalado a 0–1023** (compatibilidad pedagógica con Arduino). Si usás `"A0"` en ESP32, PyBot muestra un aviso para que uses el número de GPIO.
- **El ESP32 trabaja a 3.3V**: no conectes señales de 5V a sus pines.
- **Requisito**: la placa debe tener **MicroPython** instalado. Si no responde como MicroPython, PyBot ofrece **Preparar ESP32** (Chrome/Edge + Web Serial, `esptool-js`, firmware oficial en `public/firmware/micropython/`). Detalle: `docs/ESP32_PROVISIONING.md`.

### Bajar a Arduino (correr sin la PC)

Con la placa **Arduino Uno/Nano** seleccionada, el menú ofrece **"Bajar a Arduino (correr solo)"**: el mismo programa del alumno queda **grabado en la placa** y arranca solo al darle energía, **desconectado de la computadora** (igual idea que el modo autónomo de la ESP32, sin nube ni servidores).

- **Cómo funciona**: PyBot traduce tu Python a *bytecode* (`src/arduino/pybotArduinoCompiler.js`) y lo graba en la EEPROM. Un **firmware intérprete** (`firmware/pybot-arduino-vm`, `.hex` precompilado en `public/firmware/pybot-arduino-vm.hex`) ejecuta ese bytecode al encender. El firmware se graba **una sola vez** (la primera descarga) reutilizando el flasher por USB; luego solo se sube el programa por serial.
- **El modo en vivo no cambia**: "Probar" sigue usando StandardFirmata + Pyodide.
- **Mismas órdenes**: `pin`, `servo`, `motor`, `wait`, `print`, con `A0–A5`. La semántica (servo 0–180, `motor` como servo de rotación, PWM 0–255) es **idéntica** a la del modo en vivo.
- **Subset soportado**: variables enteras, `if/elif/else`, `while` (incl. `while True`), `for i in range(...)`, aritmética y comparaciones, `and/or/not`. Lo no soportado da un **aviso con número de línea** ("esto todavía no se puede bajar al Arduino, probalo en vivo").
- Ejemplos listos en el explorador: **Arduino solo: Semáforo** y **Arduino solo: Latido (PWM)**.

### Bluetooth (BLE): usar la ESP32 sin cables

Con una ESP32 preparada (menú **Placa → Herramientas → "Instalar PyBot Bluetooth"** por USB, que
graba `boot.py` + `main.py` + `pybot_mpy.py` + `EDA6.py`), se puede trabajar **sin cables** por
Bluetooth (**Chrome/Edge de escritorio**). Runtime **4.0.0** / protocolo **3.2**
(ADMIN 3.1 compatible; stream REPL nativo). Ver `docs/MICROPYTHON_ARCHITECTURE.md`.

Dos formas de correr el programa del alumno:

- **EJECUTAR (temporal):** conectá por Bluetooth y usá **Ejecutar**. El programa corre en
  MicroPython (raw REPL). **Detener** envía Ctrl+C (`KeyboardInterrupt`); BLE permanece
  conectado. Validación física: `docs/MICROPYTHON_PHYSICAL_TEST_PLAN.md`.
- **BAJAR (persistente/autónomo):** menú **Placa → "Bajar a ESP32 (Bluetooth)"**. Transferencia
  **verificada** (tamaño + hash SHA-256), reemplazo **transaccional** de `pybot_app.py` + metadata
  (con backup/rollback: nunca queda a medias), **autostart** activado y **ejecución inmediata**.
  Después la placa **corre sola al encender, sin PC/navegador/BLE/Internet** y sobrevive un power
  cycle, mientras el Bluetooth sigue disponible para administrarla (**Ejecutar guardado / Detener /
  Borrar / Autostart**). El **Detener** también controla una app autónoma corriendo (incluso si
  arrancó por autostart, sin sesión previa): el ESP32 es la fuente de verdad.

**Actualización del runtime por Bluetooth (OTA):** desde la 3.1, una placa con `boot.py` +
runtime 3.1 puede **actualizar su propio runtime por BLE** (sin volver a USB salvo recuperación
extrema). Al conectar, si hay una versión más nueva publicada, el panel Bluetooth muestra
*"Actualización de PyBot Bluetooth disponible X→Y"* y un botón **Actualizar**. La transferencia es
**verificada (SHA-256), transaccional y con rollback**: `main.py` nunca se sobrescribe durante el
envío (se descarga a `pybot_runtime.new` y un `boot.py` estable hace el swap con backup); si el
runtime nuevo no confirma su arranque, el siguiente boot **revierte** al anterior. El programa del
alumno y el autostart se **conservan**. La **primera** instalación sigue siendo por USB (deja
`boot.py`); las **futuras** van por BLE. No es "imposible de brickear": es *transaccional con
rollback*, y la recuperación por USB queda como último recurso.

También podés **Bajar a ESP32** por **USB** (flujo existente): se sigue priorizando el cable
cuando hay sesión serial. **Nota:** ese "Bajar a ESP32" por **USB** escribe el programa como
`main.py` y, si la placa tenía el runtime BLE, lo reemplaza (habría que reinstalarlo); para app
persistente **conservando** el BLE, usá "Bajar por Bluetooth". Ver
**[docs/PYBOT_BLE_RUNTIME.md](docs/PYBOT_BLE_RUNTIME.md)** y el checklist físico
**[docs/PYBOT_BLE_TEST_PLAN.md](docs/PYBOT_BLE_TEST_PLAN.md)**.

### ESP32 Serial JSON (experimental, no usado)

El firmware `firmware/pybot-esp32/pybot-esp32.ino` y `src/esp32Session.js` implementan un enfoque alternativo por comandos JSON serial. **No es el flujo principal**, no aparece en el selector y no afecta a Arduino. Queda como experimento (`pybot_board_type = "esp32-serial"` por edición manual).

## Desarrollo

```bash
cd PyBot-Web
npm install
npm run dev
```

## GitHub / Vercel

- **[docs/LO_MAS_FACIL.md](docs/LO_MAS_FACIL.md)** — GitHub Desktop.
- **Vercel**: importar repo, framework **Vite**, deploy.

## Notas

- `input()` de consola no está soportado como en escritorio; los ejemplos web evitan o usan bucles fijos.
- **Detener**: Stop marca bandera; el código debe usar `wait(...)` entre pasos para poder cortar.
