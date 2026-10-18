import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ESP32_UNIVERSAL_LAB_DEFAULT_ENABLED,
  LAB_STORAGE_KEYS,
  LEGACY_BOARD_TYPES,
  isEsp32UniversalLabEnabled,
  isEsp32UniversalLabActive,
  getEsp32UniversalLabProfileId,
  shouldUseLegacyHardwarePath,
  BOARD_PROFILE_IDS,
  listBoardProfiles,
  getBoardProfile,
  isSupportedBoardProfile,
  getCapability,
  assertCapabilityAvailable,
  CAPABILITY_STATUS,
  resolveFirmwareTarget,
  hasFlashableFirmwareImage,
  LAB_BOARD_TYPE_SENTINEL,
  resolveLabRuntimeContext,
  connectLabBoard,
  flashLabFirmware,
  Esp32UniversalLabNotActiveError,
  Esp32UniversalLabNotReadyError,
  listUsablePythonModules,
  describePythonModuleAvailability,
} from "../src/esp32UniversalLab/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function clearLabOverrides() {
  delete globalThis.__PYBOT_ESP32_LAB_ENABLED__;
  delete globalThis.__PYBOT_ESP32_LAB_PROFILE__;
}

test("feature gate defaults OFF and uses dedicated storage keys", () => {
  clearLabOverrides();
  assert.equal(ESP32_UNIVERSAL_LAB_DEFAULT_ENABLED, false);
  assert.equal(isEsp32UniversalLabEnabled(), false);
  assert.equal(isEsp32UniversalLabActive(), false);
  assert.equal(getEsp32UniversalLabProfileId(), null);
  assert.equal(LAB_STORAGE_KEYS.enabled, "pybot_esp32_lab_enabled");
  assert.equal(LAB_STORAGE_KEYS.profile, "pybot_esp32_lab_profile");
  assert.ok(!Object.values(LAB_STORAGE_KEYS).includes("pybot_board_type"));
});

test("profile switching activates lab only with gate + supported id", () => {
  clearLabOverrides();
  globalThis.__PYBOT_ESP32_LAB_PROFILE__ =
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  assert.equal(isEsp32UniversalLabActive(), false);

  globalThis.__PYBOT_ESP32_LAB_ENABLED__ = true;
  assert.equal(isEsp32UniversalLabEnabled(), true);
  assert.equal(isEsp32UniversalLabActive(), true);
  assert.equal(
    getEsp32UniversalLabProfileId(),
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147,
  );

  globalThis.__PYBOT_ESP32_LAB_PROFILE__ =
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154;
  assert.equal(
    getEsp32UniversalLabProfileId(),
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );

  globalThis.__PYBOT_ESP32_LAB_PROFILE__ = "not-a-real-board";
  assert.equal(isEsp32UniversalLabActive(), true);
  assert.equal(isSupportedBoardProfile("not-a-real-board"), false);
  clearLabOverrides();
});

test("legacy board types keep legacy hardware path even if lab enabled", () => {
  clearLabOverrides();
  globalThis.__PYBOT_ESP32_LAB_ENABLED__ = true;
  globalThis.__PYBOT_ESP32_LAB_PROFILE__ =
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;

  for (const boardType of LEGACY_BOARD_TYPES) {
    assert.equal(
      shouldUseLegacyHardwarePath(boardType),
      true,
      `legacy path required for ${boardType}`,
    );
    const ctx = resolveLabRuntimeContext(boardType);
    assert.equal(ctx.usesLegacyPath, true);
    assert.equal(ctx.active, false);
  }

  assert.equal(shouldUseLegacyHardwarePath(LAB_BOARD_TYPE_SENTINEL), false);
  const labCtx = resolveLabRuntimeContext(LAB_BOARD_TYPE_SENTINEL);
  assert.equal(labCtx.active, true);
  assert.equal(labCtx.usesLegacyPath, false);
  clearLabOverrides();
});

test("three Waveshare commercial profiles with manufacturer pin definitions", () => {
  const profiles = listBoardProfiles();
  assert.equal(profiles.length, 3);

  const c6 = getBoardProfile(BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147);
  assert.equal(c6.chipFamily, "esp32c6");
  assert.equal(c6.display.controller, "ST7789");
  assert.deepEqual(
    [c6.display.width, c6.display.height],
    [172, 320],
  );
  assert.equal(c6.display.pins.mosi, 6);
  assert.equal(c6.display.pins.sclk, 7);
  assert.equal(c6.display.pins.cs, 14);
  assert.equal(c6.display.pins.dc, 15);
  assert.equal(c6.display.pins.rst, 21);
  assert.equal(c6.display.pins.bl, 22);
  assert.equal(c6.peripherals.bootButton.gpio, 9);

  const s154 = getBoardProfile(
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );
  assert.equal(s154.chipFamily, "esp32s3");
  assert.deepEqual([s154.display.width, s154.display.height], [240, 240]);
  assert.equal(s154.touch.controller, "CST816");
  assert.equal(s154.imu.controller, "QMI8658");
  assert.equal(s154.audio.micCodec, "ES7210");
  assert.equal(s154.display.pins.sclk, 38);
  assert.equal(s154.display.pins.mosi, 39);

  const s7 = getBoardProfile(BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7);
  assert.deepEqual([s7.display.width, s7.display.height], [800, 480]);
  assert.equal(s7.touch.controller, "GT911");
  assert.equal(s7.display.pins.de, 5);
  assert.equal(s7.display.pins.vsync, 3);
  assert.equal(s7.display.pins.hsync, 46);
  assert.equal(s7.display.pins.pclk, 7);
  assert.equal(s7.buses.can.tx, 20);
  assert.equal(s7.buses.rs485.tx, 15);
});

