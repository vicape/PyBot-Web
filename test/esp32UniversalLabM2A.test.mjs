/**
 * M2A focused tests: Zigbee coordinator protocol, manifest/hash safety,
 * firmware mode boundaries. Does not claim physical radio pairing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_STATUS,
  BOARD_PROFILE_IDS,
  getCapability,
  listUsablePythonModules,
  describePythonModuleAvailability,
  getBoardProfile,
  ESP32_GENERIC_C6_FIRMWARE,
  ZB_PROTOCOL_VERSION,
  ZB_FW_ID,
  ZB_HOST_COMMANDS,
  encodeZbHostCommand,
  decodeZbEvent,
  buildZbBaselineControlSequence,
  isValidDeviceJoinEvent,
  ZIGBEE_COORDINATOR_MANIFEST_PATH,
  ZIGBEE_COORDINATOR_PROJECT_DIR,
  ZIGBEE_COORDINATOR_MANIFEST,
  loadZigbeeCoordinatorManifest,
  isZigbeeCoordinatorSourcePresent,
  resolveZigbeeCoordinatorArtifact,
  describeZigbeeCoordinatorReadiness,
  C6_FIRMWARE_MODE_MICROPYTHON,
  C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR,
  getDefaultC6FirmwareMode,
  getC6FirmwareRuntimeMode,
  setC6FirmwareRuntimeMode,
  clearC6FirmwareRuntimeMode,
  canSelectZigbeeCoordinatorMode,
  canOfferZigbeeCoordinatorFlash,
  canOfferMicroPythonRestoreFlash,
  listC6FirmwareModeDescriptors,
  resolveC6RuntimePathBoundary,
  assertZigbeeFlashExplicitOptIn,
  getC6FirmwareModeSnapshot,
} from "../src/esp32UniversalLab/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fwRoot = join(root, ZIGBEE_COORDINATOR_PROJECT_DIR);

test("M2A: native Zigbee coordinator source tree and partition map exist", () => {
  assert.equal(isZigbeeCoordinatorSourcePresent(), true);
  assert.ok(existsSync(join(fwRoot, "main/zb_coord_main.c")));
  assert.ok(existsSync(join(fwRoot, "main/zb_host_proto.c")));
  assert.ok(existsSync(join(fwRoot, "partitions.csv")));
  assert.ok(existsSync(join(fwRoot, "sdkconfig.defaults")));
  assert.ok(existsSync(join(fwRoot, "build.sh")));
  assert.ok(existsSync(join(fwRoot, "host/pybot_zb_control.py")));
  assert.ok(existsSync(join(fwRoot, "manifest.json")));
  assert.ok(existsSync(join(root, "docs/ESP32_UNIVERSAL_LAB_M2A.md")));

  const parts = readFileSync(join(fwRoot, "partitions.csv"), "utf8");
  assert.match(parts, /factory/);
  assert.match(parts, /nvs/);

  const yml = readFileSync(join(fwRoot, "main/idf_component.yml"), "utf8");
  assert.match(yml, /esp-zigbee-lib/);
  assert.match(yml, /5\.5\.4/);

  const main = readFileSync(join(fwRoot, "main/zb_coord_main.c"), "utf8");
  const hdr = readFileSync(join(fwRoot, "main/zb_coord.h"), "utf8");
  assert.match(hdr, /EZB_NWK_DEVICE_TYPE_COORDINATOR/);
  assert.match(hdr, /PYBOT_ZB_ZC_CONFIG/);
  assert.match(main, /ezb_bdb_open_network/);
  assert.match(main, /EZB_ZDO_SIGNAL_DEVICE_ANNCE/);
  assert.match(main, /ezb_zcl_on_off_on_cmd_req/);
  assert.match(main, /ezb_zcl_read_attr_cmd_req/);
  assert.doesNotMatch(main, /mock.?radio|fake.?802\.15/i);
});

test("M2A: JSON manifest mirrors JS manifest on critical fields; artifact not invented", () => {
  const disk = JSON.parse(
    readFileSync(join(root, ZIGBEE_COORDINATOR_MANIFEST_PATH), "utf8"),
  );
  const js = loadZigbeeCoordinatorManifest();
  assert.equal(js.id, disk.id);
  assert.equal(js.firmwareVersion, disk.firmwareVersion);
  assert.equal(js.toolchain.espIdf, "v5.5.4");
  assert.equal(disk.toolchain.espIdf, "v5.5.4");
  assert.equal(js.coexistence.micropythonSameImage, false);
  assert.equal(disk.autoFlash, false);
  assert.equal(js.autoFlash, false);

  const art = resolveZigbeeCoordinatorArtifact(js);
  assert.equal(art.status, "BLOCKED");
  assert.equal(art.sha256, null);
  assert.equal(art.autoFlash, false);
  assert.match(art.blockReason ?? "", /ESP-IDF|toolchain|binary/i);

  // READY without real sha must not pass
  const fakeReady = {
    ...ZIGBEE_COORDINATOR_MANIFEST,
    artifact: {
      status: "READY",
      sha256: "not-a-real-hash",
      filename: "nope.bin",
    },
  };
  assert.equal(resolveZigbeeCoordinatorArtifact(fakeReady).status, "BLOCKED");
});

test("M2A: host protocol encode/decode and baseline control sequence", () => {
  assert.equal(ZB_PROTOCOL_VERSION, 1);
  assert.equal(ZB_FW_ID, "pybot-zb-coord");
  assert.ok(ZB_HOST_COMMANDS.includes("permit_join"));
  assert.ok(ZB_HOST_COMMANDS.includes("zcl_onoff"));

  assert.equal(encodeZbHostCommand("ping"), '{"cmd":"ping"}');
  assert.equal(
    encodeZbHostCommand("permit_join", { timeout_s: 60 }),
    '{"cmd":"permit_join","timeout_s":60}',
  );
  assert.throws(() => encodeZbHostCommand("permit_join", { timeout_s: 999 }));
  assert.throws(() => encodeZbHostCommand("zcl_onoff", { short: 1, action: "nope" }));

  const on = JSON.parse(
    encodeZbHostCommand("zcl_onoff", {
      short: 0x1234,
      endpoint: 1,
      action: "on",
    }),
  );
  assert.equal(on.cmd, "zcl_onoff");
  assert.equal(on.short, 0x1234);
  assert.equal(on.action, "on");

  const evt = decodeZbEvent(
    '{"evt":"device_joined","short":4660,"ieee":"0x00124b0012345678","endpoints":[1]}',
  );
  assert.equal(isValidDeviceJoinEvent(evt), true);
  assert.equal(
    isValidDeviceJoinEvent({ evt: "device_joined", short: 1, ieee: "bad" }),
    false,
  );

  const seq = buildZbBaselineControlSequence();
  assert.ok(seq.length >= 5);
  assert.ok(seq.every((line) => line.includes('"cmd"')));
});

test("M2A: firmware modes — MicroPython default; Zigbee gated; no auto-flash", () => {
  clearC6FirmwareRuntimeMode();
  assert.equal(getDefaultC6FirmwareMode(), C6_FIRMWARE_MODE_MICROPYTHON);
  assert.equal(getC6FirmwareRuntimeMode(), C6_FIRMWARE_MODE_MICROPYTHON);
  assert.equal(canSelectZigbeeCoordinatorMode(), false);
  assert.equal(canOfferZigbeeCoordinatorFlash(), false);
  assert.equal(canOfferMicroPythonRestoreFlash(), true);

  assert.throws(() => setC6FirmwareRuntimeMode(C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR));

  const modes = listC6FirmwareModeDescriptors();
  assert.equal(modes.length, 2);
  assert.equal(modes[0].id, C6_FIRMWARE_MODE_MICROPYTHON);
  assert.equal(modes[0].selectable, true);
  assert.equal(modes[1].id, C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR);
  assert.equal(modes[1].selectable, false);
  assert.equal(modes[1].autoFlash, false);
  assert.match(modes[1].warning, /ERASES MicroPython/i);

  const gate = assertZigbeeFlashExplicitOptIn({
    explicitOptIn: true,
    acknowledgeErasesMicroPython: true,
  });
  assert.equal(gate.allowed, false);

  const boundary = resolveC6RuntimePathBoundary();
  assert.equal(boundary.micropythonPath, true);
  assert.equal(boundary.zigbeeControlPath, false);
  assert.equal(boundary.connectedClaim, "micropython");

  const snap = getC6FirmwareModeSnapshot();
  assert.equal(snap.zigbee.micropythonCoexist, false);
  assert.equal(snap.zigbee.artifact.status, "BLOCKED");
});

test("M2A: C6 capability — Zigbee UNVERIFIED (not usable via MicroPython); Thread UNSUPPORTED; S3 untouched", () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const zig = getCapability(c6Id, "zigbee");
  assert.equal(zig.status, CAPABILITY_STATUS.UNVERIFIED);
  assert.equal(zig.usable, false);
  assert.ok(!listUsablePythonModules(c6Id).includes("pybot.zigbee"));
  assert.equal(describePythonModuleAvailability(c6Id, "pybot.zigbee").usable, false);

  const thread = getCapability(c6Id, "thread");
  assert.equal(thread.status, CAPABILITY_STATUS.UNSUPPORTED);

  const profile = getBoardProfile(c6Id);
  assert.equal(profile.runtimeReady, true);
  assert.equal(profile.firmware.imageId, "ESP32_GENERIC_C6");
  assert.equal(profile.firmware.imageSha256, ESP32_GENERIC_C6_FIRMWARE.sha256);

  // S3 profiles unchanged
  const s154 = getBoardProfile(
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );
  assert.equal(s154.runtimeReady, false);
  assert.equal(getCapability(s154.id, "zigbee").status, CAPABILITY_STATUS.UNSUPPORTED);
});

test("M2A: MicroPython binary and C6 install paths remain intact", () => {
  const mp = join(
    root,
    "public/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
  );
  assert.ok(existsSync(mp), "stock MicroPython C6 binary must remain");
  assert.equal(
    ESP32_GENERIC_C6_FIRMWARE.sha256,
    "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
  );
  const readiness = describeZigbeeCoordinatorReadiness();
  assert.equal(
    readiness.restoreMicroPython.sha256,
    ESP32_GENERIC_C6_FIRMWARE.sha256,
  );
});

test("M2A: build.sh reports BLOCKED without inventing binary when idf missing", async () => {
  const buildSh = readFileSync(join(fwRoot, "build.sh"), "utf8");
  assert.match(buildSh, /BLOCKED/);
  assert.match(buildSh, /idf\.py/);
  assert.match(buildSh, /sha256sum|sha256/);
  // No pre-baked READY binary committed; BLOCKED status file from local smoke is OK
  const artifactDir = join(fwRoot, "build-artifact");
  if (existsSync(artifactDir)) {
    const { readdirSync } = await import("node:fs");
    const bins = readdirSync(artifactDir).filter((n) => n.endsWith(".bin"));
    assert.equal(bins.length, 0, "must not invent/commit a Zigbee .bin without real build");
  }
});

test("M2A: no workflow edits in this slice", async () => {
  const wf = join(root, ".github/workflows");
  if (!existsSync(wf)) return;
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(wf)) {
    const text = readFileSync(join(wf, name), "utf8");
    assert.doesNotMatch(text, /zigbee-coordinator.*auto.?flash/i);
  }
});
