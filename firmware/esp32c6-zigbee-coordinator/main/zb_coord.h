/*
 * PyBot ESP32-C6 native Zigbee 3.x coordinator — internal API.
 * Based on Espressif ESP Zigbee SDK v2.x HA coordinator patterns
 * (home_automation_devices/on_off_light + on_off_switch ZCL client).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#define PYBOT_ZB_PRIMARY_CHANNEL_MASK   (1U << CONFIG_PYBOT_ZB_PRIMARY_CHANNEL)
#define PYBOT_ZB_SECONDARY_CHANNEL_MASK 0x07FFF800U

#define PYBOT_ZB_HA_SWITCH_EP_ID 1

#define PYBOT_ZB_MANUFACTURER_NAME "\x05" "PyBot"
#define PYBOT_ZB_MODEL_IDENTIFIER  "\x0C" "C6-ZB-Coord"

#define PYBOT_ZB_FW_ID   "pybot-zb-coord"
#define PYBOT_ZB_FW_VER  "0.1.0"

#define PYBOT_ZB_ZC_CONFIG()                                      \
    {                                                             \
        .device_type = EZB_NWK_DEVICE_TYPE_COORDINATOR,           \
        .install_code_policy = false,                             \
        .zczr_config = {                                          \
            .max_children = CONFIG_PYBOT_ZB_MAX_CHILDREN,         \
        },                                                        \
    }

#if CONFIG_SOC_IEEE802154_SUPPORTED
#define PYBOT_ZB_PLATFORM_CONFIG()                                \
    {                                                             \
        .storage_partition_name = "nvs",                          \
        .radio_config = {                                         \
            .radio_mode = ESP_ZIGBEE_RADIO_MODE_NATIVE,           \
        },                                                        \
    }
#else
#error "ESP32-C6 with native IEEE 802.15.4 required (no RCP mock)"
#endif

#define PYBOT_ZB_DEFAULT_CONFIG()                                 \
    {                                                             \
        .device_config = PYBOT_ZB_ZC_CONFIG(),                    \
        .platform_config = PYBOT_ZB_PLATFORM_CONFIG(),            \
    }

esp_err_t pybot_zb_stack_start(void);
esp_err_t pybot_zb_permit_join(uint8_t timeout_s);
esp_err_t pybot_zb_permit_join_close(void);
esp_err_t pybot_zb_zcl_onoff(uint16_t short_addr, uint8_t endpoint, const char *action);
esp_err_t pybot_zb_zcl_onoff_read(uint16_t short_addr, uint8_t endpoint);
bool pybot_zb_network_is_formed(void);
uint16_t pybot_zb_get_pan_id(void);
uint8_t pybot_zb_get_channel(void);
uint64_t pybot_zb_get_ext_pan_id(void);
