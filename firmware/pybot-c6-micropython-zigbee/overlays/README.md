# Build-time overlays for ESP-IDF v5.3.2 + MicroPython v1.27.0

Applied by `build.sh` onto the ignored `third_party/uzigbee/...` checkout only,
**after** `bootstrap_third_party.sh` so board/sdkconfig paths exist on a fresh clone.

1. Patch `boards/sdkconfig.c6`: force `CONFIG_IEEE802154_ENABLED=y` and append
   uZigbee `firmware/sdkconfig.defaults` Zigbee symbols. Upstream MPY sets
   IEEE802154=n and the Makefile does not forward `SDKCONFIG_DEFAULTS=…` into CMake.
2. `MICROPY_PY_MACHINE_I2C_TARGET=0` in board `mpconfigboard.h` — I2C slave APIs missing in IDF 5.3.2.
3. Guard `esp_clk_tree_enable_src` in `machine_timer.c` for IDF < 5.4.
4. **`apply_uzb_command_capture.py`** — extend pinned uZigbee `uzb_action_handler` to
   enqueue incoming commands for Espressif esp-zigbee-lib **v1.6** callbacks that are
   actually present in resolved headers (verified against component **1.6.8**):
   - `ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_REQ_CB_ID` / `RESP_CB_ID` (0x1040 / 0x1041)
   - `ESP_ZB_CORE_CMD_PRIVILEGE_COMMAND_REQ_CB_ID` / `RESP_CB_ID` (0x1050 / 0x1051)
   - `ESP_ZB_CORE_CMD_IAS_ZONE_ZONE_STATUS_CHANGE_NOT_ID` (0x1031)
   Bounded native queue (no MicroPython from Zigbee task); Python `_uzigbee.on_command`
   + `is_started`. Does **not** invent OnOff or Tuya DP mappings.
5. **`apply_uzb_aps_capture.py`** — register SDK **1.6.8** APS indication callback
   `esp_zb_aps_data_indication_handler_register` (indication **by value**) once after
   `esp_zb_device_register` / before `esp_zb_start`. Captures HA profile `0x0104` +
   cluster `0xEF00` ASDU into a bounded native queue; returns `false` so the stack
   continues. Exposes `_uzigbee.on_aps`. Does **not** lift `add_custom_cluster` 0xFC00
   gate (0xEF00 remains invalid there — APS path is the intended capture).

These keep the ZBOSS/Zigbee v1.6 PoC pin (IDF 5.3.2) buildable. Not a claim of full MPY 1.27 feature parity on 5.3.2.