test("unsupported capabilities are explicitly detectable; Zigbee/Thread not claimed", () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const zigbee = getCapability(c6Id, "zigbee");
  assert.equal(zigbee.status, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(zigbee.usable, false);
  assert.match(zigbee.note ?? "", /NOT VERIFIED|UNSUPPORTED/i);

  const thread = getCapability(c6Id, "thread");
  assert.equal(thread.status, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(thread.usable, false);

  assert.throws(
    () => assertCapabilityAvailable(c6Id, "zigbee"),
    /not available|UNSUPPORTED/i,
  );

  const s7Can = getCapability(
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7,
    "can",
  );
  assert.equal(s7Can.status, CAPABILITY_STATUS.UNVERIFIED);
  assert.equal(s7Can.usable, false);

  const touchOnC6 = getCapability(c6Id, "touch");
  assert.equal(touchOnC6.status, CAPABILITY_STATUS.UNSUPPORTED);
});

test("firmware targeting is profile-driven (C6 image arrives in M1)", () => {
  const c6 = resolveFirmwareTarget(BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147);
  assert.equal(c6.target, "esp32c6");
  // M1 registers official MicroPython C6 image; M0 schema still applies.
  assert.ok(
    c6.status === CAPABILITY_STATUS.IMPLEMENTED ||
      c6.status === CAPABILITY_STATUS.PLANNED,
  );

  const unknown = resolveFirmwareTarget("nope");
  assert.equal(unknown.status, CAPABILITY_STATUS.UNSUPPORTED);

  const s3 = resolveFirmwareTarget(
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154,
  );
  assert.equal(hasFlashableFirmwareImage(s3.profileId), false);
});

test("isolated adapter refuses when inactive; legacy board never activates lab", async () => {
  clearLabOverrides();
  await assert.rejects(
    () => connectLabBoard(LAB_BOARD_TYPE_SENTINEL),
    (err) => err instanceof Esp32UniversalLabNotActiveError,
  );

  // Legacy board type must not activate lab transport even if gate+profile set
  globalThis.__PYBOT_ESP32_LAB_ENABLED__ = true;
  globalThis.__PYBOT_ESP32_LAB_PROFILE__ =
    BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  await assert.rejects(
    () => connectLabBoard("esp32-micropython"),
    (err) => err instanceof Esp32UniversalLabNotActiveError,
  );
  clearLabOverrides();
});

test("Python API never exposes Zigbee; unimplemented modules stay unusable", () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const zig = describePythonModuleAvailability(c6Id, "pybot.zigbee");
  assert.equal(zig.status, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(zig.usable, false);
  const touch = describePythonModuleAvailability(c6Id, "pybot.touch");
  assert.equal(touch.usable, false);
});

test("legacy shared paths are not imported by Universal Lab package", () => {
  const labDir = join(root, "src/esp32UniversalLab");
  const files = [
    "index.js",
    "featureGate.js",
    "firmwareManifest.js",
    "capabilityStatus.js",
    "profiles/index.js",
    "profiles/waveshareEsp32C6Lcd147.js",
    "profiles/waveshareEsp32S3TouchLcd154.js",
    "profiles/waveshareEsp32S3TouchLcd7.js",
    "runtime/adapter.js",
    "runtime/labSession.js",
    "runtime/c6Flasher.js",
    "pythonApi/manifest.js",
    "pythonApi/boardModules.js",
    "ide/boardPicker.js",
    "firmware/esp32GenericC6.js",
  ];
  for (const rel of files) {
    const src = readFileSync(join(labDir, rel), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*hardwareBridge/);
    assert.doesNotMatch(src, /import\s*\([^)]*hardwareBridge/);
    assert.doesNotMatch(src, /from\s+["'][^"']*PyBotIDE/);
    assert.doesNotMatch(src, /from\s+["'][^"']*eda6(Profile|PinMaps|Ensure)/);
    // Static imports of micropython/ remain forbidden; adapter may dynamic-import
    // the session transport behind the lab gate (M1).
    assert.doesNotMatch(src, /from\s+["']\.\.\/micropython\//);
    assert.doesNotMatch(src, /from\s+["']\.\.\/\.\.\/micropython\//);
  }
});

test("AC12: no .github/workflows changes; missing dir is fine", () => {
  assert.equal(existsSync(join(root, ".github/workflows")), false);
  assert.equal(existsSync(join(root, "docs/ESP32_UNIVERSAL_LAB_M0.md")), true);
});
