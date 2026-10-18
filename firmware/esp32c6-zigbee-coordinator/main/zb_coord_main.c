/*
 * PyBot native Zigbee 3.x coordinator for ESP32-C6.
 *
 * Role: Zigbee Coordinator (forms network, bounded permit-join, device IEEE
 * discovery, ZCL OnOff client commands/read for commercial OnOff switches).
 *
 * Patterns follow Espressif ESP Zigbee SDK v2.x HA samples:
 * - home_automation_devices/on_off_light (ZC form / steering / device_annce)
 * - home_automation_devices/on_off_switch (OnOff client + match_desc)
 *
 * This firmware REPLACES MicroPython when flashed (4MB cannot host both).
 * Flash only via explicit opt-in; restore MicroPython from Universal Lab M1 image.
 */

#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_zigbee.h"
#include "ezbee/zha.h"
#include "ezbee/zcl/zcl_core.h"
#include "ezbee/zcl/cluster/on_off.h"
#include "ezbee/zcl/zcl_general_cmd.h"

#include "zb_coord.h"
#include "zb_host_proto.h"

static const char *TAG = "PYBOT_ZB_COORD";

static bool s_network_formed = false;
static uint16_t s_pan_id = 0;
static uint8_t s_channel = 0;
static uint64_t s_ext_pan = 0;

bool pybot_zb_network_is_formed(void)
{
    return s_network_formed;
}

uint16_t pybot_zb_get_pan_id(void)
{
    return s_pan_id;
}

uint8_t pybot_zb_get_channel(void)
{
    return s_channel;
}

uint64_t pybot_zb_get_ext_pan_id(void)
{
    return s_ext_pan;
}

static void schedule_commissioning(void *arg)
{
    ezb_bdb_mode_t mode = (ezb_bdb_mode_t)(uintptr_t)arg;
    esp_zigbee_lock_acquire(portMAX_DELAY);
    (void)ezb_bdb_start_top_level_commissioning(mode);
    esp_zigbee_lock_release();
}

static void retry_commissioning_later(ezb_bdb_mode_t mode, int delay_ms)
{
    esp_timer_handle_t timer = NULL;
    const esp_timer_create_args_t args = {
        .callback = &schedule_commissioning,
        .arg = (void *)(uintptr_t)mode,
        .name = "zb_bdb_retry",
    };
    if (esp_timer_create(&args, &timer) == ESP_OK) {
        esp_timer_start_once(timer, (uint64_t)delay_ms * 1000ULL);
    }
}

static void emit_device_joined(uint16_t short_addr, uint64_t ieee, uint8_t endpoint)
{
    char buf[192];
    snprintf(buf, sizeof(buf),
             "{\"evt\":\"device_joined\",\"short\":%u,\"ieee\":\"0x%016llx\",\"endpoints\":[%u]}",
             (unsigned)short_addr, (unsigned long long)ieee, (unsigned)endpoint);
    pybot_zb_host_emit(buf);
}

static void zdo_match_onoff_result(const ezb_zdo_match_desc_req_result_t *result, void *user_ctx)
{
    uint16_t short_addr = (uint16_t)(uintptr_t)user_ctx;
    if (!result || result->error != EZB_ERR_NONE || !result->rsp ||
        result->rsp->status != EZB_ZDP_STATUS_SUCCESS || result->rsp->match_length == 0 ||
        !result->rsp->match_list) {
        ESP_LOGW(TAG, "OnOff match_desc empty for 0x%04x", short_addr);
        emit_device_joined(short_addr, 0, 1);
        return;
    }

    ezb_extaddr_t ieee = {0};
    if (ezb_address_extended_by_short(short_addr, &ieee) != EZB_ERR_NONE) {
        ieee.u64 = 0;
    }

    for (size_t i = 0; i < result->rsp->match_length; i++) {
        emit_device_joined(short_addr, ieee.u64, result->rsp->match_list[i]);
    }
}

