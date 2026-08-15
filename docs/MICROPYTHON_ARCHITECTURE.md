# Arquitectura MicroPython (PyBot-Web)

Estado: **SOFTWARE VERIFIED** (tests Node + build). **PENDIENTE FÍSICO** en ESP32 real.

## Principio

MicroPython ejecuta Python. PyBot no implementa otro intérprete encima.

USB y BLE son **transportes** hacia una `MicroPythonSession` que habla REPL / raw REPL.

```
PyBot Web
    |
Device session
    +-- Web Serial --------+
    +-- Web Bluetooth -----+
                           |
                    MicroPythonSession
                           |
                      REPL / raw REPL
                           |
                      MicroPython VM
                           |
              pybot_mpy / EDA6 / pybot_net
```

Arduino (Firmata, Pyodide, compilador VM) es un backend **aparte**. No se toca.

## Arquitectura anterior

- **USB:** `MicroPythonSession` → raw REPL. Correcto.
- **BLE:** protocolo `RUN:*` → `ProgramManager.exec()` + monkeypatch de `time.sleep` para Stop cooperativo. `STOP:FORCE` = `machine.reset()`. No detiene `while True: pass` sin reset.

## Arquitectura nueva (runtime 4.0.0, protocolo 3.2)

- Características ADMIN (existentes): PING / INFO / LED / DEPLOY / APP / UPDATE.
- Características REPL nuevas: `REPL_RX` / `REPL_TX`.
- Firmware: `os.dupterm(BleReplStream)` + `dupterm_notify` desde IRQ mínima.
- Stop normal: Ctrl+C → `KeyboardInterrupt` → el REPL vuelve → BLE sigue conectado.
- `machine.reset()` solo en recuperación excepcional (nivel 5), no detrás del botón Stop.
- Wi-Fi + HTTP viven **en la placa** (`pybot_net.py`).

## Capas

| Capa | Rol |
| --- | --- |
| Backend | Arduino vs MicroPython |
| Perfil | ESP32 DevKit / WEMOS EDA6 |
| Transporte | Serial / BLE |
| Sesión | `MicroPythonSession` |
| Runtime | boot.py + pybot_ble + REPL stream |
| Librerías | pybot_mpy, EDA6, pybot_net |

## Stop — escalado

| Nivel | Acción | ¿Stop normal? |
| --- | --- | --- |
| 1 | Ctrl+C | Sí |
| 2 | segundo Ctrl+C | Sí |
| 3 | recuperar REPL (Ctrl+C×2 + Ctrl+B) | Sí |
| 4 | soft reset (raw REPL / `machine.soft_reset` vía Ctrl+D en raw) | No |
| 5 | hard reset (`machine.reset()` / RTS) | No |

Un alumno puede hacer `except KeyboardInterrupt`. Los niveles 1–3 siguen siendo interrupción nativa; 4–5 son administrativos.

## Filesystem

Las mismas operaciones (`installFile`, `fileExists`, `removeFile`) corren sobre raw REPL, USB o BLE. Deploy persistente BLE (APP) se conserva en el canal ADMIN.

## Feature switch (oculto al alumno)

`src/micropython/featureFlags.js` → `MICROPYTHON_NATIVE_BLE`.

Override: `localStorage.pybot_native_ble = "false"` o `globalThis.__PYBOT_NATIVE_BLE__ = false` (legacy `ProgramManager`).

Firmware: archivo `pybot_legacy.on` fuerza el bucle LEGACY.

## OTA

Sin cambios de framing UPDATE 3.1. El pack `PYBOTRT1` ahora incluye `pybot_repl.py`, `pybot_net.py`, `pybot_mpy.py`. Placas ≥ 3.2.0 pueden actualizar por OTA a 4.0.0.

## Preparar ESP32 (placa virgen)

Flujo de navegador (Chrome/Edge + Web Serial): `docs/ESP32_PROVISIONING.md`.
Capa A = ROM bootloader + `esptool-js` + firmware oficial MicroPython.
Capa B = raw REPL + `installBleRuntime`. **PENDIENTE FÍSICO**.
