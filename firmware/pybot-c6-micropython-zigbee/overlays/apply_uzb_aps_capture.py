#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
Build-time overlay: native APSDE-DATA.indication capture for HA 0xEF00 (SC10/TS0021).

Applied ONLY to the ignored third_party/uzigbee checkout (pinned ff25553), AFTER
apply_uzb_command_capture.py. Does NOT mutate upstream git remotes.

Verified against Espressif esp-zigbee-lib 1.6.8 (IDF 5.3.2) headers:
  #include "aps/esp_zigbee_aps.h"  (already present in upstream uzb_core.c)
  void esp_zb_aps_data_indication_handler_register(esp_zb_apsde_data_indication_callback_t cb);
  typedef bool (*esp_zb_apsde_data_indication_callback_t)(esp_zb_apsde_data_ind_t ind);
  — callback receives esp_zb_apsde_data_ind_t BY VALUE (SDK v1.x), not pointer (v2.x).

Registers ONCE after esp_zb_device_register / action-handler, BEFORE esp_zb_start.
Returns false so the Zigbee stack continues normal processing.
Copies ASDU bytes into a bounded event; never calls MicroPython from the Zigbee task.
"""
from __future__ import annotations

import pathlib
import sys

MARKER = "PYBOT_UZB_APS_CAPTURE_OVERLAY"
CMD_MARKER = "PYBOT_UZB_CMD_CAPTURE_OVERLAY"

# --- uzb_core.h: extend event types after command-capture overlay ---
UZB_CORE_H_EVENT_OLD = """typedef enum {
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

UZB_CORE_H_EVENT_NEW = """typedef enum {
    UZB_EVENT_TYPE_APP_SIGNAL = 1,
    UZB_EVENT_TYPE_ATTR_SET = 2,
    UZB_EVENT_TYPE_CMD = 3, /* PyBot overlay: incoming ZCL/custom/IAS/privilege */
    UZB_EVENT_TYPE_APS = 4, /* """ + MARKER + """: raw APSDE indication */
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

/* """ + MARKER + """ — bounded ASDU copy (SDK 1.6.8 by-value indication). */
#define UZB_APS_ASDU_MAX (64)

typedef struct {
    uint16_t src_short_addr;
    uint8_t src_endpoint;
    uint8_t dst_endpoint;
    uint16_t profile_id;
    uint16_t cluster_id;
    int32_t status;
    uint16_t asdu_len;       /* bytes copied into asdu[] */
    uint16_t asdu_len_orig;  /* original indication length */
    uint8_t truncated;       /* 1 if asdu_len_orig > UZB_APS_ASDU_MAX */
    uint8_t asdu[UZB_APS_ASDU_MAX];
} uzb_aps_event_t;

typedef struct {
    uint8_t type;
    union {
        uzb_app_signal_event_t app_signal;
        uzb_attr_set_event_t attr_set;
        uzb_cmd_event_t cmd;
        uzb_aps_event_t aps;
    } data;
} uzb_event_t;
"""

# Insert APS handler + registration into uzb_core_start path (after action handler).
UZB_START_COMMIT_OLD = """            if (err == ESP_OK) {
                s_registered_ep_list = NULL;
                s_device_register_committed = true;
            }
        }
    }
    if (err == ESP_OK) {
        err = esp_zb_start(false);
    }
"""

UZB_START_COMMIT_NEW = """            if (err == ESP_OK) {
                s_registered_ep_list = NULL;
                s_device_register_committed = true;
            }
        }
    }
    /* """ + MARKER + """: APS indication AFTER device register, BEFORE esp_zb_start (once) */
    if (err == ESP_OK && !s_aps_handler_registered) {
        esp_zb_aps_data_indication_handler_register(uzb_aps_indication_handler);
        s_aps_handler_registered = true;
    }
    if (err == ESP_OK) {
        err = esp_zb_start(false);
    }
"""

# Static state + callback inserted just before uzb_action_handler (post cmd-overlay marker).
UZB_ACTION_ANCHOR = "/* " + CMD_MARKER + " */\nstatic void uzb_fill_cmd_from_info"

UZB_APS_HANDLER_BLOCK = """/* """ + MARKER + """ */
static bool s_aps_handler_registered = false;

/* SDK 1.6.8: indication BY VALUE. Return false => stack continues. */
static bool uzb_aps_indication_handler(esp_zb_apsde_data_ind_t ind) {
    if (ind.status != 0) {
        return false;
    }
    /* Capture HA profile + Tuya manuf cluster 0xEF00 (SC10/TS0021 path). */
    if (ind.profile_id != 0x0104 || ind.cluster_id != 0xEF00) {
        return false;
    }

    uzb_event_t event = {0};
    event.type = UZB_EVENT_TYPE_APS;
    event.data.aps.src_short_addr = ind.src_short_addr;
    event.data.aps.src_endpoint = ind.src_endpoint;
    event.data.aps.dst_endpoint = ind.dst_endpoint;
    event.data.aps.profile_id = ind.profile_id;
    event.data.aps.cluster_id = ind.cluster_id;
    event.data.aps.status = (int32_t)ind.status;

    uint32_t orig = ind.asdu_length;
    if (orig > 0xFFFFu) {
        orig = 0xFFFFu;
    }
    event.data.aps.asdu_len_orig = (uint16_t)orig;
    uint16_t n = (uint16_t)orig;
    if (n > UZB_APS_ASDU_MAX) {
        event.data.aps.truncated = 1;
        n = UZB_APS_ASDU_MAX;
    }
    event.data.aps.asdu_len = n;
    if (ind.asdu != NULL && n > 0) {
        memcpy(event.data.aps.asdu, ind.asdu, n);
    }

    /* Bounded queue (dropped_queue_full via get_event_stats). No prints from radio task. */
    uzb_enqueue_event(&event);
    return false; /* do not consume — preserve join/attr/command stack paths */
}

"""

# mod_uzigbee.c extensions (after command overlay)
MOD_ROOT_OLD = """MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_signal_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_attr_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_command_callback); /* """ + CMD_MARKER + """ */
"""

MOD_ROOT_NEW = """MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_signal_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_attr_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_command_callback); /* """ + CMD_MARKER + """ */
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_aps_callback); /* """ + MARKER + """ */
"""

MOD_GET_CMD_OLD = """static mp_obj_t uzigbee_get_command_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_command_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}
"""

MOD_GET_CMD_NEW = """static mp_obj_t uzigbee_get_command_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_command_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}

/* """ + MARKER + """ */
static mp_obj_t uzigbee_get_aps_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_aps_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}
"""

MOD_ON_CMD_OLD = """static mp_obj_t uzigbee_on_command(mp_obj_t callback_in) {
    return uzigbee_set_command_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_command_obj, uzigbee_on_command);

static mp_obj_t uzigbee_is_started(void) {
    return mp_obj_new_bool(uzb_core_is_started());
}
static MP_DEFINE_CONST_FUN_OBJ_0(uzigbee_is_started_obj, uzigbee_is_started);
"""

MOD_ON_CMD_NEW = """static mp_obj_t uzigbee_on_command(mp_obj_t callback_in) {
    return uzigbee_set_command_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_command_obj, uzigbee_on_command);

static mp_obj_t uzigbee_is_started(void) {
    return mp_obj_new_bool(uzb_core_is_started());
}
static MP_DEFINE_CONST_FUN_OBJ_0(uzigbee_is_started_obj, uzigbee_is_started);

/* """ + MARKER + """ */
static mp_obj_t uzigbee_set_aps_callback(mp_obj_t callback_in) {
    if (callback_in != mp_const_none && !mp_obj_is_callable(callback_in)) {
        mp_raise_ValueError(MP_ERROR_TEXT("callback must be callable or None"));
    }
    MP_STATE_PORT(uzigbee_aps_callback) = callback_in;
    return mp_const_none;
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_set_aps_callback_obj, uzigbee_set_aps_callback);

static mp_obj_t uzigbee_on_aps(mp_obj_t callback_in) {
    return uzigbee_set_aps_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_aps_obj, uzigbee_on_aps);
"""

MOD_DISPATCH_OLD = """    mp_obj_t cmd_cb = uzigbee_get_command_callback(); /* """ + CMD_MARKER + """ */
    while (uzb_core_pop_event(&event)) {
"""

MOD_DISPATCH_NEW = """    mp_obj_t cmd_cb = uzigbee_get_command_callback(); /* """ + CMD_MARKER + """ */
    mp_obj_t aps_cb = uzigbee_get_aps_callback(); /* """ + MARKER + """ */
    while (uzb_core_pop_event(&event)) {
"""

# Insert APS dispatch branch before closing of while + dispatch_complete
MOD_DISPATCH_CMD_END = """            if (!uzigbee_call_callback(cmd_cb, 9, args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        }
    }

    uzb_core_dispatch_complete();
    return mp_const_none;
}
"""

MOD_DISPATCH_APS_INSERT = """            if (!uzigbee_call_callback(cmd_cb, 9, args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        } else if (event.type == UZB_EVENT_TYPE_APS) {
            /* """ + MARKER + """: (src_short, src_ep, dst_ep, profile, cluster, status, asdu, asdu_len, asdu_len_orig, truncated) */
            if (aps_cb == mp_const_none) {
                continue;
            }
            mp_obj_t asdu_obj = mp_obj_new_bytes(event.data.aps.asdu, event.data.aps.asdu_len);
            mp_obj_t args[10] = {
                mp_obj_new_int_from_uint(event.data.aps.src_short_addr),
                mp_obj_new_int_from_uint(event.data.aps.src_endpoint),
                mp_obj_new_int_from_uint(event.data.aps.dst_endpoint),
                mp_obj_new_int_from_uint(event.data.aps.profile_id),
                mp_obj_new_int_from_uint(event.data.aps.cluster_id),
                mp_obj_new_int(event.data.aps.status),
                asdu_obj,
                mp_obj_new_int_from_uint(event.data.aps.asdu_len),
                mp_obj_new_int_from_uint(event.data.aps.asdu_len_orig),
                mp_obj_new_bool(event.data.aps.truncated),
            };
            mp_obj_t callback_exc = mp_const_none;
            if (!uzigbee_call_callback(aps_cb, 10, args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        }
    }

    uzb_core_dispatch_complete();
    return mp_const_none;
}
"""

MOD_TABLE_OLD = """    { MP_ROM_QSTR(MP_QSTR_on_command), MP_ROM_PTR(&uzigbee_on_command_obj) }, /* """ + CMD_MARKER + """ */
    { MP_ROM_QSTR(MP_QSTR_set_command_callback), MP_ROM_PTR(&uzigbee_set_command_callback_obj) },
    { MP_ROM_QSTR(MP_QSTR_is_started), MP_ROM_PTR(&uzigbee_is_started_obj) },
"""

MOD_TABLE_NEW = """    { MP_ROM_QSTR(MP_QSTR_on_command), MP_ROM_PTR(&uzigbee_on_command_obj) }, /* """ + CMD_MARKER + """ */
    { MP_ROM_QSTR(MP_QSTR_set_command_callback), MP_ROM_PTR(&uzigbee_set_command_callback_obj) },
    { MP_ROM_QSTR(MP_QSTR_is_started), MP_ROM_PTR(&uzigbee_is_started_obj) },
    { MP_ROM_QSTR(MP_QSTR_on_aps), MP_ROM_PTR(&uzigbee_on_aps_obj) }, /* """ + MARKER + """ */
    { MP_ROM_QSTR(MP_QSTR_set_aps_callback), MP_ROM_PTR(&uzigbee_set_aps_callback_obj) },
"""


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if MARKER in text and old not in text:
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
    if CMD_MARKER not in h and "UZB_EVENT_TYPE_CMD" not in h:
        raise SystemExit("APS overlay requires apply_uzb_command_capture.py first")
    if MARKER not in h:
        h = must_replace(h, UZB_CORE_H_EVENT_OLD, UZB_CORE_H_EVENT_NEW, "uzb_core.h APS event")
        core_h.write_text(h, encoding="utf-8")
        print("[OK] overlay uzb_core.h APS event")
    else:
        print("[INFO] uzb_core.h APS already overlaid")

    c = core_c.read_text(encoding="utf-8")
    if "aps/esp_zigbee_aps.h" not in c:
        raise SystemExit(
            "API blocker: uzb_core.c missing #include \"aps/esp_zigbee_aps.h\" — "
            "cannot register esp_zb_aps_data_indication_handler_register"
        )
    if MARKER not in c:
        if UZB_ACTION_ANCHOR not in c:
            raise SystemExit("overlay miss: cmd-capture action handler anchor")
        c = c.replace(UZB_ACTION_ANCHOR, UZB_APS_HANDLER_BLOCK + UZB_ACTION_ANCHOR, 1)
        c = must_replace(c, UZB_START_COMMIT_OLD, UZB_START_COMMIT_NEW, "uzb_core.c APS register before start")
        core_c.write_text(c, encoding="utf-8")
        print("[OK] overlay uzb_core.c APS indication handler")
    else:
        print("[INFO] uzb_core.c APS already overlaid")

    m = mod_c.read_text(encoding="utf-8")
    if MARKER not in m:
        m = must_replace(m, MOD_ROOT_OLD, MOD_ROOT_NEW, "mod APS root pointer")
        m = must_replace(m, MOD_GET_CMD_OLD, MOD_GET_CMD_NEW, "mod get aps cb")
        m = must_replace(m, MOD_ON_CMD_OLD, MOD_ON_CMD_NEW, "mod on_aps")
        m = must_replace(m, MOD_DISPATCH_OLD, MOD_DISPATCH_NEW, "mod dispatch aps_cb")
        m = must_replace(m, MOD_DISPATCH_CMD_END, MOD_DISPATCH_APS_INSERT, "mod dispatch APS branch")
        m = must_replace(m, MOD_TABLE_OLD, MOD_TABLE_NEW, "mod export on_aps")
        mod_c.write_text(m, encoding="utf-8")
        print("[OK] overlay mod_uzigbee.c on_aps")
    else:
        print("[INFO] mod_uzigbee.c APS already overlaid")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
