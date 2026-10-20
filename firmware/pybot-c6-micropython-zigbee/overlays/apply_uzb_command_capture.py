#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
Build-time overlay: capture incoming ZCL/custom/IAS/privilege commands in uZigbee.

Applied ONLY to the ignored third_party/uzigbee checkout (pinned ff25553).
Does NOT mutate upstream git remotes.

Verified against Espressif esp-zigbee-lib 1.6.8 headers:
  ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_REQ_CB_ID / RESP_CB_ID
  ESP_ZB_CORE_CMD_PRIVILEGE_COMMAND_REQ_CB_ID / RESP_CB_ID
  ESP_ZB_CORE_CMD_IAS_ZONE_ZONE_STATUS_CHANGE_NOT_ID
  esp_zb_zcl_custom_cluster_command_message_t
  esp_zb_zcl_privilege_command_message_t
  esp_zb_zcl_ias_zone_status_change_notification_message_t
  esp_zb_zcl_cmd_info_t (src short/IEEE, src/dst EP, cluster, command, manuf_code)
"""
from __future__ import annotations

import pathlib
import sys

MARKER = "PYBOT_UZB_CMD_CAPTURE_OVERLAY"

UZB_CORE_H_EVENT_OLD = """typedef enum {
    UZB_EVENT_TYPE_APP_SIGNAL = 1,
    UZB_EVENT_TYPE_ATTR_SET = 2,
} uzb_event_type_t;

typedef struct {
    uint8_t has_source;
    uint16_t source_short_addr;
    uint8_t source_endpoint;
    uint8_t endpoint;
    uint16_t cluster_id;
    uint16_t attr_id;
    int32_t status;
    uzb_attr_value_t value;
} uzb_attr_set_event_t;

typedef struct {
    uint8_t type;
    union {
        uzb_app_signal_event_t app_signal;
        uzb_attr_set_event_t attr_set;
    } data;
} uzb_event_t;
"""

UZB_CORE_H_EVENT_NEW = """typedef enum {
    UZB_EVENT_TYPE_APP_SIGNAL = 1,
    UZB_EVENT_TYPE_ATTR_SET = 2,
    UZB_EVENT_TYPE_CMD = 3, /* PyBot overlay: incoming ZCL/custom/IAS/privilege */
} uzb_event_type_t;

typedef struct {
    uint8_t has_source;
    uint16_t source_short_addr;
    uint8_t source_endpoint;
    uint8_t endpoint;
    uint16_t cluster_id;
    uint16_t attr_id;
    int32_t status;
    uzb_attr_value_t value;
} uzb_attr_set_event_t;

/* Bounded payload copy — Zigbee task must not call MicroPython. */
#define UZB_CMD_PAYLOAD_MAX (64)

typedef struct {
    uint16_t callback_id;
    uint8_t has_src_short;
    uint16_t src_short_addr;
    uint8_t has_src_ieee;
    uint8_t src_ieee[8];
    uint8_t src_endpoint;
    uint8_t dst_endpoint;
    uint16_t dst_short_addr;
    uint16_t cluster_id;
    uint16_t profile_id;
    uint8_t command_id;
    uint8_t direction;
    uint8_t is_common;
    uint16_t manuf_code;
    int32_t status;
    uint16_t payload_len;
    uint8_t payload[UZB_CMD_PAYLOAD_MAX];
} uzb_cmd_event_t;

