import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOARD_PROFILE_IDS,
  CAPABILITY_STATUS,
  LAB_BOARD_TYPE_SENTINEL,
  LAB_BOARD_GROUP_LABEL,
  LAB_BOARD_PICKER_LABELS,
  LEGACY_BOARD_PICKER_VALUES,
  listLabBoardPickerOptions,
  parseBoardPickerValue,
  applyLabBoardSelection,
  clearLabBoardSelection,
  resolveBoardPickerSelectValue,
  isLabProfileRuntimeReady,
  getBoardProfile,
  getCapability,
  resolveFirmwareTarget,
  hasFlashableFirmwareImage,
  canOfferFirmwareFlash,
  listUsablePythonModules,
  describePythonModuleAvailability,
  resolveLabRuntimeContext,
  connectLabBoard,
  flashLabFirmware,
  executeLabProgram,
  Esp32UniversalLabNotReadyError,
  Esp32UniversalLabNotActiveError,
  ESP32_GENERIC_C6_FIRMWARE,
  shouldUseLegacyHardwarePath,
  LEGACY_BOARD_TYPES,
  C6_BOARD_MODULES,
} from "../src/esp32UniversalLab/index.js";
import { loadAndValidateC6Firmware } from "../src/esp32UniversalLab/runtime/c6Flasher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function clearLabOverrides() {
  delete globalThis.__PYBOT_ESP32_LAB_ENABLED__;
  delete globalThis.__PYBOT_ESP32_LAB_PROFILE__;
  clearLabBoardSelection();
}

test("AC2: board picker lists exact commercial labels separated from legacy", () => {
  const opts = listLabBoardPickerOptions();
  assert.equal(opts.length, 3);
  assert.equal(
    LAB_BOARD_PICKER_LABELS[BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147],
    "Waveshare ESP32-C6-LCD-1.47",
  );
  assert.equal(
    LAB_BOARD_PICKER_LABELS[BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154],
    "ESP32-S3-Touch-LCD-1.54",
  );
  assert.equal(
    LAB_BOARD_PICKER_LABELS[BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7],
    "ESP32-S3-Touch-LCD-7",
  );
  assert.match(LAB_BOARD_GROUP_LABEL, /Waveshare/);

  const c6 = opts.find(
    (o) => o.profileId === BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147,
  );
  const s154 = opts.find(
    (o) => o.profileId === BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );
  const s7 = opts.find(
    (o) => o.profileId === BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7,
  );
  assert.equal(c6.label, "Waveshare ESP32-C6-LCD-1.47");
  assert.equal(c6.displayLabel, "Waveshare ESP32-C6-LCD-1.47");
  assert.equal(c6.runtimeReady, true);
  assert.match(s154.displayLabel, /not ready/i);
  assert.match(s7.displayLabel, /not ready/i);
  assert.equal(s154.runtimeReady, false);
  assert.equal(s7.runtimeReady, false);

  // Legacy values unchanged
  assert.deepEqual([...LEGACY_BOARD_PICKER_VALUES], [
    "arduino-firmata",
    "esp32-micropython",
    "esp32-eda6",
  ]);
});

test("AC2/AC3: selecting S3 enables profile but refuses connect/program", async () => {
  clearLabOverrides();
  const applied = applyLabBoardSelection(
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );
  assert.equal(applied.boardType, LAB_BOARD_TYPE_SENTINEL);
  assert.equal(applied.runtimeReady, false);
  assert.equal(isLabProfileRuntimeReady(applied.profileId), false);

  await assert.rejects(
    () => connectLabBoard(LAB_BOARD_TYPE_SENTINEL),
    (err) =>
      err instanceof Esp32UniversalLabNotReadyError &&
      err.operation === "connect",
  );
  await assert.rejects(
    () => executeLabProgram("print(1)", LAB_BOARD_TYPE_SENTINEL),
    (err) =>
      err instanceof Esp32UniversalLabNotReadyError &&
      err.operation === "execute",
  );
  clearLabOverrides();
});

test("profile switching + legacy isolation before/after", () => {
  clearLabOverrides();
  applyLabBoardSelection(BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147);
  assert.equal(
    resolveBoardPickerSelectValue(
      LAB_BOARD_TYPE_SENTINEL,
      BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147,
    ),
    `esp32-universal-lab:${BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147}`,
  );
  for (const legacy of LEGACY_BOARD_TYPES) {
    assert.equal(shouldUseLegacyHardwarePath(legacy), true);
    assert.equal(resolveLabRuntimeContext(legacy).active, false);
  }
  assert.equal(resolveLabRuntimeContext(LAB_BOARD_TYPE_SENTINEL).active, true);
  assert.equal(
    resolveLabRuntimeContext(LAB_BOARD_TYPE_SENTINEL).runtimeReady,
    true,
  );

  // Switch back to legacy
  const parsed = parseBoardPickerValue("esp32-micropython");
  assert.equal(parsed.kind, "legacy");
  clearLabBoardSelection();
  assert.equal(shouldUseLegacyHardwarePath("esp32-micropython"), true);
  assert.equal(resolveLabRuntimeContext(LAB_BOARD_TYPE_SENTINEL).active, false);
  clearLabOverrides();
});

