# Zigbee capability coverage matrix (uZigbee PoC pin ff25553 / ZBOSS v1.6)

Legend:
- **Native**: YES if `_uzigbee` C export exists at pinned commit; NO otherwise
- **pybot.zigbee**: IMPLEMENTED / SOURCE_ADAPTER / UnsupportedError / N/A
- **Physical**: UNVERIFIED until user-supervised bench (never claimed from unit tests)

| Area | Native | pybot.zigbee now | Physical |
| --- | --- | --- | --- |
| Coordinator init/start | YES (`init`,`start`) | IMPLEMENTED `start_coordinator` | UNVERIFIED |
| Coordinator stop | NO dedicated stop | UnsupportedError `stop_coordinator` | N/A |
| Status / diagnose | partial (`get_network_runtime`) | IMPLEMENTED `diagnose`,`coordinator_status`,`network_runtime` | UNVERIFIED |
| Form / reopen network | YES (`start(form_network=…)`) + zb_storage partition | IMPLEMENTED; NVRAM persistence SDK-side | UNVERIFIED |
| Channel / PAN choose | via runtime read; no free channel setter audited | read via `network_runtime` only | UNVERIFIED |
| Trust center / security | YES (install codes, network key APIs) | SOURCE_ADAPTER not wrapped (use native if needed) | UNVERIFIED |
| Permit join bounded | YES `permit_join` | IMPLEMENTED `permit_join`/`close_join` (default closed) | UNVERIFIED |
| Join/leave signals | YES `on_signal` | IMPLEMENTED `on_join`/`on_leave`/`poll_events` | UNVERIFIED |
| Last joined short addr | YES | IMPLEMENTED `last_joined_short_addr` | UNVERIFIED |
| Active endpoints | YES (tuple snapshot) | IMPLEMENTED `discover_active_endpoints` | UNVERIFIED |
| Simple descriptors | YES | IMPLEMENTED `discover_simple_descriptor` | UNVERIFIED |
| OnOff endpoints filter | derived | IMPLEMENTED `discover_onoff_endpoints` | UNVERIFIED |
| ZCL OnOff cmds | YES `send_on_off_cmd` | IMPLEMENTED on/off/toggle | UNVERIFIED |
| Local attr get | YES `get_attribute` | IMPLEMENTED `onoff_local_get` | UNVERIFIED |
| Remote ZCL Read Attributes | **NO** | N/A — use `onoff_cached` (reports only) | N/A |
| Report / attr cache | YES `on_attribute` | IMPLEMENTED keyed cache `(addr,ep,cluster,attr)` | UNVERIFIED |
| Level control | YES `send_level_cmd` | IMPLEMENTED `level_move_to` | UNVERIFIED |
| Identify | NO dedicated send | UnsupportedError | N/A |
| Groups | YES | IMPLEMENTED `group_add`/`group_remove` | UNVERIFIED |
| Scenes | YES | IMPLEMENTED `scene_recall` (others native-available) | UNVERIFIED |
| Bind / unbind | YES | IMPLEMENTED `bind`/`unbind` | UNVERIFIED |
| Configure reporting | YES | IMPLEMENTED `configure_reporting` | UNVERIFIED |
| IAS / temp / humidity / occupancy | YES create_* local endpoints | not wrapped as remote sensors yet | UNVERIFIED |
| OTA | YES ota_client_* | not wrapped | UNVERIFIED |
| Router / end-device roles | YES role constants | labeled; only coordinator path tested in adapter | UNVERIFIED |
| Thread / Matter | NO | N/A — not claimed | N/A |
| Tuya manufacturer DP | NO fabricated map | UnsupportedError `tuya_manufacturer_dp_unsupported` | N/A |
| Smart Life cloud | SEPARATE product | NOT claimed | N/A |
| LCD + Zigbee coexistence | firmware goal | depends on READY image + heap measure | UNVERIFIED |

## Firmware artifact

See `build-artifact/BUILD_STATUS.json`. After cloud compile: **READY** multi-offset
(bootloader+partition+app) with real SHA256; app ≈86% of factory. `modeReady=false`
until hardware boot. Stock MicroPython SHA `111ca632…` remains the safe default
(no auto-flash). Binaries under `build-artifact/*.bin` are gitignored — rebuild with
`./build.sh` to regenerate.