static void discover_onoff_endpoints(uint16_t short_addr)
{
    uint16_t cluster_list[1] = {EZB_ZCL_CLUSTER_ID_ON_OFF};
    ezb_zdo_match_desc_req_t req = {
        .dst_nwk_addr = short_addr,
        .field =
            {
                .nwk_addr_of_interest = short_addr,
                .profile_id = EZB_AF_HA_PROFILE_ID,
                .num_in_clusters = 1,
                .num_out_clusters = 0,
                .cluster_list = cluster_list,
            },
        .cb = zdo_match_onoff_result,
        .user_ctx = (void *)(uintptr_t)short_addr,
    };
    ezb_err_t ret = ezb_zdo_match_desc_req(&req);
    if (ret != EZB_ERR_NONE) {
        ESP_LOGW(TAG, "match_desc failed (0x%04x)", ret);
    }
}

static bool esp_zigbee_app_signal_handler(const ezb_app_signal_t *app_signal)
{
    ezb_app_signal_type_t signal_type = ezb_app_signal_get_type(app_signal);

    switch (signal_type) {
    case EZB_ZDO_SIGNAL_SKIP_STARTUP:
        ESP_LOGI(TAG, "Initialize Zigbee stack");
        ezb_bdb_start_top_level_commissioning(EZB_BDB_MODE_INITIALIZATION);
        break;

    case EZB_BDB_SIGNAL_DEVICE_FIRST_START:
    case EZB_BDB_SIGNAL_DEVICE_REBOOT: {
        ezb_bdb_comm_status_t status = *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            ESP_LOGI(TAG, "Device started up in%s factory-reset mode",
                     ezb_bdb_is_factory_new() ? "" : " non");
            if (ezb_bdb_is_factory_new()) {
                ezb_bdb_start_top_level_commissioning(EZB_BDB_MODE_NETWORK_FORMATION);
            } else {
                s_network_formed = true;
                s_pan_id = ezb_nwk_get_panid();
                s_channel = ezb_nwk_get_current_channel();
                ezb_extpanid_t ext = {0};
                ezb_nwk_get_extended_panid(&ext);
                s_ext_pan = ext.u64;
                /* Do not leave network permanently open — host must permit_join. */
                ESP_LOGI(TAG, "Reboot: network already formed; permit_join closed by default");
                char buf[256];
                snprintf(buf, sizeof(buf),
                         "{\"evt\":\"net_formed\",\"pan_id\":%u,\"channel\":%u,\"ext_pan\":\"0x%016llx\",\"reboot\":true}",
                         (unsigned)s_pan_id, (unsigned)s_channel, (unsigned long long)s_ext_pan);
                pybot_zb_host_emit(buf);
            }
        } else {
            ESP_LOGW(TAG, "%s failed status(0x%02x)", ezb_app_signal_to_string(signal_type), status);
            retry_commissioning_later(EZB_BDB_MODE_INITIALIZATION, 1000);
        }
    } break;

    case EZB_BDB_SIGNAL_FORMATION: {
        ezb_bdb_comm_status_t status = *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            ezb_extpanid_t extended_pan_id = {0};
            ezb_nwk_get_extended_panid(&extended_pan_id);
            s_network_formed = true;
            s_pan_id = ezb_nwk_get_panid();
            s_channel = ezb_nwk_get_current_channel();
            s_ext_pan = extended_pan_id.u64;
            ESP_LOGI(TAG,
                     "Formed network: PAN(0x%04hx) EXT(0x%llx) CH(%d) SHORT(0x%04hx)",
                     s_pan_id, (unsigned long long)s_ext_pan, s_channel, ezb_nwk_get_short_address());
            char buf[256];
            snprintf(buf, sizeof(buf),
                     "{\"evt\":\"net_formed\",\"pan_id\":%u,\"channel\":%u,\"ext_pan\":\"0x%016llx\"}",
                     (unsigned)s_pan_id, (unsigned)s_channel, (unsigned long long)s_ext_pan);
            pybot_zb_host_emit(buf);
            /* Safe default: network formed but join closed until host opens a bounded window. */
        } else {
            ESP_LOGW(TAG, "Form failed status(0x%02x)", status);
            retry_commissioning_later(EZB_BDB_MODE_NETWORK_FORMATION, 1000);
        }
    } break;

    case EZB_BDB_SIGNAL_STEERING: {
        ezb_bdb_comm_status_t status = *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        ESP_LOGI(TAG, "Steering finished status(0x%02x)", status);
    } break;

    case EZB_ZDO_SIGNAL_DEVICE_ANNCE: {
        const ezb_zdo_signal_device_annce_params_t *annce = ezb_app_signal_get_params(app_signal);
        ESP_LOGI(TAG, "Device annce short=0x%04hx ieee=0x%llx", annce->short_addr,
                 (unsigned long long)annce->device_addr.u64);
        char buf[192];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"device_annce\",\"short\":%u,\"ieee\":\"0x%016llx\"}",
                 (unsigned)annce->short_addr, (unsigned long long)annce->device_addr.u64);
        pybot_zb_host_emit(buf);
        discover_onoff_endpoints(annce->short_addr);
    } break;

    case EZB_NWK_SIGNAL_PERMIT_JOIN_STATUS: {
        uint8_t duration = *(uint8_t *)ezb_app_signal_get_params(app_signal);
        char buf[96];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"permit_join\",\"open\":%s,\"timeout_s\":%u}",
                 duration ? "true" : "false", (unsigned)duration);
        pybot_zb_host_emit(buf);
    } break;

    default:
        ESP_LOGD(TAG, "Signal %s (0x%02x)", ezb_app_signal_to_string(signal_type), signal_type);
        break;
    }
    return true;
}

