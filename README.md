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
- **ESP32 MicroPython** → el programa corre **nativamente en la placa** con MicroPython (no en Pyodide).

Elegí la placa **antes** de conectar el USB. Para cambiarla, desconectá primero. La opción queda guardada en `localStorage` (`pybot_board_type`).

### ESP32 MicroPython (modo principal)

- **El código del alumno es el mismo**: `pin`, `servo`, `motor`, `wait`, `print`.
- Al **Ejecutar**, PyBot inyecta un *prelude* MicroPython (define `pin/servo/motor/wait`), envía el programa por el **raw REPL** y lo corre **en la ESP32**. Los `print(...)` aparecen en la terminal del IDE.
- **Pines por número de GPIO directo** (no se usa A0–A5): `pin("out", 2, 1)`, `pin("in", 4)`, `pin("pwm", 18, 128)`, `servo(18, 90)`, `motor(18, 50)`.
- **Lectura analógica**: en pines ADC (GPIO 32–39) `pin("in", 34)` devuelve el valor **escalado a 0–1023** (compatibilidad pedagógica con Arduino). Si usás `"A0"` en ESP32, PyBot muestra un aviso para que uses el número de GPIO.
- **El ESP32 trabaja a 3.3V**: no conectes señales de 5V a sus pines.
- **Requisito**: la placa debe tener **MicroPython** instalado. Si no responde como MicroPython, PyBot avisa: *"Esta ESP32 necesita ser preparada para PyBot con MicroPython."* (Próximamente: botón **Preparar ESP32** con `esptool-js`.)

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
