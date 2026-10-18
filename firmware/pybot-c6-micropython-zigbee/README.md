# PyBot C6 MicroPython + native Zigbee (uZigbee v1.6 PoC)

**Repo scope:** `vicape/PyBot-Web` · branch `feature/esp32-universal-lab` only.

Isolated integration for **one** Waveshare **ESP32-C6-LCD-1.47** (ESP32-C6FH4, **4 MB**, no PSRAM):

- Python authored/installed via PyBot IDE
- Autonomous boot without PC after install
- Retain ST7789 **172×320** (`pybot.display` unchanged in Lab)
- Genuine Zigbee 3.x **coordinator** on-chip (IEEE 802.15.4) via native `_uzigbee`

## Decision

**`PIN_UZIGBEE_V1_6_AS_POC`** — see `DECISION.md` / `PINS.json`.

Do **not** mix with interim `firmware/esp32c6-zigbee-coordinator/` (ESP-IDF **v5.5.4** +
esp-zigbee-lib **~2.0.0** / v2 API). That path remains a NON-MicroPython host-controlled
target and is **not** the desired standalone Python solution.

## Pins

| Component | Version / commit |
| --- | --- |
| uZigbee | `ff25553c5fc9d59754eba9a89811e6433e0d4479` (MIT) |
| ESP-IDF | **v5.3.2** |
| MicroPython | **v1.27.0** |
| esp-zigbee-lib / esp-zboss-lib | **~1.6.0** (ZBOSS) |

## Build

```bash
cd firmware/pybot-c6-micropython-zigbee
./scripts/validate_static.py   # or via ./build.sh
# Install ESP-IDF v5.3.2 and: . $IDF_PATH/export.sh
./build.sh
```

- Missing IDF → exit `2`, `artifact.status=BLOCKED` (no invented SHA/filename).
- Success → multi-offset bootloader + partition-table + app + SHA-256 in
  `build-artifact/BUILD_STATUS.json`. App-only @ offset `0` is rejected.
- Toolchain trees stay under ignored `third_party/`. Zigbee SDK binaries are **not**
  redistributed in git (see `LICENSE_ATTRIBUTION.md`).

## On-device Python

| File | Role |
| --- | --- |
| `onboard/pybot_zigbee.py` | `pybot.zigbee` adapter over `_uzigbee` |
| `onboard/main.py` | Boot-safe example; `PERMIT_JOIN_ON_BOOT = False` |

Missing `_uzigbee` → honest `NATIVE_MODULE_MISSING` diagnostic (no fake pass).

## Safety

- `autoFlash: false` / mode **NOT READY** until READY artifact + validated boot layout
- Hardware Zigbee **UNVERIFIED**
- Backup/restore stock C6: `docs/BACKUP_RESTORE.md`
- Limitations / Tuya / Smart Life: `docs/LIMITATIONS.md`
- Bench plan: `docs/BENCH_COMMISSIONING.md`