static void zcl_core_action_handler(ezb_zcl_core_action_callback_id_t callback_id, void *message)
{
    switch (callback_id) {
    case EZB_ZCL_CORE_DEFAULT_RSP_CB_ID: {
        ezb_zcl_cmd_default_rsp_message_t *rsp = message;
        char buf[96];
        snprintf(buf, sizeof(buf), "{\"evt\":\"zcl_default_rsp\",\"status\":%u}",
                 (unsigned)rsp->in.status_code);
        pybot_zb_host_emit(buf);
    } break;
    case EZB_ZCL_CORE_READ_ATTR_RSP_CB_ID: {
        ezb_zcl_cmd_read_attr_rsp_message_t *rsp = message;
        if (rsp && rsp->in.variables) {
            ezb_zcl_read_attr_rsp_variable_t *v = rsp->in.variables;
            unsigned val = 0;
            if (v->status == 0 && v->attr_value) {
                val = *(uint8_t *)v->attr_value;
            }
            char buf[128];
            snprintf(buf, sizeof(buf),
                     "{\"evt\":\"zcl_attr\",\"cluster\":\"onoff\",\"attr\":%u,\"status\":%u,\"value\":%u}",
                     (unsigned)v->attr_id, (unsigned)v->status, val);
            pybot_zb_host_emit(buf);
        }
    } break;
    default:
        break;
    }
}

static esp_err_t create_zha_on_off_switch_endpoint(void)
{
    ezb_af_device_desc_t dev_desc = ezb_af_create_device_desc();
    ezb_zha_on_off_switch_config_t switch_cfg = EZB_ZHA_ON_OFF_SWITCH_CONFIG();
    ezb_af_ep_desc_t ep_desc = ezb_zha_create_on_off_switch(PYBOT_ZB_HA_SWITCH_EP_ID, &switch_cfg);
    ezb_zcl_cluster_desc_t basic_desc =
        ezb_af_endpoint_get_cluster_desc(ep_desc, EZB_ZCL_CLUSTER_ID_BASIC, EZB_ZCL_CLUSTER_SERVER);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc, EZB_ZCL_ATTR_BASIC_MANUFACTURER_NAME_ID,
                                        (void *)PYBOT_ZB_MANUFACTURER_NAME);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc, EZB_ZCL_ATTR_BASIC_MODEL_IDENTIFIER_ID,
                                        (void *)PYBOT_ZB_MODEL_IDENTIFIER);
    ESP_ERROR_CHECK(ezb_af_device_add_endpoint_desc(dev_desc, ep_desc));
    ESP_ERROR_CHECK(ezb_af_device_desc_register(dev_desc));
    ezb_zcl_core_action_handler_register(zcl_core_action_handler);
    return ESP_OK;
}

