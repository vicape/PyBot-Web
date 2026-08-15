# Plan de prueba física MicroPython / ESP32

Nada de esto está ejecutado en este cambio. Marcar cada ítem al validar en hardware.

Leyenda: **SOFTWARE VERIFIED** = cubierto por tests Node. **PENDIENTE FÍSICO** = requiere placa.

## Runtime 4.0.0

1. Instalar runtime nuevo por USB (ESP32 MicroPython o EDA6).
2. Comprobar `INFO.firmware == 4.0.0`, `protocol == 3.2`, capability `native-repl`.
3. Nombre BLE `PYBOT-XXXXXX`.
4. Características REPL_RX/REPL_TX visibles en nRF Connect / Web Bluetooth.

## REPL USB (regresión)

- [ ] `print("hola")` por USB.
- [ ] Traceback real en consola.
- [ ] Stop en `while True: pass` (Ctrl+C), REPL vuelve, USB sigue abierto.
- [ ] Raw-paste o fallback raw REPL en programas grandes.

## REPL BLE nativo

- [ ] Conectar BLE; consola recibe banner/`>>>` o raw REPL.
- [ ] Ejecutar `print("hola")` por BLE.
- [ ] Ejecutar `while True: pass`; Stop; **BLE sigue conectado**.
- [ ] Volver a Run sin reconectar.
- [ ] Repetir Run→Stop **20 veces**.
- [ ] Desconexión manual y reconexión.
- [ ] Power cycle; advertising vuelve.

## `os.dupterm`

- [ ] `dupterm` efectivo en el port instalado.
- [ ] `dupterm_notify` presente; si no, documentar y usar solo USB para Stop de bucles tight.

## Filesystem / Deploy / OTA

- [ ] `installFile` por USB (EDA6, pybot_net).
- [ ] Deploy persistente ADMIN (no mezclar bytes REPL).
- [ ] OTA 3.2.x → 4.0.0 pack `PYBOTRT1`; reconnect + INFO.
- [ ] Rollback si se corta la alimentación a mitad de apply (best-effort ya existente).

## Wi-Fi / HTTP

- [ ] `wifi_conectar` con timeout; SSID inexistente; clave incorrecta.
- [ ] `web_get` HTTP.
- [ ] `web_post` JSON.
- [ ] HTTPS (si el firmware tiene SSL).
- [ ] Mismo programa autónomo (`main.py`) sin PC.
- [ ] BLE conectado **y** Wi-Fi asociados a la vez (memoria / `MemoryError`).
- [ ] Ejemplo Sheets contra un Apps Script de prueba (sin credenciales en el repo).

## EDA6

- [ ] `from EDA6 import *` + `wifi_ip()` / `web_get`.
- [ ] Pines WEMOS vs ESP32.
- [ ] `detenerTodo` tras Stop.

## Arduino (no regresionar)

- [ ] Firmata en vivo.
- [ ] Bajar a Arduino (compilador + VM).
- [ ] Pyodide.

## Memoria

- [ ] `gc.mem_free` tras boot + advertising + dupterm.
- [ ] Diagnóstico USB existente (`runMemoryDiagnostic`) sigue vivo.
