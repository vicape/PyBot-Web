# PyBot ESP32-C6 Zigbee Coordinator (M2A)

Native **ESP-IDF + ESP Zigbee SDK v2.x** firmware that turns a Waveshare **ESP32-C6-LCD-1.47** (ESP32-C6FH4, **4MB**, no PSRAM) into a **Zigbee 3.x coordinator** with a USB Serial/JTAG JSON control protocol for PyBot.

## Critical warnings

1. **Not MicroPython.** Flashing this image **erases** stock MicroPython, on-device `pybot.*` modules, and saved `main.py`.
2. **Opt-in only / interim mode.** Never auto-flashed by the PyBot web app or CI (`autoFlash: false`). Does not fulfill the long-term same-board Python+Zigbee goal by itself.
3. **Coexistence.** Stock MicroPython + full Zigbee SDK on one 4MB image has **not been measured to fit**; custom MicroPython+Zigbee or a 2-board architecture remain open. This separate firmware is the **reliable interim** path.
4. **No mock radio.** Requires native IEEE 802.15.4 on ESP32-C6.
5. **Physical pairing UNVERIFIED** until exercised on real hardware with a commercial switch.
6. **Do not flash** if the build artifact is incomplete / `BLOCKED`.

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

- Success → validated **merged-raw** (`idf.py merge-bin -f raw`, flash at **0**) **or** multi-offset bundle (bootloader + partition-table + app) + SHA-256 in `manifest.json` (`artifact.status=READY`).
- Missing IDF → exit `2`, `artifact.status=BLOCKED` (does not invent a binary/filename/hash).
- App-only image at `flashOffset=0` is **never** marked READY.

Manual equivalent:

```bash
idf.py set-target esp32c6
idf.py build
idf.py merge-bin -o build-artifact/merged.bin -f raw
# optional operator flash (NOT done by PyBot app/CI) — only after READY + backup:
# esptool.py write_flash 0 build-artifact/merged.bin
# restore MicroPython: flash ESP32_GENERIC_C6 v1.27.0 (see manifest restoreMicroPython)
```

## Host protocol (USB Serial/JTAG)

Newline-delimited JSON. Host → device (`cmd`), device → host (`evt`).

Host control script: `host/pybot_zb_control.py` (**host-side Python**, not on-device `pybot.zigbee`).

| English command | CLI | JSON |
| --- | --- | --- |
| (ping) | `ping` | `{"cmd":"ping"}` |
| status | `status` | `{"cmd":"status"}` |
| create network | `net-start` / `create network` | `{"cmd":"net_start"}` |
| allow joining | `permit-join` / `allow joining` | `{"cmd":"permit_join","timeout_s":60}` |
| command on/off | `onoff --action on\|off` | `{"cmd":"zcl_onoff",...}` |
| read | `read-onoff` / `read` | `{"cmd":"zcl_onoff_read",...}` |
| monitor | `monitor --seconds N` | live `device_annce` / `device_joined` |

## Security defaults

- Coordinator role with **centralized** security (`distributed security disabled`).
- Network forms on first boot; **permit-join stays closed** until the host opens a **bounded** window.
- No install-code policy forced on all joiners (lab default); tighten before production.

## What is NOT claimed

- Proven same-image MicroPython + Zigbee without measurements
- Thread (M2B)
- Tuya Smart Life cloud gateway registration (BLOCKED — stand-alone ZCL ≠ Smart Life)
- Blind support for all manufacturer-specific Tuya ZCL clusters
- Physical pairing success in cloud CI
