# ESP32 Universal Lab — M2A vertical slice

**Milestone:** M2A (C6 native Zigbee coordinator + Python host control contract)  
**Branch:** `feature/esp32-universal-lab`  
**Baseline HEAD:** `4e651dfe91be68acd41ed858081cefb546ca7b75`  
**Physical Zigbee pairing:** UNVERIFIED (no target radio exercised in cloud)  
**Parent roadmap:** [issue #544](https://github.com/vicape/cursor-control/issues/544) — **not** marked COMPLETE

## What M2A delivers

1. **Isolated ESP-IDF project** at `firmware/esp32c6-zigbee-coordinator/` — genuine Zigbee 3.x **coordinator** role using Espressif **ESP Zigbee SDK v2.x** (`espressif/esp-zigbee-lib ~2.0.0`) on **ESP-IDF v5.5.4**, target `esp32c6`.
2. **Capabilities in firmware:** form network, bounded `permit_join`, device IEEE + OnOff endpoint discovery, ZCL OnOff on/off/toggle + attribute read (commercial switch baseline).
3. **USB JSON host protocol** + executable Python control script (`host/pybot_zb_control.py`) and JS encoder/decoder (`src/esp32UniversalLab/zigbee/protocol.js`).
4. **Explicit firmware modes:** default **MicroPython** (unchanged safe path) vs opt-in **zigbee-coordinator**. No coexistence claim. No auto-flash. Restore MicroPython documented via M1 image SHA.
5. **Versioned manifest** with honest `artifact.status` (`BLOCKED` until `./build.sh` produces a real binary + SHA).
6. **Tuya decision** (below) — stand-alone Zigbee proceeds; Smart Life cloud gateway **BLOCKED**.
7. **Thread** tracked separately as **M2B** (not implemented here).

## Feasibility decisions

| Question | Decision |
| --- | --- |
| MicroPython + Zigbee on one 4MB image? | **No.** Mutually exclusive full-flash targets. |
| Custom MicroPython Zigbee binding on C6/4MB? | **Not feasible** for this slice (stack size + flash). Dedicated firmware + USB host protocol instead. |
| Host architecture | ESP32-C6 native 802.15.4 coordinator (not RCP mock). |
| S3 boards | Untouched (parent backlog). |
| Auto-flash in app/CI | **Forbidden.** |

## Build / artifact

```bash
# Requires ESP-IDF v5.5.4 exported
cd firmware/esp32c6-zigbee-coordinator
./build.sh
```

If `idf.py` is missing → exit 2, `artifact.status=BLOCKED` (no invented binary/hash).

## Flash safety / restore

| Action | Behavior |
| --- | --- |
| Default mode | `micropython` |
| Select Zigbee mode | Only when artifact `READY` |
| Zigbee flash | Requires `explicitOptIn` + `acknowledgeErasesMicroPython` |
| Restore | Re-flash `/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin` (SHA in M1 manifest) |
| Connected claim | Zigbee mode must not claim MicroPython REPL connected |

## Radio / stack notes

- **Zigbee** and **Thread** are separate firmware roles; Thread = M2B.
- Wi-Fi/BLE coexistence with 802.15.4 exists at SoC level per Espressif; M2A does **not** claim a Wi-Fi SoftAP Zigbee gateway or multi-radio QA.
- No cloud physical pairing claims.

## Tuya compatibility decision

### A) Stand-alone Zigbee (Espressif coordinator) — PROCEED

Many commercial Zigbee switches expose standard **ZCL OnOff (0x0006)**. M2A implements that baseline. Manufacturer-specific Tuya clusters/DPs are **not** blindly claimed; expand only with device captures.

### B) Tuya Smart Life official gateway registration — BLOCKED

Per [Tuya Gateway SDK](https://developer.tuya.com/en/docs/iot-device-dev/Gateway-Product-Software-Development-Kit-Introduction?id=Kbgy0z6cdjokl) and [Gateway Extension SDK](https://developer.tuya.com/en/docs/iot-device-dev/tuya-gateway-extension-sdk-development-manual?id=K9dudnkt0lnx4):

| Prerequisite | Status |
| --- | --- |
| TuyaOS Gateway / Extension / Integrated SDK | Required; targets emphasize **Linux / Android / FreeRTOS** gateway products, often with Tuya Zigbee modules |
| Product PID + license + certification | Required for Smart Life ecosystem registration |
| Authorized cloud account / credentials | **Not available** in this environment |
| ESP32-C6 as approved Tuya gateway host | **Not** treated as a drop-in official Smart Life gateway without vendor approval |

**Classification:** Smart Life pairing / unregistered gateway spoofing = **BLOCKED**. Do **not** block stand-alone Zigbee coordinator work on missing Tuya credentials. Do **not** connect to Tuya cloud or authenticate in this milestone.

**Pathway if unblocked later:** obtain Tuya developer PID + Gateway SDK license → evaluate host OS/module requirements → only then consider a separate firmware/product track (likely not the same 4MB MicroPython lab image).

## Licensing

- Application code in-repo under repository license.
- `esp-zigbee-lib` is Espressif’s **prebuilt** Zigbee library from the Component Registry (pulled at build time; not vendored as source).
- ESP-IDF Apache-2.0 / Espressif terms apply to the toolchain.

## What users can verify without hardware

- Source tree + partition map + pinned toolchain docs
- Protocol encode/decode + flash-safety / mode-selection unit tests
- `build.sh` BLOCKED path when IDF absent
- MicroPython C6 path unchanged (default)

## Physical test steps (operator / lab)

1. Backup: ensure MicroPython restore image SHA known.
2. Build coordinator with ESP-IDF v5.5.4; record binary SHA from `manifest.json`.
3. Explicit erase-flash + flash coordinator (manual `idf.py`, not PyBot auto-flash).
4. USB: `python3 host/pybot_zb_control.py --port PORT ping` then `permit-join`.
5. Put commercial Zigbee switch in pairing mode; confirm `device_annce` / `device_joined` with IEEE + endpoint.
6. `onoff --action on|off` and `read-onoff`; note any Tuya-specific failures separately.
7. Restore MicroPython; confirm REPL + `pybot.display` ST7789 still works.

## Remaining backlog (do not mark parent COMPLETE)

- **M2B:** Thread / OpenThread role, independent testing
- **M3:** S3 commercial boards runtime
- **M4:** shared capability library hardening
- Tuya Smart Life gateway (if credentials + approved target appear)
- Optional: IDE UI for mode picker once artifact READY
