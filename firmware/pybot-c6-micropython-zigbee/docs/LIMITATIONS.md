# Zigbee OnOff limitations, Tuya quirks, Smart Life licensing

## Model-independent ZCL OnOff (cluster `0x0006`)

What this integration targets:

- Coordinator form / start via native `_uzigbee`
- Bounded `permit_join` (default **closed** on boot)
- Joined-device short-address discovery
- Active-endpoint + simple-descriptor discovery (**no invented endpoints `1`/`2`**)
- OnOff **ON / OFF / TOGGLE** commands to a **discovered** destination endpoint
- OnOff attribute access is **split on purpose**:
  - `onoff_local_get` / `onoff_read(local_endpoint=…)` → local `get_attribute`
  - `onoff_cached` / `onoff_read(dst_endpoint=…)` → report cache only
    (upstream `_uzigbee` has **no** remote ZCL Read Attributes command)
  - Cache keys are `(short_addr, endpoint, cluster, attr)` to avoid cross-device collisions

What is **not** claimed:

- Universal support for all manufacturer switch dials / scenes / multi-gang quirks
- Guaranteed dual-channel mapping without reading the device’s active endpoints
- Thread / Matter
- Wi-Fi SoftAP Zigbee gateway QA

## Tuya manufacturer-specific quirks

Many Tuya-labelled Zigbee switches expose standard OnOff endpoints **and/or**
manufacturer-specific clusters / data points. Blindly assuming Tuya DP mapping
works is unsafe. Expand only with captures from the user’s real device on the bench.

## Smart Life / Tuya cloud gateway — separate licensing

Stand-alone ZCL OnOff on an Espressif coordinator is **not** Smart Life cloud
gateway registration. Official Smart Life gateway adoption requires Tuya PID,
license, and SDK terms. **No Tuya cloud support is claimed.** No cloud credentials
are used or stored by this path.

## Physical pairing requirement

Real switch pairing requires a **user-supervised physical bench** after:

1. Recovery backup of stock MicroPython (see `BACKUP_RESTORE.md`)
2. A **READY** firmware artifact with validated bootloader + partition + app layout
3. Explicit opt-in flash (never auto-flash)

First physical target: user’s Zigbee **two-channel** switch — exact endpoints/model
remain **UNVERIFIED** in source.

## Display + Zigbee coexistence

ST7789 172×320 must be retained in the product goal. **Coexistence of LCD + Zigbee
radio/stack on 4 MB / no PSRAM must be measured on hardware.** Espressif or uZigbee
SDK marketing claims are **not** proof of fit, heap margins, or flicker-free UI.

## Firmware build (cloud evidence, this tree)

A real `idf.py` / uZigbee compile on ESP-IDF **v5.3.2** + MicroPython **v1.27.0** +
uZigbee `ff25553` produced a multi-offset package (bootloader @ 0x0, partition @ 0x8000,
app @ 0x10000). App size ≈ **3.23 MB (~86% of factory 0x390000)** — fits 4 MB flash.
`modeReady` stays **false** and hardware validation stays **UNVERIFIED** until bench boot.

Build-time overlays required (see `overlays/README.md`): enable IEEE802154/Zigbee in
`boards/sdkconfig.c6` (upstream MPY forces IEEE802154=n), disable I2C target, guard
`esp_clk_tree_enable_src` for IDF &lt; 5.4. Zigbee SDK binary redistribution remains
subject to Espressif license review.
