# BLE nativo MicroPython

Estado: **SOFTWARE VERIFIED**. **PENDIENTE FÍSICO:** dupterm, KeyboardInterrupt en `while True: pass`, GATT estable 20× Run/Stop.

## Decisión: `os.dupterm`

ESP32 MicroPython expone `os.dupterm` y, en ports recientes, `os.dupterm_notify`. Es el mecanismo nativo que usa el ejemplo oficial `ble_uart_repl.py`.

Flujo:

1. IRQ `GATTS_WRITE` en `REPL_RX`: copia bytes a un ring prealocado (`irq_put`).
2. `os.dupterm_notify(None)`: el VM lee el stream; si el byte es 0x03, agenda `KeyboardInterrupt`.
3. `BleReplStream.write`: `gatts_notify` en `REPL_TX` (stdout del REPL / `print`).
4. `ioctl(POLL)` para que el REPL no bloquee si no hay datos.

No se hace FS, import, sleep ni JSON en la IRQ.

### Si `dupterm_notify` faltara en un firmware viejo

El stream sigue adjunto; el REPL BLE funciona en idle. El Stop de `while True: pass` **podría no inyectar** KeyboardInterrupt. Eso se verifica en hardware (plan físico). No se vuelve a ProgramManager + monkeypatch como camino nuevo: el fallback es USB (UART IRQ nativo) y, en BLE, niveles 3+ de recuperación. El camino LEGACY (`pybot_legacy.on` / flag web) permanece aislado.

## Separación REPL vs ADMIN

| Característica | UUID | Uso |
| --- | --- | --- |
| ADMIN RX | `…9002` | PING, INFO, RUN:* LEGACY, DEPLOY, APP, UPDATE |
| ADMIN TX | `…9003` | respuestas ADMIN (líneas `\n`) |
| REPL RX | `…9004` | bytes crudos (Ctrl+C, raw REPL) |
| REPL TX | `…9005` | bytes crudos del REPL |

No se mezclan frames OTA con Ctrl+C.

## Web

- `BluetoothTransport`: ADMIN + `writeRepl` / `onReplData`.
- `BleReplTransport`: adapta REPL al contrato de `MicroPythonSession`.
- `hardwareBridge.runOnBoard`: USB → sesión BLE nativa → LEGACY `BleRunSession`.

Identidad BLE: `PYBOT-XXXXXX` (sin cambio).

## Stop

El botón Stop en camino nativo envía Ctrl+C por REPL_RX (y el firmware también inyecta 0x03 si llega `STOP` por ADMIN). No llama `STOP:FORCE` / `machine.reset()` como Stop normal.
