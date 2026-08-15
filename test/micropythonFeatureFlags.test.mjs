import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MICROPYTHON_NATIVE_BLE,
  isNativeBleEnabled,
} from "../src/micropython/featureFlags.js";
import {
  STOP_LEVEL,
  isNormalStopLevel,
  isResetLevel,
  nextStopLevel,
  timeoutForStopLevel,
} from "../src/micropython/stopLifecycle.js";
import {
  capabilitiesForBoardType,
  BOARD_FAMILY,
} from "../src/micropython/capabilities.js";
import { CTRL_A, CTRL_B, CTRL_C, CTRL_D } from "../src/micropython/constants.js";

test("MICROPYTHON_NATIVE_BLE defaults true and is centralized", () => {
  assert.equal(MICROPYTHON_NATIVE_BLE, true);
  const prev = globalThis.__PYBOT_NATIVE_BLE__;
  globalThis.__PYBOT_NATIVE_BLE__ = false;
  assert.equal(isNativeBleEnabled(), false);
  globalThis.__PYBOT_NATIVE_BLE__ = true;
  assert.equal(isNativeBleEnabled(), true);
  globalThis.__PYBOT_NATIVE_BLE__ = prev;
});

test("Stop levels: 1-3 are normal, 4-5 are reset and not Stop", () => {
  assert.equal(isNormalStopLevel(STOP_LEVEL.CTRL_C), true);
  assert.equal(isNormalStopLevel(STOP_LEVEL.REPL_RECOVER), true);
  assert.equal(isNormalStopLevel(STOP_LEVEL.SOFT_RESET), false);
  assert.equal(isResetLevel(STOP_LEVEL.HARD_RESET), true);
  assert.equal(nextStopLevel(1), 2);
  assert.equal(nextStopLevel(5), 5);
  assert.ok(timeoutForStopLevel(1) > 0);
});

test("REPL control bytes are the MicroPython standard", () => {
  assert.equal(CTRL_A, "\x01");
  assert.equal(CTRL_B, "\x02");
  assert.equal(CTRL_C, "\x03");
  assert.equal(CTRL_D, "\x04");
});

test("board capabilities separate Arduino from MicroPython", () => {
  const arduino = capabilitiesForBoardType("arduino-firmata");
  assert.equal(arduino.family, BOARD_FAMILY.ARDUINO);
  assert.equal(arduino.micropython, false);
  assert.equal(arduino.wifi, false);
  const mpy = capabilitiesForBoardType("esp32-micropython");
  assert.equal(mpy.family, BOARD_FAMILY.MICROPYTHON);
  assert.equal(mpy.wifi, true);
  assert.equal(mpy.bluetooth, true);
  const eda6 = capabilitiesForBoardType("esp32-eda6", "WEMOS");
  assert.equal(eda6.eda6, true);
});