typedef struct {
    uint8_t type;
    union {
        uzb_app_signal_event_t app_signal;
        uzb_attr_set_event_t attr_set;
        uzb_cmd_event_t cmd;
    } data;
} uzb_event_t;
"""

UZB_ACTION_OLD = """static esp_err_t uzb_action_handler(esp_zb_core_action_callback_id_t callback_id, const void *message) {
    if (callback_id == ESP_ZB_CORE_SET_ATTR_VALUE_CB_ID) {
        uzb_enqueue_attr_set_event((const esp_zb_zcl_set_attr_value_message_t *)message);
    } else if (callback_id == ESP_ZB_CORE_REPORT_ATTR_CB_ID) {
        uzb_enqueue_report_attr_event((const esp_zb_zcl_report_attr_message_t *)message);
    }
    return ESP_OK;
}
"""

UZB_ACTION_NEW = """/* """ + MARKER + """ */
static void uzb_fill_cmd_from_info(uzb_cmd_event_t *out, uint16_t callback_id, const esp_zb_zcl_cmd_info_t *info) {
    if (out == NULL || info == NULL) {
        return;
    }
    memset(out, 0, sizeof(*out));
    out->callback_id = callback_id;
    out->status = (int32_t)info->status;
    out->src_endpoint = info->src_endpoint;
    out->dst_endpoint = info->dst_endpoint;
    out->dst_short_addr = info->dst_address;
    out->cluster_id = info->cluster;
    out->profile_id = info->profile;
    out->command_id = info->command.id;
    out->direction = info->command.direction;
    out->is_common = info->command.is_common;
    out->manuf_code = info->header.manuf_code;
    if (info->src_address.addr_type == ESP_ZB_ZCL_ADDR_TYPE_SHORT) {
        out->has_src_short = 1;
        out->src_short_addr = info->src_address.u.short_addr;
    } else if (info->src_address.addr_type == ESP_ZB_ZCL_ADDR_TYPE_IEEE) {
        out->has_src_ieee = 1;
        memcpy(out->src_ieee, info->src_address.u.ieee_addr, sizeof(out->src_ieee));
    }
}

static void uzb_copy_cmd_payload(uzb_cmd_event_t *out, const void *data, uint16_t size) {
    if (out == NULL) {
        return;
    }
    if (data == NULL || size == 0) {
        out->payload_len = 0;
        return;
    }
    uint16_t n = size;
    if (n > UZB_CMD_PAYLOAD_MAX) {
        n = UZB_CMD_PAYLOAD_MAX;
    }
    memcpy(out->payload, data, n);
    out->payload_len = n;
}

static void uzb_enqueue_cmd_event(const uzb_cmd_event_t *cmd) {
    if (cmd == NULL) {
        return;
    }
    uzb_event_t event = {0};
    event.type = UZB_EVENT_TYPE_CMD;
    event.data.cmd = *cmd;
    uzb_enqueue_event(&event);
}

static esp_err_t uzb_action_handler(esp_zb_core_action_callback_id_t callback_id, const void *message) {
    if (callback_id == ESP_ZB_CORE_SET_ATTR_VALUE_CB_ID) {
        uzb_enqueue_attr_set_event((const esp_zb_zcl_set_attr_value_message_t *)message);
    } else if (callback_id == ESP_ZB_CORE_REPORT_ATTR_CB_ID) {
        uzb_enqueue_report_attr_event((const esp_zb_zcl_report_attr_message_t *)message);
    } else if (callback_id == ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_REQ_CB_ID ||
               callback_id == ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_RESP_CB_ID) {
        const esp_zb_zcl_custom_cluster_command_message_t *msg =
            (const esp_zb_zcl_custom_cluster_command_message_t *)message;
        if (msg != NULL) {
            uzb_cmd_event_t cmd;
            uzb_fill_cmd_from_info(&cmd, (uint16_t)callback_id, &msg->info);
            uzb_copy_cmd_payload(&cmd, msg->data.value, msg->data.size);
            uzb_enqueue_cmd_event(&cmd);
        }
    } else if (callback_id == ESP_ZB_CORE_CMD_PRIVILEGE_COMMAND_REQ_CB_ID ||
               callback_id == ESP_ZB_CORE_CMD_PRIVILEGE_COMMAND_RESP_CB_ID) {
        const esp_zb_zcl_privilege_command_message_t *msg =
            (const esp_zb_zcl_privilege_command_message_t *)message;
        if (msg != NULL) {
            uzb_cmd_event_t cmd;
            uzb_fill_cmd_from_info(&cmd, (uint16_t)callback_id, &msg->info);
            uzb_copy_cmd_payload(&cmd, msg->data, msg->size);
            uzb_enqueue_cmd_event(&cmd);
        }
    } else if (callback_id == ESP_ZB_CORE_CMD_IAS_ZONE_ZONE_STATUS_CHANGE_NOT_ID) {
        const esp_zb_zcl_ias_zone_status_change_notification_message_t *msg =
            (const esp_zb_zcl_ias_zone_status_change_notification_message_t *)message;
        if (msg != NULL) {
            uzb_cmd_event_t cmd;
            uzb_fill_cmd_from_info(&cmd, (uint16_t)callback_id, &msg->info);
            /* Pack verified IAS fields into bounded payload (LE): status, ext, zone_id, delay */
            uint8_t packed[6];
            packed[0] = (uint8_t)(msg->zone_status & 0xFF);
            packed[1] = (uint8_t)((msg->zone_status >> 8) & 0xFF);
            packed[2] = msg->extended_status;
            packed[3] = msg->zone_id;
            packed[4] = (uint8_t)(msg->delay & 0xFF);
            packed[5] = (uint8_t)((msg->delay >> 8) & 0xFF);
            uzb_copy_cmd_payload(&cmd, packed, sizeof(packed));
            uzb_enqueue_cmd_event(&cmd);
        }
    }
    return ESP_OK;
}
"""

MOD_ROOT_OLD = """MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_signal_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_attr_callback);
"""

MOD_ROOT_NEW = """MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_signal_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_attr_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_command_callback); /* """ + MARKER + """ */
"""

MOD_GET_ATTR_OLD = """static mp_obj_t uzigbee_get_attr_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_attr_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}
"""

MOD_GET_ATTR_NEW = """static mp_obj_t uzigbee_get_attr_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_attr_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}

