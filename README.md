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

- **Arduino Uno/Nano compatible** (por defecto) → usa **StandardFirmata**, igual que siempre. No cambia nada del flujo anterior.
- **ESP32 DevKit** → usa el **firmware PyBot ESP32** (`firmware/pybot-esp32/pybot-esp32.ino`).

Elegí la placa **antes** de conectar el USB. Para cambiarla, desconectá primero. La opción queda guardada en `localStorage` (`pybot_board_type`).

### ESP32

- **El código del alumno es el mismo**: `pin`, `servo`, `motor`, `wait`.
- Requiere cargar una sola vez el firmware **PyBot ESP32** (carpeta `firmware/pybot-esp32`) desde el IDE de Arduino con la placa ESP32 seleccionada.
- **Pines por número de GPIO directo** (no se usa A0–A5): `pin("out", 2, 1)`, `pin("in", 4)`, `pin("pwm", 18, 128)`.
- **Lectura analógica** con prefijo `A` + el GPIO: `pin("in", "A34")`. El valor llega **escalado a 0–1023** para que el cálculo sea idéntico al de Arduino.
- **El ESP32 trabaja a 3.3V**: no conectes señales de 5V a sus pines.
- Protocolo interno: comandos JSON por línea (request/response). El firmware compila en core Arduino-ESP32 **2.x y 3.x**.

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
