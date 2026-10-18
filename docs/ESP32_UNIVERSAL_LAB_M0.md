# ESP32 Universal Lab — M0 baseline

**Milestone:** M0 (isolated extensibility architecture)  
**Branch:** `feature/esp32-universal-lab`  
**Baseline HEAD (start of this execution):** `d015cea9d9bcf0079de57c9008bf57400d69a12c` (= `origin/main` after prior rollback)  
**Physical hardware validation:** NOT performed (no device access in this environment)

## Architecture seam (additive)

New isolated package: `src/esp32UniversalLab/`.

| Piece | Role |
| --- | --- |
| `featureGate.js` | Default-OFF gate; dedicated storage keys; never remaps `pybot_board_type` |
| `profiles/*` | Three commercial Waveshare manifests (pins + capability statuses) |
| `firmwareManifest.js` | Firmware target schema (images arrive in M1+) |
| `runtime/adapter.js` | Isolated connect/flash/execute/recover — refuses until ready |
| `pythonApi/manifest.js` | Planned `pybot.*` English module names; expose only IMPLEMENTED |

**Legacy files intentionally NOT modified in M0:**  
`src/hardwareBridge.js`, `src/PyBotIDE.jsx`, `src/micropython/*`, EDA6, Arduino, BLE runtime, `.github/workflows/*` (directory absent — AC12 PASS).

**Justification:** Gate + profiles are self-contained. IDE wiring is deferred to M1 so existing board selection / USB / Run-Stop behavior cannot regress from a shared refactor.

Activation contract:

1. `isEsp32UniversalLabEnabled()` default `false`
2. Profile id in `localStorage.pybot_esp32_lab_profile` (or test override)
3. Lab transport only when active **and** board type is not a legacy value (`arduino-firmata`, `esp32-micropython`, `esp32-eda6`, `esp32-serial`)

## Capability matrix (source-level)

Statuses: `planned` | `unverified` | `unsupported` | `implemented` | `blocked`

| Capability | C6-LCD-1.47 | S3-Touch-LCD-1.54 | S3-Touch-LCD-7 |
| --- | --- | --- | --- |
| GPIO / PWM / ADC | planned (M1) | planned (M3) | planned (M3) |
| Wi-Fi / BLE | planned (M1) | planned (M3) | planned (M3) |
| Display | planned ST7789 172×320 (M1) | planned ST7789 240×240 (M3) | planned RGB 800×480 (M3) |
| Touch | unsupported | planned CST816 (M3) | planned GT911 (M3) |
| IMU | unsupported | planned QMI8658 (M3) | unsupported |
| Audio | unsupported | planned ES7210/ES8311 (M3) | unsupported |
| Zigbee / Thread | **UNSUPPORTED / NOT VERIFIED** (M2) | unsupported (no 802.15.4) | unsupported |
| CAN / RS485 | unsupported | unsupported | **hardware present, UNVERIFIED** |

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Official MicroPython lacks Zigbee/Thread Python API on C6 | Cannot claim Zigbee/Thread | Keep UNSUPPORTED until native firmware + device proof (M2) |
| ESP-IDF / custom firmware toolchain unavailable in CI cloud | Blocks flashable images | Ship manifests + refuse flash; report BLOCKED/PLANNED honestly |
| Wiring lab into `hardwareBridge` too early | Legacy regression | M0: no shared handler edits |
| Wrong commercial SKU pinout (e.g. C6 touch variant) | Wrong reserved pins | Profiles cite exact Waveshare model docs; require user confirmation |
| Vercel Preview not yet bound to new commits | No human Preview URL | Record after first feature push; never invent URL |

## Technical blockers / DECISION REQUIRED

None blocking M0 architecture. Deferred decisions:

1. **M1 firmware source:** stock MicroPython ESP32-C6 build vs custom ESP-IDF image with display bindings.  
2. **M2 Zigbee/Thread:** custom native stack vs declare permanently unsupported if MicroPython cannot expose 802.15.4 safely.

## Preview

Vercel is configured (`vercel.json` → `npm run build` → `dist`).  
No Preview deployment for *this* feature diff exists yet (branch HEAD still equals `main` until Delivery push). Do not invent a Preview URL.

## Verification layers

| Layer | M0 status |
| --- | --- |
| Source unit tests | Targeted `esp32UniversalLabM0` tests |
| Browser / Preview | Not claimed |
| Physical device | Not claimed |
