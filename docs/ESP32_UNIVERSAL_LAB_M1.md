# ESP32 Universal Lab — M1 vertical slice

**Milestone:** M1 (C6 useful path + commercial board picker)  
**Branch:** `feature/esp32-universal-lab`  
**Baseline M0 HEAD:** `4af4b285251e3e2cad99b13b0985022d7aa0c50e`  
**Physical hardware validation:** NOT performed (UNVERIFIED — no device in cloud)

## What M1 delivers

1. **IDE board picker** — commercial models appear in a separate optgroup from the three legacy options (labels unchanged):
   - `Waveshare ESP32-C6-LCD-1.47` (runtime ready)
   - `ESP32-S3-Touch-LCD-1.54 — not ready`
   - `ESP32-S3-Touch-LCD-7 — not ready`
2. **C6 isolated runtime** — Web Serial connect, official MicroPython flash (SHA-256 validated), REPL run/stop, save `main.py`, recover REPL, board `pybot.*` modules (gpio/display/wifi/bluetooth/power).
3. **S3 profiles** — selectable only with prominent **not ready**; connect/program/flash refused.

## Firmware (real)

| Field | Value |
| --- | --- |
| Board | `ESP32_GENERIC_C6` |
| Version | `1.27.0` (20251209) |
| Origin | https://micropython.org/download/ESP32_GENERIC_C6/ |
| Path | `/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin` |
| SHA-256 | `111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183` |
| Flash offset | `0` |

Flash is offered only after manifest completeness + byte SHA validation (`loadAndValidateC6Firmware`).

## Capability matrix (C6)

Statuses: source `IMPLEMENTED` ≠ physical proof. Hardware column is always UNVERIFIED in M1.

| Capability | Source status | Hardware |
| --- | --- | --- |
| GPIO / PWM / ADC / buses | IMPLEMENTED (`pybot.gpio` + `machine`) | UNVERIFIED |
| Wi-Fi / BLE | IMPLEMENTED (stock MicroPython) | UNVERIFIED |
| Display ST7789 172×320 | IMPLEMENTED (`pybot.display`) | UNVERIFIED |
| TF card | UNVERIFIED | UNVERIFIED |
| Zigbee / Thread | **UNSUPPORTED / NOT VERIFIED** (M2) | — |

S3 capabilities remain PLANNED / not ready (M3).

## Isolation

- Lab activates only with feature gate + profile + non-legacy `pybot_board_type=esp32-universal-lab`.
- `hardwareConnect` refuses the lab sentinel (`PYBOT_LAB:USE_LAB_RUNTIME`).
- Legacy Prepare ESP32 / EDA6 / Arduino paths unchanged.
- Shared touch: additive `getBoardType()` recognition + PyBotIDE picker / routing only.

## What the user can test (cloud / browser)

- See three commercial options + three legacy options in the board menu.
- Select C6 → Install MicroPython (C6) → Connect (Chrome/Edge + Web Serial + real board).
- Run/stop Python; save to `main.py`; recover REPL.
- Select S3 → see **not ready**; Connect refuses.

## Blocked / next (M2–M4)

- **M2:** Zigbee/Thread native stack + Python bindings + device proof (keep NOT VERIFIED until then).
- **M3:** S3 1.54 / S3 7 runtimeReady + display/touch/IMU/audio as hardware permits.
- **M4:** shared capability library, docs/examples hardening.

## Preview

Do not invent a Vercel Preview URL. Report only after a verified deployment bound to this branch.
