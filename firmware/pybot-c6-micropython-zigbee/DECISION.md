# Evidence-based Zigbee stack decision (M2-MicroPython path)

**Decision (exactly one): `PIN_UZIGBEE_V1_6_AS_POC`**

Pin the [mateuszsury/uZigbee](https://github.com/mateuszsury/uZigbee) integration at commit
`ff25553c5fc9d59754eba9a89811e6433e0d4479` as a **proof-of-concept** custom
MicroPython + native Zigbee coordinator build for Waveshare ESP32-C6-LCD-1.47.

## Sources actually reviewed

| Source | What was checked |
| --- | --- |
| uZigbee `LICENSE` | MIT (Copyright 2026 mateuszsury) |
| uZigbee `docs/LICENSE_NOTES.md` | `esp-zboss-lib` proprietary; do not redistribute binaries until terms verified |
| uZigbee `firmware/vendor_overrides/.../idf_component.yml` | `espressif/esp-zigbee-lib ~1.6.0` + `espressif/esp-zboss-lib ~1.6.0` |
| uZigbee `tools/bootstrap_third_party.sh` | ESP-IDF **v5.3.2**, MicroPython **v1.27.0** |
| uZigbee `c_module/mod_uzigbee.c` / `uzb_core.c` | Real `_uzigbee` native module (`esp_zb_*` ZBOSS APIs) |
| uZigbee CI `.github/workflows/firmware-artifacts.yml` | Builds artifacts on ubuntu-24.04; does **not** prove HIL or production readiness |
| Espressif [v2.x migration overview](https://docs.espressif.com/projects/esp-zigbee-sdk/en/latest/esp32c6/migration-guide/v2.x/overview.html) | v2.x **replaced ZBOSS** with Espressif proprietary stack; headers/APIs changed |
| In-repo `firmware/esp32c6-zigbee-coordinator/` | Interim **non-MicroPython** ESP-IDF target on **IDF v5.5.4** + **esp-zigbee-lib ~2.0.0** |

## Why not the other two options

1. **Port to v2 with genuine API migration** — Required, but is a full rewrite of the
   native bridge (`esp_zb_*` → v2 `ezb_*` / new headers). Not a version bump. Deferred.
2. **Mark build blocker only** — Rejected as the sole outcome: a reproducible v1.6 PoC
   pin is achievable and advances the standalone Python+Zigbee goal. Artifact may still
   be `BLOCKED` until a real cloud/native build succeeds.

## Hard constraints

- **Do not** mix ZBOSS/v1.6 headers or libs with esp-zigbee-lib ~2.0.0 / v2 API.
- **Do not** reuse `firmware/esp32c6-zigbee-coordinator/` expecting ABI compatibility
  with `_uzigbee`.
- Marketing banners (“production-ready”, HIL) are **not** evidence of PyBot hardware QA.
- Hardware Zigbee pairing remains **UNVERIFIED**.

## Pins (see also `PINS.json`)

| Component | Pin |
| --- | --- |
| uZigbee | `ff25553c5fc9d59754eba9a89811e6433e0d4479` |
| ESP-IDF | `v5.3.2` |
| MicroPython | `v1.27.0` |
| esp-zigbee-lib | `~1.6.0` |
| esp-zboss-lib | `~1.6.0` |