static esp_err_t setup_commissioning(void)
{
    /* Centralized security (not distributed) — safer default for a lab coordinator. */
    ezb_aps_secur_enable_distributed_security(false);
    ESP_ERROR_CHECK(ezb_bdb_set_primary_channel_set(PYBOT_ZB_PRIMARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(ezb_bdb_set_secondary_channel_set(PYBOT_ZB_SECONDARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(ezb_app_signal_add_handler(esp_zigbee_app_signal_handler));
    return ESP_OK;
}

esp_err_t pybot_zb_permit_join(uint8_t timeout_s)
{
    if (!s_network_formed) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ezb_err_t err = ezb_bdb_open_network(timeout_s);
    esp_zigbee_lock_release();
    return (err == EZB_ERR_NONE) ? ESP_OK : ESP_FAIL;
}

esp_err_t pybot_zb_permit_join_close(void)
{
    if (!s_network_formed) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ezb_err_t err = ezb_bdb_open_network(0);
    esp_zigbee_lock_release();
    return (err == EZB_ERR_NONE) ? ESP_OK : ESP_FAIL;
}

esp_err_t pybot_zb_zcl_onoff(uint16_t short_addr, uint8_t endpoint, const char *action)
{
    if (!action) {
        return ESP_ERR_INVALID_ARG;
    }
    ezb_zcl_on_off_cmd_t cmd = {
        .cmd_ctrl =
            {
                .dst_addr = EZB_ADDRESS_SHORT(short_addr),
                .dst_ep = endpoint,
                .src_ep = PYBOT_ZB_HA_SWITCH_EP_ID,
                .dis_default_rsp = false,
            },
    };
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ezb_err_t err = EZB_ERR_FAIL;
    if (strcmp(action, "on") == 0) {
        err = ezb_zcl_on_off_on_cmd_req(&cmd);
    } else if (strcmp(action, "off") == 0) {
        err = ezb_zcl_on_off_off_cmd_req(&cmd);
    } else if (strcmp(action, "toggle") == 0) {
        err = ezb_zcl_on_off_toggle_cmd_req(&cmd);
    } else {
        esp_zigbee_lock_release();
        return ESP_ERR_INVALID_ARG;
    }
    esp_zigbee_lock_release();
    return (err == EZB_ERR_NONE) ? ESP_OK : ESP_FAIL;
}

esp_err_t pybot_zb_zcl_onoff_read(uint16_t short_addr, uint8_t endpoint)
{
    static uint16_t attr_ids[1] = {EZB_ZCL_ATTR_ON_OFF_ON_OFF_ID};
    ezb_zcl_read_attr_cmd_t cmd = {
        .cmd_ctrl =
            {
                .dst_addr = EZB_ADDRESS_SHORT(short_addr),
                .dst_ep = endpoint,
                .src_ep = PYBOT_ZB_HA_SWITCH_EP_ID,
                .cluster_id = EZB_ZCL_CLUSTER_ID_ON_OFF,
                .manuf_code = EZB_ZCL_STD_MANUF_CODE,
            },
        .payload =
            {
                .attr_number = 1,
                .attr_field = attr_ids,
            },
    };
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ezb_err_t err = ezb_zcl_read_attr_cmd_req(&cmd);
    esp_zigbee_lock_release();
    return (err == EZB_ERR_NONE) ? ESP_OK : ESP_FAIL;
}

static void zigbee_main_task(void *pvParameters)
{
    (void)pvParameters;
    esp_zigbee_config_t config = PYBOT_ZB_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(esp_zigbee_init(&config));
    ESP_ERROR_CHECK(setup_commissioning());
    ESP_ERROR_CHECK(create_zha_on_off_switch_endpoint());
    ESP_ERROR_CHECK(esp_zigbee_start(false));
    esp_zigbee_launch_mainloop();
    esp_zigbee_deinit();
    vTaskDelete(NULL);
}

esp_err_t pybot_zb_stack_start(void)
{
    BaseType_t ok = xTaskCreate(zigbee_main_task, "Zigbee_main", 4096, NULL, 5, NULL);
    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}

void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_LOGI(TAG, "PyBot Zigbee coordinator %s starting (NOT MicroPython)", PYBOT_ZB_FW_VER);
    pybot_zb_host_proto_start();
    ESP_ERROR_CHECK(pybot_zb_stack_start());
}
