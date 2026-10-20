/**
 * Narrow PRE_QA tests: SC10 ZCL command-capture overlay + pybot.zigbee on_command.
 * Does not claim physical button→LCD PASS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZIGBEE_PY_SOURCE } from "../src/esp32UniversalLab/pythonApi/zigbeePySource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fwRoot = join(root, "firmware/pybot-c6-micropython-zigbee");

test("SC10: command-capture overlay script and build.sh hook present", () => {
  const overlay = readFileSync(
    join(fwRoot, "overlays/apply_uzb_command_capture.py"),
    "utf8",
  );
  assert.match(overlay, /ESP_ZB_CORE_CMD_CUSTOM_CLUSTER_REQ_CB_ID/);
  assert.match(overlay, /ESP_ZB_CORE_CMD_PRIVILEGE_COMMAND_REQ_CB_ID/);
  assert.match(overlay, /ESP_ZB_CORE_CMD_IAS_ZONE_ZONE_STATUS_CHANGE_NOT_ID/);
  assert.match(overlay, /UZB_CMD_PAYLOAD_MAX/);
  assert.match(overlay, /uzigbee_on_command/);
  assert.match(overlay, /is_started/);
  assert.doesNotMatch(overlay, /ESP_ZB_CORE_CMD_MANUF_SPEC/); // v2-only / unverified

  const buildSh = readFileSync(join(fwRoot, "build.sh"), "utf8");
  assert.match(buildSh, /apply_uzb_command_capture\.py/);

  const readme = readFileSync(join(fwRoot, "overlays/README.md"), "utf8");
  assert.match(readme, /0x1040/);
  assert.match(readme, /apply_uzb_command_capture/);
});

test("SC10: pybot.zigbee exposes on_command + poll_events command + OSError259 guard", () => {
  const onboard = readFileSync(join(fwRoot, "onboard/pybot_zigbee.py"), "utf8");
  assert.equal(onboard, ZIGBEE_PY_SOURCE);
  assert.match(onboard, /def on_command/);
  assert.match(onboard, /_push_event\("command"/);
  assert.match(onboard, /CB_CMD_CUSTOM_CLUSTER_REQ = 0x1040/);
  assert.match(onboard, /ESP_ERR_INVALID_STATE = 259/);
  assert.match(onboard, /_native_is_started/);
  assert.match(onboard, /enable_command_capture/);
  assert.doesNotMatch(onboard, /fake button|fabricat.*OnOff.*join/i);
});

test("SC10: LCD capture script never maps join/device_update to buttons", () => {
  const script = readFileSync(join(fwRoot, "onboard/sc10_lcd_capture.py"), "utf8");
  assert.match(script, /PERMIT_JOIN_ON_BOOT = False/);
  assert.match(script, /FORM_NETWORK_ON_BOOT = False/);
  assert.match(script, /signal-only \(not a button\)/);
  assert.match(script, /0xEF00|SC10_CLUSTER_EF00/);
  assert.doesNotMatch(script, /kind == ["']join["'].*KEY/);
  assert.match(script, /OSError 259/);
  // APS path — never add_custom_cluster(0xEF00); KEY labels from validated button events
  assert.match(script, /enable_aps_capture/);
  assert.doesNotMatch(script, /\.add_custom_cluster\s*\(/);
  assert.match(script, /KEY1|btn_seen/);
});

test("SC10: known-working guest installer bins preserved as rollback; new cmd-capture published", () => {
  const pub = join(root, "public/firmware/c6-zigbee");
  const rollback = join(pub, "rollback-0.1.0");
  assert.ok(existsSync(join(rollback, "pybot-c6-micropython-zigbee-0.1.0-app.bin")));
  assert.ok(existsSync(join(pub, "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin")));
  assert.ok(existsSync(join(pub, "SHA256SUMS.txt")));
  const sums = readFileSync(join(pub, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, /pybot-c6-micropython-zigbee-0\.1\.1-sc10-cmd-app\.bin/);
  assert.match(sums, /e9dcf6e9dcd09af29a8483584208086e0691a6964d6c85042a785967e0eb67aa/);
  const oldApp = readFileSync(join(rollback, "pybot-c6-micropython-zigbee-0.1.0-app.bin"));
  assert.equal(
    createHash("sha256").update(oldApp).digest("hex"),
    "d22d48f5c474f327be4b946dfa88af49523606215dda5e74325a5864189ef096",
  );
});
