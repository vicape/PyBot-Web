import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPL_RX_UUID,
  REPL_TX_UUID,
  RX_UUID,
  TX_UUID,
  runtimeSupportsNativeRepl,
  PYBOT_CAPABILITIES,
} from "../src/bleProtocol.js";
import { isNativeBleEnabled } from "../src/micropython/featureFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FW = join(__dirname, "..", "firmware", "pybot-ble-runtime");
const SRC = join(__dirname, "..", "src");

function readFw(name) {
  return readFileSync(join(FW, name), "utf8");
}

test("REPL UUIDs are distinct from ADMIN RX/TX", () => {
  assert.equal(REPL_RX_UUID, "8fbc0004-4d5a-4b8c-9a1f-123456789004");
  assert.equal(REPL_TX_UUID, "8fbc0005-4d5a-4b8c-9a1f-123456789005");
  assert.notEqual(REPL_RX_UUID, RX_UUID);
  assert.notEqual(REPL_TX_UUID, TX_UUID);
});

test("capability native-repl is declared", () => {
  assert.ok(PYBOT_CAPABILITIES.includes("native-repl"));
  assert.equal(runtimeSupportsNativeRepl({ capabilities: ["native-repl"] }), true);
  assert.equal(runtimeSupportsNativeRepl({ capabilities: ["run"] }), false);
});

test("firmware BLE service registers REPL characteristics", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /8fbc0004-4d5a-4b8c-9a1f-123456789004/);
  assert.match(ble, /8fbc0005-4d5a-4b8c-9a1f-123456789005/);
  assert.match(ble, /attach_repl/);
  assert.match(ble, /inject_ctrl_c/);
  assert.match(ble, /_handle_repl_rx/);
});

test("pybot_repl IRQ path has no filesystem/import/sleep/json", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /def irq_put\(/);
  assert.match(src, /dupterm_notify/);
  assert.match(src, /class BleReplStream/);
  const irq = src.slice(src.indexOf("def irq_put"), src.indexOf("def inject_ctrl_c"));
  assert.doesNotMatch(irq, /open\(/);
  assert.doesNotMatch(irq, /json/);
  assert.doesNotMatch(irq, /sleep/);
  assert.doesNotMatch(irq, /import /);
});

test("native main returns to REPL; legacy loop is opt-in", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /pybot_legacy\.on/);
  assert.match(ble, /REPL nativo/);
  assert.match(ble, /micropython\.schedule/);
  assert.match(ble, /def _exec_student_app/);
});

test("pybot_repl.attach reports real dupterm success or raises", () => {
  const src = readFw("pybot_repl.py");
  const attach = src.slice(src.indexOf("def attach("), src.indexOf("\ndef detach("));
  assert.match(attach, /return True/);
  assert.doesNotMatch(attach, /return _stream/);
  assert.match(attach, /raise /);
  assert.match(attach, /dupterm unavailable|dupterm failed/);
});

test("STOP injects Ctrl+C into the REPL stream", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /inject_ctrl_c/);
  const repl = readFw("pybot_repl.py");
  assert.match(repl, /inject_ctrl_c/);
  assert.match(repl, /kbd_intr/);
});

test("native firmware does not monkeypatch time.sleep", () => {
  const repl = readFw("pybot_repl.py");
  assert.doesNotMatch(repl, /time\.sleep\s*=/);
  const ble = readFw("pybot_ble.py");
  assert.doesNotMatch(ble, /time\.sleep\s*=/);
  const net = readFw("pybot_net.py");
  assert.doesNotMatch(net, /time\.sleep\s*=/);
});

test("ProgramManager monkeypatch remains LEGACY only (pybot_run.py)", () => {
  const run = readFw("pybot_run.py");
  assert.match(run, /LEGACY/);
  assert.match(run, /time\.sleep = _checked_sleep/);
});

test("web BluetoothTransport binds REPL chars separately from ADMIN", () => {
  const src = readFileSync(join(SRC, "bluetoothTransport.js"), "utf8");
  assert.match(src, /onReplData/);
  assert.match(src, /writeRepl/);
  assert.match(src, /_bindReplCharacteristics/);
  assert.match(src, /hasRepl/);
});

test("hardwareBridge native path sits between USB and legacy BLE", () => {
  const src = readFileSync(join(SRC, "hardwareBridge.js"), "utf8");
  const start = src.indexOf("export async function runOnBoard(");
  const after = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, after >= 0 ? after : undefined);
  const iUsb = body.indexOf("_mpSession");
  const iNative = body.indexOf("_bleMpSession");
  const iLegacy = body.indexOf("_bleRun");
  assert.ok(iUsb >= 0 && iNative >= 0 && iLegacy >= 0);
  assert.ok(iUsb < iNative, "USB before native BLE");
  assert.ok(iNative < iLegacy, "native BLE before legacy RUN");
  assert.equal(typeof isNativeBleEnabled, "function");
});

test("hardwareBridge Stop native uses Ctrl+C, not STOP:FORCE", () => {
  const src = readFileSync(join(SRC, "hardwareBridge.js"), "utf8");
  const start = src.indexOf("export async function stopBoardExecution(");
  const after = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, after >= 0 ? after : undefined);
  const nativeIdx = body.indexOf("ble-native");
  const forceIdx = body.indexOf("STOP_FORCE");
  assert.ok(nativeIdx >= 0);
  assert.ok(nativeIdx < forceIdx || forceIdx < 0 || body.indexOf("_bleMpSession") < forceIdx);
  assert.match(body, /kind: "no-session"/);
});
