# Zigbee OnOff limitations, Tuya quirks, Smart Life licensing

## Model-independent ZCL OnOff (cluster `0x0006`)

What this integration targets:

- Coordinator form / start via native `_uzigbee`
- Bounded `permit_join` (default **closed** on boot)
- Joined-device short-address discovery
- Active-endpoint + simple-descriptor discovery (**no invented endpoints `1`/`2`**)
- OnOff **ON / OFF / TOGGLE** commands to a **discovered** destination endpoint
- OnOff **READ** of attribute `0x0000` via local `get_attribute` and/or reporting cache
  (upstream `_uzigbee` has **no** remote ZCL Read Attributes command)

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
