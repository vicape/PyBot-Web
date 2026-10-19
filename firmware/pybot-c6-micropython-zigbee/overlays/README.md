# Build-time overlays for ESP-IDF v5.3.2 + MicroPython v1.27.0

Applied by `build.sh` onto the ignored `third_party/uzigbee/...` checkout only,
**after** `bootstrap_third_party.sh` so board/sdkconfig paths exist on a fresh clone.

1. Patch `boards/sdkconfig.c6`: force `CONFIG_IEEE802154_ENABLED=y` and append
   uZigbee `firmware/sdkconfig.defaults` Zigbee symbols. Upstream MPY sets
   IEEE802154=n and the Makefile does not forward `SDKCONFIG_DEFAULTS=…` into CMake.
2. `MICROPY_PY_MACHINE_I2C_TARGET=0` in board `mpconfigboard.h` — I2C slave APIs missing in IDF 5.3.2.
3. Guard `esp_clk_tree_enable_src` in `machine_timer.c` for IDF < 5.4.

These keep the ZBOSS/Zigbee v1.6 PoC pin (IDF 5.3.2) buildable. Not a claim of full MPY 1.27 feature parity on 5.3.2.
