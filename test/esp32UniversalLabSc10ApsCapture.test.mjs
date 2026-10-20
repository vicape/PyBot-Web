/**
 * Narrow PRE_QA: ESP32-C6 APS 0xEF00 capture overlay + TS0021 DP decoder.
 * Does not claim physical KEY1/KEY2 hardware PASS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ZIGBEE_PY_SOURCE } from "../src/esp32UniversalLab/pythonApi/zigbeePySource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fwRoot = join(root, "firmware/pybot-c6-micropython-zigbee");

test("APS: overlay uses SDK 1.6.8 by-value indication signature", () => {
  const overlay = readFileSync(join(fwRoot, "overlays/apply_uzb_aps_capture.py"), "utf8");
  assert.match(overlay, /esp_zb_aps_data_indication_handler_register/);
  assert.match(overlay, /esp_zb_apsde_data_ind_t ind/);
  assert.match(overlay, /BY VALUE|by-value|by value/i);
  assert.match(overlay, /return false/);
  assert.match(overlay, /UZB_APS_ASDU_MAX/);
  assert.match(overlay, /UZB_EVENT_TYPE_APS/);
  assert.match(overlay, /uzigbee_on_aps/);
  assert.match(overlay, /0xEF00/);
  assert.match(overlay, /0x0104/);
  assert.doesNotMatch(overlay, /esp_zb_apsde_data_ind_t\s*\*/); // not v2 pointer API
  // Must not blindly lift add_custom_cluster 0xFC00 gate
  assert.doesNotMatch(overlay, /uzb_valid_custom_cluster_id/);

  const buildSh = readFileSync(join(fwRoot, "build.sh"), "utf8");
  assert.match(buildSh, /apply_uzb_aps_capture\.py/);
  assert.match(buildSh, /apply_uzb_command_capture\.py/);

  const readme = readFileSync(join(fwRoot, "overlays/README.md"), "utf8");
  assert.match(readme, /apply_uzb_aps_capture/);
  assert.match(readme, /1\.6\.8/);
});