test("AC5: C6 firmware URL/sha/version real and vendored; SHA matches file", async () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const target = resolveFirmwareTarget(c6Id);
  assert.equal(target.status, CAPABILITY_STATUS.IMPLEMENTED);
  assert.equal(target.version, "1.27.0");
  assert.equal(target.imageId, "ESP32_GENERIC_C6");
  assert.equal(
    target.imageSha256,
    "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
  );
  assert.equal(hasFlashableFirmwareImage(c6Id), true);
  assert.equal(canOfferFirmwareFlash(c6Id), true);

  const binPath = join(
    root,
    "public/firmware/micropython",
    ESP32_GENERIC_C6_FIRMWARE.filename,
  );
  assert.equal(existsSync(binPath), true);
  const bytes = readFileSync(binPath);
  assert.equal(bytes.length, ESP32_GENERIC_C6_FIRMWARE.size);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha, ESP32_GENERIC_C6_FIRMWARE.sha256);

  const validated = await loadAndValidateC6Firmware(ESP32_GENERIC_C6_FIRMWARE, {
    fetchImpl: async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    }),
  });
  assert.equal(validated.sha256, ESP32_GENERIC_C6_FIRMWARE.sha256);

  // S3 must not offer flash
  assert.equal(
    canOfferFirmwareFlash(BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154),
    false,
  );
  assert.equal(
    canOfferFirmwareFlash(BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7),
    false,
  );
});

test("AC9/AC10: C6 Python API exposes only IMPLEMENTED modules; Zigbee NOT VERIFIED", () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const usable = listUsablePythonModules(c6Id);
  assert.ok(usable.includes("pybot.gpio"));
  assert.ok(usable.includes("pybot.wifi"));
  assert.ok(usable.includes("pybot.bluetooth"));
  assert.ok(usable.includes("pybot.display"));
  assert.ok(!usable.includes("pybot.zigbee"));
  assert.ok(!usable.includes("pybot.touch"));

  const zig = describePythonModuleAvailability(c6Id, "pybot.zigbee");
  assert.equal(zig.status, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(zig.usable, false);

  const zigCap = getCapability(c6Id, "zigbee");
  assert.match(zigCap.note ?? "", /NOT VERIFIED|UNSUPPORTED/i);

  const thread = getCapability(c6Id, "thread");
  assert.equal(thread.status, CAPABILITY_STATUS.UNSUPPORTED);
  assert.match(thread.note ?? "", /NOT VERIFIED|UNSUPPORTED/i);

  const profile = getBoardProfile(c6Id);
  assert.equal(profile.hardwareValidation, "UNVERIFIED");
  assert.equal(profile.firmware.hardwareValidation, "UNVERIFIED");

  assert.ok(C6_BOARD_MODULES["pybot/gpio.py"].includes("AVAILABLE_GPIO"));
  assert.ok(C6_BOARD_MODULES["pybot/display.py"].includes("ST7789"));
});

test("AC6: getBoardType recognizes lab sentinel without remapping legacy", () => {
  // Avoid importing hardwareBridge in Node (pulls Vite ?raw EDA6). Assert additive source contract.
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  assert.match(
    bridge,
    /if \(v === "esp32-universal-lab"\) return "esp32-universal-lab";/,
  );
  assert.match(bridge, /PYBOT_LAB:USE_LAB_RUNTIME/);
  // Legacy branches remain intact
  assert.match(bridge, /if \(v === "esp32-micropython"\) return "esp32-micropython";/);
  assert.match(bridge, /if \(v === "esp32-eda6"\) return "esp32-eda6";/);
  assert.match(bridge, /return "arduino-firmata";/);
});

test("AC2 UI: PyBotIDE board picker wires commercial options and legacy labels", () => {
  const ide = readFileSync(join(root, "src/PyBotIDE.jsx"), "utf8");
  assert.match(ide, /data-testid="ide-board-picker"/);
  assert.match(ide, /listLabBoardPickerOptions/);
  assert.match(ide, /LAB_BOARD_GROUP_LABEL/);
  assert.match(ide, /boardArduino/);
  assert.match(ide, /boardEsp32Mp/);
  assert.match(ide, /boardEsp32Eda6/);
  assert.match(ide, /lab-not-ready-hint/);
  assert.match(ide, /connectLabBoard/);
  assert.match(ide, /flashLabFirmware/);
  // Legacy prepare path still gated to classic ESP32 types only
  assert.match(
    ide,
    /showPrepareEsp32=\{boardType === "esp32-micropython" \|\| boardType === "esp32-eda6"\}/,
  );
});

test("flash refuses when lab inactive; S3 flash not ready", async () => {
  clearLabOverrides();
  await assert.rejects(
    () => flashLabFirmware(LAB_BOARD_TYPE_SENTINEL),
    (err) => err instanceof Esp32UniversalLabNotActiveError,
  );

  applyLabBoardSelection(BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7);
  await assert.rejects(
    () => flashLabFirmware(LAB_BOARD_TYPE_SENTINEL),
    (err) =>
      err instanceof Esp32UniversalLabNotReadyError && err.operation === "flash",
  );
  clearLabOverrides();
});

test("AC12: no .github/workflows changes", () => {
  assert.equal(existsSync(join(root, ".github/workflows")), false);
});