/* """ + MARKER + """ */
static mp_obj_t uzigbee_get_command_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_command_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}
"""

MOD_ON_ATTR_OLD = """static mp_obj_t uzigbee_on_attribute(mp_obj_t callback_in) {
    return uzigbee_set_attribute_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_attribute_obj, uzigbee_on_attribute);
"""

MOD_ON_ATTR_NEW = """static mp_obj_t uzigbee_on_attribute(mp_obj_t callback_in) {
    return uzigbee_set_attribute_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_attribute_obj, uzigbee_on_attribute);

/* """ + MARKER + """ */
static mp_obj_t uzigbee_set_command_callback(mp_obj_t callback_in) {
    if (callback_in != mp_const_none && !mp_obj_is_callable(callback_in)) {
        mp_raise_ValueError(MP_ERROR_TEXT("callback must be callable or None"));
    }
    MP_STATE_PORT(uzigbee_command_callback) = callback_in;
    return mp_const_none;
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_set_command_callback_obj, uzigbee_set_command_callback);

static mp_obj_t uzigbee_on_command(mp_obj_t callback_in) {
    return uzigbee_set_command_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_command_obj, uzigbee_on_command);

static mp_obj_t uzigbee_is_started(void) {
    return mp_obj_new_bool(uzb_core_is_started());
}
static MP_DEFINE_CONST_FUN_OBJ_0(uzigbee_is_started_obj, uzigbee_is_started);
"""

MOD_DISPATCH_OLD = """static mp_obj_t uzigbee_dispatch_events(mp_obj_t unused) {
    (void)unused;

    uzb_event_t event;
    mp_obj_t signal_cb = uzigbee_get_signal_callback();
    mp_obj_t attr_cb = uzigbee_get_attr_callback();
    while (uzb_core_pop_event(&event)) {
"""

MOD_DISPATCH_NEW = """static mp_obj_t uzigbee_dispatch_events(mp_obj_t unused) {
    (void)unused;

    uzb_event_t event;
    mp_obj_t signal_cb = uzigbee_get_signal_callback();
    mp_obj_t attr_cb = uzigbee_get_attr_callback();
    mp_obj_t cmd_cb = uzigbee_get_command_callback(); /* """ + MARKER + """ */
    while (uzb_core_pop_event(&event)) {
"""

MOD_DISPATCH_ATTR_END = """            if (!uzigbee_call_callback(attr_cb, 6, legacy_args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        }
    }

    uzb_core_dispatch_complete();
    return mp_const_none;
}
"""

MOD_DISPATCH_CMD_INSERT = """            if (!uzigbee_call_callback(attr_cb, 6, legacy_args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        } else if (event.type == UZB_EVENT_TYPE_CMD) {
            /* """ + MARKER + """: (src_short|None, src_ep, dst_ep, cluster, cmd, manuf, payload, cb_id, status) */
            if (cmd_cb == mp_const_none) {
                continue;
            }
            mp_obj_t src_obj = mp_const_none;
            if (event.data.cmd.has_src_short) {
                src_obj = mp_obj_new_int_from_uint(event.data.cmd.src_short_addr);
            }
            mp_obj_t payload_obj = mp_obj_new_bytes(event.data.cmd.payload, event.data.cmd.payload_len);
            mp_obj_t args[9] = {
                src_obj,
                mp_obj_new_int_from_uint(event.data.cmd.src_endpoint),
                mp_obj_new_int_from_uint(event.data.cmd.dst_endpoint),
                mp_obj_new_int_from_uint(event.data.cmd.cluster_id),
                mp_obj_new_int_from_uint(event.data.cmd.command_id),
                mp_obj_new_int_from_uint(event.data.cmd.manuf_code),
                payload_obj,
                mp_obj_new_int_from_uint(event.data.cmd.callback_id),
                mp_obj_new_int(event.data.cmd.status),
            };
            mp_obj_t callback_exc = mp_const_none;
            if (!uzigbee_call_callback(cmd_cb, 9, args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        }
    }

    uzb_core_dispatch_complete();
    return mp_const_none;
}
"""

MOD_TABLE_OLD = """    { MP_ROM_QSTR(MP_QSTR_on_attribute), MP_ROM_PTR(&uzigbee_on_attribute_obj) },
    { MP_ROM_QSTR(MP_QSTR_set_attribute_callback), MP_ROM_PTR(&uzigbee_set_attribute_callback_obj) },
"""

MOD_TABLE_NEW = """    { MP_ROM_QSTR(MP_QSTR_on_attribute), MP_ROM_PTR(&uzigbee_on_attribute_obj) },
    { MP_ROM_QSTR(MP_QSTR_set_attribute_callback), MP_ROM_PTR(&uzigbee_set_attribute_callback_obj) },
    { MP_ROM_QSTR(MP_QSTR_on_command), MP_ROM_PTR(&uzigbee_on_command_obj) }, /* """ + MARKER + """ */
    { MP_ROM_QSTR(MP_QSTR_set_command_callback), MP_ROM_PTR(&uzigbee_set_command_callback_obj) },
    { MP_ROM_QSTR(MP_QSTR_is_started), MP_ROM_PTR(&uzigbee_is_started_obj) },
"""


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if MARKER in text and old not in text:
        # Already applied (idempotent)
        return text
    if old not in text:
        raise SystemExit(f"overlay miss: {label}")
    return text.replace(old, new, 1)


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <uzigbee-root>", file=sys.stderr)
        return 2
    root = pathlib.Path(sys.argv[1])
    core_h = root / "c_module" / "uzb_core.h"
    core_c = root / "c_module" / "uzb_core.c"
    mod_c = root / "c_module" / "mod_uzigbee.c"
    for p in (core_h, core_c, mod_c):
        if not p.is_file():
            raise SystemExit(f"missing {p}")

    h = core_h.read_text(encoding="utf-8")
    if MARKER not in h:
        h = must_replace(h, UZB_CORE_H_EVENT_OLD, UZB_CORE_H_EVENT_NEW, "uzb_core.h event types")
        core_h.write_text(h, encoding="utf-8")
        print("[OK] overlay uzb_core.h command event")
    else:
        print("[INFO] uzb_core.h already overlaid")

    c = core_c.read_text(encoding="utf-8")
    if MARKER not in c:
        c = must_replace(c, UZB_ACTION_OLD, UZB_ACTION_NEW, "uzb_core.c action handler")
        core_c.write_text(c, encoding="utf-8")
        print("[OK] overlay uzb_core.c action handler command capture")
    else:
        print("[INFO] uzb_core.c already overlaid")

    m = mod_c.read_text(encoding="utf-8")
    if MARKER not in m:
        m = must_replace(m, MOD_ROOT_OLD, MOD_ROOT_NEW, "mod root pointer")
        m = must_replace(m, MOD_GET_ATTR_OLD, MOD_GET_ATTR_NEW, "mod get command cb")
        m = must_replace(m, MOD_ON_ATTR_OLD, MOD_ON_ATTR_NEW, "mod on_command")
        m = must_replace(m, MOD_DISPATCH_OLD, MOD_DISPATCH_NEW, "mod dispatch cmd_cb")
        m = must_replace(m, MOD_DISPATCH_ATTR_END, MOD_DISPATCH_CMD_INSERT, "mod dispatch cmd branch")
        m = must_replace(m, MOD_TABLE_OLD, MOD_TABLE_NEW, "mod export table")
        mod_c.write_text(m, encoding="utf-8")
        print("[OK] overlay mod_uzigbee.c on_command + is_started")
    else:
        print("[INFO] mod_uzigbee.c already overlaid")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