test("APS: pybot.zigbee exposes on_aps, kind=aps/button, rejects 0xEF00 custom cluster", () => {
  const onboard = readFileSync(join(fwRoot, "onboard/pybot_zigbee.py"), "utf8");
  assert.equal(onboard, ZIGBEE_PY_SOURCE);
  assert.match(onboard, /def enable_aps_capture/);
  assert.match(onboard, /def on_aps/);
  assert.match(onboard, /def on_button/);
  assert.match(onboard, /_push_event\("aps"/);
  assert.match(onboard, /_push_event\("button"/);
  assert.match(onboard, /decode_ts0021_button_from_aps/);
  assert.match(onboard, /parse_zcl_header/);
  assert.match(onboard, /parse_tuya_dp_payload/);
  assert.match(onboard, /CLUSTER_TUYA_EF00 = 0xEF00/);
  assert.match(onboard, /add_custom_cluster\(0xEF00\) is invalid/);
  assert.match(onboard, /tuya_configure_magic_packet_unsupported/);
  assert.match(onboard, /UNVERIFIED TS0021/);
  assert.doesNotMatch(onboard, /fabricat.*button.*join/i);
});

test("APS: sc10_lcd_capture never registers 0xEF00 custom cluster; shows APS hex", () => {
  const script = readFileSync(join(fwRoot, "onboard/sc10_lcd_capture.py"), "utf8");
  assert.match(script, /enable_aps_capture/);
  assert.match(script, /listening APS|APS %s/);
  assert.match(script, /kind == ["']aps["']/);
  assert.match(script, /kind == ["']button["']/);
  assert.match(script, /KEY1/);
  assert.match(script, /KEY2/);
  assert.match(script, /PERMIT_JOIN_ON_BOOT = False/);
  assert.match(script, /signal-only \(not a button\)/);
  assert.doesNotMatch(script, /\.add_custom_cluster\s*\(/);
  assert.doesNotMatch(script, /enable_command_capture\(\s*custom_clusters/);
  assert.doesNotMatch(script, /SC10_CUSTOM_CLUSTER/);
});

test("APS: overlay apply on stub C sources (compile-signature + bounded queue symbols)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "uzb-aps-"));
  try {
    const cdir = join(tmp, "c_module");
    mkdirSync(cdir);
    // Minimal stubs matching upstream shapes after command-capture overlay
    const cmdOverlay = readFileSync(join(fwRoot, "overlays/apply_uzb_command_capture.py"), "utf8");
    // Pull expected OLD snippets by applying cmd overlay to pristine-like stubs
    writeFileSync(
      join(cdir, "uzb_core.h"),
      `typedef enum {
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
`,
    );
    writeFileSync(
      join(cdir, "uzb_core.c"),
      `#include "aps/esp_zigbee_aps.h"
static esp_err_t uzb_action_handler(esp_zb_core_action_callback_id_t callback_id, const void *message) {
    if (callback_id == ESP_ZB_CORE_SET_ATTR_VALUE_CB_ID) {
        uzb_enqueue_attr_set_event((const esp_zb_zcl_set_attr_value_message_t *)message);
    } else if (callback_id == ESP_ZB_CORE_REPORT_ATTR_CB_ID) {
        uzb_enqueue_report_attr_event((const esp_zb_zcl_report_attr_message_t *)message);
    }
    return ESP_OK;
}

    if (s_device_registered && !s_device_register_committed) {
        if (s_registered_ep_list == NULL) {
            err = ESP_ERR_INVALID_STATE;
        } else {
            err = esp_zb_device_register(s_registered_ep_list);
            if (err == ESP_OK && !s_action_handler_registered) {
                esp_zb_core_action_handler_register(uzb_action_handler);
                s_action_handler_registered = true;
            }
            if (err == ESP_OK) {
                s_registered_ep_list = NULL;
                s_device_register_committed = true;
            }
        }
    }
    if (err == ESP_OK) {
        err = esp_zb_start(false);
    }
`,
    );
    writeFileSync(
      join(cdir, "mod_uzigbee.c"),
      `MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_signal_callback);
MP_REGISTER_ROOT_POINTER(mp_obj_t uzigbee_attr_callback);

static mp_obj_t uzigbee_get_attr_callback(void) {
    mp_obj_t cb = MP_STATE_PORT(uzigbee_attr_callback);
    if (cb == MP_OBJ_NULL) {
        return mp_const_none;
    }
    return cb;
}

static mp_obj_t uzigbee_on_attribute(mp_obj_t callback_in) {
    return uzigbee_set_attribute_callback(callback_in);
}
static MP_DEFINE_CONST_FUN_OBJ_1(uzigbee_on_attribute_obj, uzigbee_on_attribute);

static mp_obj_t uzigbee_dispatch_events(mp_obj_t unused) {
    (void)unused;

    uzb_event_t event;
    mp_obj_t signal_cb = uzigbee_get_signal_callback();
    mp_obj_t attr_cb = uzigbee_get_attr_callback();
    while (uzb_core_pop_event(&event)) {
            if (!uzigbee_call_callback(attr_cb, 6, legacy_args, &callback_exc)) {
                mp_obj_print_exception(&mp_plat_print, callback_exc);
            }
        }
    }

    uzb_core_dispatch_complete();
    return mp_const_none;
}

    { MP_ROM_QSTR(MP_QSTR_on_attribute), MP_ROM_PTR(&uzigbee_on_attribute_obj) },
    { MP_ROM_QSTR(MP_QSTR_set_attribute_callback), MP_ROM_PTR(&uzigbee_set_attribute_callback_obj) },
`,
    );

    let r = spawnSync("python3", [join(fwRoot, "overlays/apply_uzb_command_capture.py"), tmp], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    r = spawnSync("python3", [join(fwRoot, "overlays/apply_uzb_aps_capture.py"), tmp], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const coreC = readFileSync(join(cdir, "uzb_core.c"), "utf8");
    assert.match(coreC, /uzb_aps_indication_handler\(esp_zb_apsde_data_ind_t ind\)/);
    assert.match(coreC, /esp_zb_aps_data_indication_handler_register\(uzb_aps_indication_handler\)/);
    assert.match(coreC, /UZB_EVENT_TYPE_APS/);
    assert.match(coreC, /asdu_len_orig/);
    assert.match(coreC, /truncated/);
    assert.match(coreC, /return false/);

    const coreH = readFileSync(join(cdir, "uzb_core.h"), "utf8");
    assert.match(coreH, /UZB_APS_ASDU_MAX \(64\)/);
    assert.match(coreH, /uzb_aps_event_t/);

    const modC = readFileSync(join(cdir, "mod_uzigbee.c"), "utf8");
    assert.match(modC, /uzigbee_on_aps/);
    assert.match(modC, /UZB_EVENT_TYPE_APS/);
    assert.match(modC, /MP_QSTR_on_aps/);

    // Idempotent re-apply
    r = spawnSync("python3", [join(fwRoot, "overlays/apply_uzb_aps_capture.py"), tmp], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(cmdOverlay.includes("UZB_CMD_PAYLOAD_MAX"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("APS: mocked TS0021 DP1/DP2 decode; no false presses on join/device_update", () => {
  const py = `
import sys
sys.path.insert(0, ${JSON.stringify(join(fwRoot, "onboard"))})
# Import without native _uzigbee
import importlib.util
spec = importlib.util.spec_from_file_location("pybot_zigbee", ${JSON.stringify(join(fwRoot, "onboard/pybot_zigbee.py"))})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# Build sample ActiveStatusReport ASDU: FC manuf-specific, manuf 0x1002, seq, cmd 0x0A,
# then seq_be + DP1 enum single (0)
# FC=0x04 (manuf), manuf LE 0x02 0x10, seq=1, cmd=0x0A
# payload: seq 0x00 0x01, dp=1, type=4, len=0x0001, data=0x00
asdu_btn1 = bytes([0x04, 0x02, 0x10, 0x01, 0x0A, 0x00, 0x01, 0x01, 0x04, 0x00, 0x01, 0x00])
asdu_btn2_double = bytes([0x04, 0x02, 0x10, 0x02, 0x0A, 0x00, 0x02, 0x02, 0x04, 0x00, 0x01, 0x01])

aps1 = {
    "short_addr": 0x6320,
    "src_endpoint": 1,
    "dst_endpoint": 1,
    "profile": 0x0104,
    "cluster": 0xEF00,
    "status": 0,
    "asdu": asdu_btn1,
    "asdu_len": len(asdu_btn1),
    "asdu_len_orig": len(asdu_btn1),
    "truncated": False,
}
b1 = mod.decode_ts0021_button_from_aps(aps1)
assert b1 is not None and b1["key"] == "KEY1" and b1["gesture"] == 0, b1
assert b1["fingerprint_verified"] is False
assert "UNVERIFIED" in b1["model"]

aps2 = dict(aps1)
aps2["asdu"] = asdu_btn2_double
aps2["asdu_len"] = len(asdu_btn2_double)
aps2["asdu_len_orig"] = len(asdu_btn2_double)
b2 = mod.decode_ts0021_button_from_aps(aps2)
assert b2 is not None and b2["key"] == "KEY2" and b2["gesture"] == 1, b2

# Truncated => no invented button
aps_t = dict(aps1)
aps_t["truncated"] = True
assert mod.decode_ts0021_button_from_aps(aps_t) is None

# Wrong cluster => None
aps_w = dict(aps1)
aps_w["cluster"] = 0x0006
assert mod.decode_ts0021_button_from_aps(aps_w) is None

# Simulate native APS callback path into poll_events (no join false-positive)
mod._on_aps(0x6320, 1, 1, 0x0104, 0xEF00, 0, asdu_btn1, len(asdu_btn1), len(asdu_btn1), False)
events = mod.poll_events(16)
kinds = [e["kind"] for e in events]
assert "aps" in kinds, kinds
assert "button" in kinds, kinds
btn_ev = [e for e in events if e["kind"] == "button"][0]
assert btn_ev["payload"]["key"] == "KEY1"

# join / device_update must NOT produce button
mod._on_signal(0x02, 0)  # DEVICE_ANNCE
mod._on_signal(0x30, 0)  # DEVICE_UPDATE
more = mod.poll_events(16)
assert all(e["kind"] != "button" for e in more), more
assert any(e["kind"] == "join" for e in more)
assert any(e["kind"] == "device_update" for e in more)

# enable_command_capture must reject 0xEF00
class N:
    def on_command(self, cb):
        pass
    def add_custom_cluster(self, c, r):
        raise AssertionError("should not reach")
mod._native = N()
mod._command_hooked = False
raised = False
try:
    mod.enable_command_capture(custom_clusters=[(0xEF00, 1)])
except ValueError as e:
    raised = True
    assert "0xEF00" in str(e)
assert raised
print("OK")
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /OK/);
});

test("APS: 0.1.1-sc10-cmd guest bins preserved as rollback baseline", () => {
  const pub = join(root, "public/firmware/c6-zigbee");
  assert.ok(existsSync(join(pub, "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin")));
  assert.ok(existsSync(join(pub, "rollback-0.1.0")));
  assert.ok(existsSync(join(pub, "rollback-0.1.1")));
  const sums = readFileSync(join(pub, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, /0\.1\.1-sc10-cmd-app\.bin/);
  const app = readFileSync(join(pub, "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin"));
  assert.equal(
    createHash("sha256").update(app).digest("hex"),
    "e9dcf6e9dcd09af29a8483584208086e0691a6964d6c85042a785967e0eb67aa",
  );
});

test("APS: 0.1.2-sc10-aps guest bins published with matching SHA256SUMS", () => {
  const pub = join(root, "public/firmware/c6-zigbee");
  const appName = "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-app.bin";
  assert.ok(existsSync(join(pub, appName)));
  assert.ok(existsSync(join(pub, "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-bootloader.bin")));
  assert.ok(existsSync(join(pub, "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-partition-table.bin")));
  const sums = readFileSync(join(pub, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, /0\.1\.2-sc10-aps-app\.bin/);
  assert.match(sums, /f18811848746fcd5ec3c4c44c714033f6dd1ae67cd5c3951376d27571f073ee2/);
  const app = readFileSync(join(pub, appName));
  assert.equal(app.byteLength, 3236944);
  assert.equal(
    createHash("sha256").update(app).digest("hex"),
    "f18811848746fcd5ec3c4c44c714033f6dd1ae67cd5c3951376d27571f073ee2",
  );
  // Native APS capture compiled into image (QSTR), absent from prior 0.1.1
  assert.ok(app.includes(Buffer.from("on_aps")));
  const old = readFileSync(join(pub, "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin"));
  assert.equal(old.includes(Buffer.from("on_aps")), false);
});
