# PyBot ESP32-C6 Zigbee Coordinator (M2A)

Native **ESP-IDF + ESP Zigbee SDK v2.x** firmware that turns a Waveshare **ESP32-C6-LCD-1.47** (ESP32-C6FH4, **4MB**, no PSRAM) into a **Zigbee 3.x coordinator** with a USB Serial/JTAG JSON control protocol for PyBot.

## Critical warnings

1. **Not MicroPython.** Flashing this image **erases** stock MicroPython, on-device `pybot.*` modules, and saved `main.py`.
2. **Opt-in only.** Never auto-flashed by the PyBot web app or CI.
3. **Mutual exclusion.** 4MB flash cannot run MicroPython and the Zigbee stack together. Restore MicroPython with the M1 official image (`ESP32_GENERIC_C6` v1.27.0).
4. **No mock radio.** Requires native IEEE 802.15.4 on ESP32-C6.
5. **Physical pairing UNVERIFIED** until exercised on real hardware with a commercial switch.

## Toolchain (pinned)

| Component | Version |
| --- | --- |
| ESP-IDF | **v5.5.4** (Espressif recommended for Zigbee SDK v2.x) |
| esp-zigbee-lib | **~2.0.0** (ESP Component Registry) |
| Target | `esp32c6` |

Setup (from [ESP Zigbee SDK developing guide](https://docs.espressif.com/projects/esp-zigbee-sdk/en/latest/esp32c6/developing.html)):

```bash
git clone --recursive https://github.com/espressif/esp-idf.git
cd esp-idf && git checkout v5.5.4
git submodule update --init --recursive
./install.sh esp32c6
source ./export.sh
```

## Build

```bash
cd firmware/esp32c6-zigbee-coordinator
./build.sh
```

- Success → `build-artifact/*.bin` + SHA-256 written into `manifest.json` (`artifact.status=READY`).
- Missing IDF → exit `2`, `artifact.status=BLOCKED` (does not invent a binary).

Manual equivalent:

```bash
idf.py set-target esp32c6
idf.py build
# optional operator flash (NOT done by PyBot app/CI):
# idf.py -p /dev/ttyACM0 erase-flash flash monitor
```

## Host protocol (USB Serial/JTAG)

Newline-delimited JSON. Host → device (`cmd`), device → host (`evt`).

| Direction | Example |
| --- | --- |
| → | `{"cmd":"ping"}` |
| ← | `{"evt":"pong","fw":"pybot-zb-coord","ver":"0.1.0","role":"coordinator"}` |
| → | `{"cmd":"status"}` / `{"cmd":"net_start"}` |
| → | `{"cmd":"permit_join","timeout_s":60}` (bounded; default 60s, max 254) |
| → | `{"cmd":"permit_join_close"}` |
| ← | `{"evt":"device_annce","short":N,"ieee":"0x..."}` |
| ← | `{"evt":"device_joined","short":N,"ieee":"0x...","endpoints":[E]}` |
| → | `{"cmd":"zcl_onoff","short":N,"endpoint":1,"action":"on\|off\|toggle"}` |
| → | `{"cmd":"zcl_onoff_read","short":N,"endpoint":1}` |

Python example: `host/pybot_zb_control.py`.

## Security defaults

- Coordinator role with **centralized** security (`distributed security disabled`).
- Network forms on first boot; **permit-join stays closed** until the host opens a **bounded** window.
- No install-code policy forced on all joiners (lab default); tighten before production.

## What is NOT claimed

- Simultaneous MicroPython + Zigbee
- Thread (M2B)
- Tuya Smart Life cloud gateway registration (BLOCKED — see `docs/ESP32_UNIVERSAL_LAB_M2A.md`)
- Blind support for all manufacturer-specific Tuya ZCL clusters
- Physical pairing success in cloud CI
