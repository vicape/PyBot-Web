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

## Preparar ESP32 — placa virgen (P1–P10)

Nada de esto está ejecutado en el cambio de software. Marcar al validar en hardware.
Leyenda: **SOFTWARE VERIFIED** en tests Node. **PENDIENTE FÍSICO** = requiere placa.

- [ ] **P1** ESP32 clásica virgen: Chrome/Edge, **Preparar ESP32**, diálogo de puerto explícito (no se elige un puerto en silencio).
- [ ] **P2** Confirmación destructiva visible; Cancel no borra flash.
- [ ] **P3** DTR/RTS entra al bootloader; si falla, instrucciones BOOT y Reintentar funciona.
- [ ] **P4** Chip ID ESP32 clásico; una placa S3/C3 muestra “variant not yet supported” y **no** se flashea la imagen GENERIC.
- [ ] **P5** SHA-256 de la imagen coincide; erase + write con progreso real (bytes).
- [ ] **P6** Tras el reset, MicroPython bootea y el REPL responde (no se declara lista solo por `writeFlash`).
- [ ] **P7** Se instalan los archivos PyBot (BLE nativo + EDA6 + net); la verificación de archivos pasa; “ESP32 lista”.
- [ ] **P8** Placa ya preparada: no hay erase automático; Cancel / Reinstall pide confirmación.
- [ ] **P9** MicroPython sin PyBot: **Instalar PyBot** sin reflash. PyBot viejo: **Actualizar PyBot** sin reflash.
- [ ] **P10** Tras lista: BLE nativo (`PYBOT-XXXXXX`, REPL) y Wi-Fi/`web_get` en un programa de prueba. El programa del editor no se copió durante el provisioning.
