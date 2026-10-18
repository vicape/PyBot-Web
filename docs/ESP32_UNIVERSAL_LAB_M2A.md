# ESP32 Universal Lab — M2A vertical slice

**Milestone:** M2A (C6 native Zigbee coordinator + Python host control contract)  
**Branch:** `feature/esp32-universal-lab`  
**Physical Zigbee pairing:** UNVERIFIED (no target radio exercised in cloud)  
**Parent roadmap:** [issue #544](https://github.com/vicape/cursor-control/issues/544) — **not** marked COMPLETE

## What M2A delivers

1. **Isolated ESP-IDF project** at `firmware/esp32c6-zigbee-coordinator/` — genuine Zigbee 3.x **coordinator** role using Espressif **ESP Zigbee SDK v2.x** (`espressif/esp-zigbee-lib ~2.0.0`) on **ESP-IDF v5.5.4**, target `esp32c6`.
2. **Capabilities in firmware:** form network, bounded `permit_join`, device IEEE + OnOff endpoint discovery, ZCL OnOff on/off/toggle + attribute read (commercial switch baseline).
3. **USB JSON host protocol** + executable Python host control (`host/pybot_zb_control.py`, **not** on-device `pybot.zigbee`) and JS encoder/decoder (`src/esp32UniversalLab/zigbee/protocol.js`) with IDE bridge gated on artifact READY.
4. **Explicit firmware modes:** default **MicroPython** (unchanged safe path) vs **interim** opt-in **zigbee-coordinator**. No auto-flash (`autoFlash: false`). Restore MicroPython documented via M1 image SHA.
5. **Versioned manifest** with honest `artifact.status` (`BLOCKED` until `./build.sh` produces a validated **merged-raw** or **multi-offset** flash package with bootloader — never app-only at offset 0).
6. **Tuya decision** (below) — stand-alone Zigbee ZCL proceeds; Smart Life official gateway **BLOCKED** (separate track).
7. **Thread** tracked separately as **M2B** (not implemented here).

## Coexistence feasibility (not categorical impossibility)

| Option | Status |
| --- | --- |
| Stock MicroPython (~1.9MB) + full ESP Zigbee SDK on one 4MB image | **Not measured to fit** in this slice. Do **not** treat as proven physical impossibility without flash/RAM measurements. |
| Custom trimmed MicroPython + native Zigbee binding | **Open** — requires size engineering and measurements before claiming same-board Python+Zigbee. |
| 2-board architecture (MicroPython UI + Zigbee radio) | **Open** — host protocol already targets USB/UART control of a dedicated coordinator. |
| **Interim** separate opt-in Zigbee firmware (this M2A path) | **Accepted for reliability now** — does **not** fulfill the long-term same-board Python everything goal. |

## Build / artifact

```bash
# Requires ESP-IDF v5.5.4 exported
cd firmware/esp32c6-zigbee-coordinator
./build.sh
```

- Missing `idf.py` → exit **2**, `artifact.status=BLOCKED` (no invented binary/filename/hash).
- Success → **merged-raw** image (`idf.py merge-bin -f raw`, flash at offset 0) **or** multi-offset bundle (bootloader + partition-table + app at official offsets). App-only `.bin` at `flashOffset=0` is **rejected**.
- Partition map (`firmware/esp32c6-zigbee-coordinator/partitions.csv`): `factory` aligned within exactly **4MB**; NVS / phy / zb data partitions preserved (no overflow). Enlarge `factory` only after native size measurement (`idf.py partition-table` / `image_info`) — POST_QA.

## Flash safety / restore

| Action | Behavior |
| --- | --- |
| Default mode | `micropython` |
| Select Zigbee mode / WebSerial Zigbee UI | Only when artifact `READY` with validated packaging |
| Zigbee flash | Requires `explicitOptIn` + `acknowledgeErasesMicroPython`; **never** auto-flash |
| Incomplete build | Do **not** ask the operator to flash |
| Backup | Save user `main.py` before opt-in Zigbee flash |
| Restore | Re-flash `/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin` (SHA in M1 manifest) |
| Connected claim | Zigbee mode must not claim MicroPython REPL connected |

**Preserved safe/default runtime (untouched):** ESP32-C6 MicroPython `1.27.0` + `/pybot` modules; LCD **ST7789** exactly **172x320** and its Python driver (`pybot.display`) must remain untouched. Opt-in Zigbee firmware is a separate interim flash target only.

## Host Python (read-only operator plan — needs hardware)

Not executable in cloud CI without a board:

1. Enumerate correct COM / `/dev/ttyACM*` for the C6 USB Serial/JTAG.
2. `ping` / `status` / `monitor --seconds N` (live `device_annce` / `device_joined` — real IDs only).
3. Bounded `allow joining` / `permit-join`, then `command on`/`off` and `read` after a real short address.
4. Restore MicroPython when done.

## Radio / stack notes

- **Zigbee** and **Thread** are separate firmware roles; Thread = M2B.
- Wi-Fi/BLE coexistence with 802.15.4 exists at SoC level per Espressif; M2A does **not** claim a Wi-Fi SoftAP Zigbee gateway or multi-radio QA.
- No cloud physical pairing claims. Hardware remains **UNVERIFIED** even after a successful compile.

## Tuya compatibility decision

### A) Stand-alone Zigbee (Espressif coordinator) — PROCEED

Many commercial Zigbee switches expose standard **ZCL OnOff (0x0006)**. M2A implements that baseline. Manufacturer-specific Tuya clusters/DPs are **not** blindly claimed; expand only with device captures. This stand-alone ZCL model is **explicitly separate** from official Smart Life gateway adoption.

### B) Tuya Smart Life official gateway registration — BLOCKED

Per [Tuya Gateway SDK](https://developer.tuya.com/en/docs/iot-device-dev/Gateway-Product-Software-Development-Kit-Introduction?id=Kbgy0z6cdjokl) and [Gateway Extension SDK](https://developer.tuya.com/en/docs/iot-device-dev/tuya-gateway-extension-sdk-development-manual?id=K9dudnkt0lnx4):

| Prerequisite | Status |
| --- | --- |
| TuyaOS Gateway / Extension / Integrated SDK | Required; targets emphasize **Linux / Android / FreeRTOS** gateway products |
| Product PID + license + certification | Required for Smart Life ecosystem registration |
| Authorized cloud account / credentials | **Not available** — **must not hardcode** vendor credentials or spoof |
| ESP32-C6 as approved Tuya gateway host | **Not** a drop-in official Smart Life gateway without vendor approval |

**Classification:** Smart Life pairing / unregistered gateway spoofing = **BLOCKED**. Do **not** claim Smart Life works. Do **not** block stand-alone Zigbee coordinator work on missing Tuya credentials.

## Licensing

- Application code in-repo under repository license.
- `esp-zigbee-lib` is Espressif’s **prebuilt** Zigbee library from the Component Registry (pulled at build time; not vendored as source; proprietary terms apply — not spoofed).
- ESP-IDF Apache-2.0 / Espressif terms apply to the toolchain.

## What users can verify without hardware

- Source tree + partition map + pinned toolchain docs
- Protocol encode/decode + flash-safety / mode-selection unit tests
- `build.sh` BLOCKED path when IDF absent
- Host `monitor` protocol acceptance with mock serial (host-side only)
- MicroPython C6 path unchanged (default)

## Remaining backlog (do not mark parent COMPLETE)

- **M2B:** Thread / OpenThread role, independent testing
- **M3:** S3 commercial boards runtime (LCD/touch/IMU)
- **M4:** shared capability library hardening
- Tuya Smart Life gateway (if credentials + approved target appear)
- Same-board MicroPython+Zigbee if measurements prove fit
