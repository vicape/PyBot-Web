import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  wrapStudentExecution,
  buildRunnableProgram,
  HELD_HARDWARE_RELEASE_SCRIPT,
} from "../src/micropython/programWrap.js";
import { BLE_NATIVE_PRELUDE } from "../src/micropython/constants.js";
import { MPY_PRELUDE } from "../src/micropython/usbPrelude.js";
import { buildEda6ImportedPrelude } from "../src/eda6Ensure.js";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";
import { FakeMicroPythonTransport } from "./helpers/fakeMicroPython.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const EDA6 = join(root, "src", "assets", "EDA6.py");
const SIM = join(__dirname, "helpers", "eda6ServoHoldSim.py");
const BRIDGE = join(root, "src", "hardwareBridge.js");
const IDE = join(root, "src", "PyBotIDE.jsx");
const RUN_PY = join(root, "firmware", "pybot-ble-runtime", "pybot_run.py");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function findPython() {
  for (const cmd of ["python", "py", "python3"]) {
    const probe = spawnSync(cmd, ["-c", "print(6*7)"], { encoding: "utf8" });
    if (probe.status === 0 && String(probe.stdout).includes("42")) return cmd;
  }
  return null;
}

test("wrap separates normal end from error and keeps a finally", () => {
  const wrapped = wrapStudentExecution("servomotor(1, 90)");
  assert.match(wrapped, /_pybot_ok = False/);
  assert.match(wrapped, /_pybot_ok = True/);
  assert.match(wrapped, /finally:/);
  assert.match(wrapped, /if _pybot_ok:/);
  assert.match(wrapped, /_pybot_cleanup_normal\(\)/);
  assert.match(wrapped, /else:/);
  assert.match(wrapped, /detenerTodo\(\)/);
  assert.match(wrapped, /_pybot_cleanup\(\)/);
  const normalIdx = wrapped.indexOf("if _pybot_ok:");
  const elseIdx = wrapped.indexOf("    else:", normalIdx);
  const normalBlock = wrapped.slice(normalIdx, elseIdx);
  const errorBlock = wrapped.slice(elseIdx);
  assert.match(normalBlock, /_pybot_cleanup_normal\(\)/);
  assert.match(normalBlock, /except Exception:/);
  assert.match(errorBlock, /detenerTodo\(\)/);
  assert.match(errorBlock, /_pybot_cleanup\(\)/);
});

test("GPIO wrap still falls back to full cleanup when _pybot_cleanup_normal is missing", () => {
  const program = buildRunnableProgram("", "pin(2, 1)");
  assert.match(program, /_pybot_cleanup_normal\(\)/);
  assert.match(program, /except Exception:\s*\n\s+try:\s*\n\s+detenerTodo\(\)/);
});

test("EDA6 registers servo vs motorRC and keeps positional PWM on normal cleanup", () => {
  const src = readFileSync(EDA6, "utf8");
  assert.match(src, /servo_pins": \[25, 16, 14, 13\]/);
  assert.match(src, /_pwm_role/);
  assert.match(src, /_pwm_role\[gpio\] = "servo"/);
  assert.match(src, /_pwm_role\[gpio\] = "motor"/);
  assert.match(src, /def _pybot_cleanup_normal\(/);
  assert.match(src, /def _stop_pwm\(keep_positional=False\)/);
  assert.match(src, /_map_val\(a, 0, 180, 31, 120\)/);
  assert.doesNotMatch(src, /sleep\((0\.[1-9]|[1-9])/);
});

test("BLE_NATIVE_PRELUDE aliases _pybot_cleanup (star-import skips private names)", () => {
  assert.match(BLE_NATIVE_PRELUDE, /import pybot_mpy/);
  assert.match(BLE_NATIVE_PRELUDE, /from pybot_mpy import \*/);
  assert.match(
    BLE_NATIVE_PRELUDE,
    /_pybot_cleanup = pybot_mpy\._pybot_cleanup/,
  );
  // Cleanup privado se obtiene por alias explícito, no por star-import.
  assert.ok(
    BLE_NATIVE_PRELUDE.includes("_pybot_cleanup = pybot_mpy._pybot_cleanup"),
  );
  assert.equal(
    BLE_NATIVE_PRELUDE.includes("from pybot_mpy import _pybot_cleanup"),
    false,
  );
  const wrap = read("src/micropython/programWrap.js");
  const cleanupCalls = wrap.match(/_pybot_cleanup\(\)/g) || [];
  assert.ok(cleanupCalls.length >= 2, "wrapper calls cleanup before run and on exit");
  const composed = BLE_NATIVE_PRELUDE + buildEda6ImportedPrelude("WEMOS");
  assert.match(composed, /_pybot_cleanup = pybot_mpy\._pybot_cleanup/);
  assert.match(composed, /_pybot_cleanup_normal = EDA6\._pybot_cleanup_normal/);
  assert.match(MPY_PRELUDE, /def _pybot_cleanup\(\):/);
  assert.doesNotMatch(MPY_PRELUDE, /import pybot_mpy/);
});

test("BLE prelude imports EDA6, applies profile via _aplicar_placa, and does not call bare _pins()", () => {
  const profile = readFileSync(join(root, "src", "eda6Profile.js"), "utf8");
  const preludeMod = readFileSync(join(root, "src", "eda6Ensure.js"), "utf8");
  assert.match(profile, /buildEda6ImportedPrelude/);
  assert.match(profile, /export function buildEda6ModuleProbe/);
  assert.match(preludeMod, /export function buildEda6ImportedPrelude/);
  assert.match(preludeMod, /EDA6\._aplicar_placa\("\$\{placa\}"\)/);
  assert.match(preludeMod, /_pybot_cleanup_normal = EDA6\._pybot_cleanup_normal/);
  assert.match(profile, /EDA6\._pins\(\)/);
  assert.match(profile, /servo_pins/);

  const bridge = readFileSync(BRIDGE, "utf8");
  assert.match(bridge, /buildEda6ImportedPrelude/);
  assert.match(bridge, /buildEda6ModuleProbe/);
  const bleNative = bridge.slice(bridge.indexOf("if (isNativeBleEnabled() && _bleMpSession)"));
  assert.match(bleNative, /buildEda6ImportedPrelude\(profile\)/);
  assert.match(bleNative, /buildEda6ModuleProbe\(\)/);
  assert.match(bleNative, /assertEda6CanonicalOnSession/);
  assert.doesNotMatch(bleNative, /BLE_NATIVE_PRELUDE \+ "from EDA6 import \*\\n"/);
  assert.match(bridge, /releaseHeldHardware/);
  assert.match(readFileSync(RUN_PY, "utf8"), /keep_servos=\(outcome == "done"\)/);
  assert.match(readFileSync(RUN_PY, "utf8"), /_aplicar_placa/);
});

test("Stop UI and session release held hardware when idle", async () => {
  const ide = readFileSync(IDE, "utf8");
  const start = ide.indexOf("const onStop = useCallback");
  const body = ide.slice(start, start + 1800);
  assert.match(body, /if \(onBoard\)/);
  assert.match(body, /stopBoardExecution/);
  assert.match(body, /hardwareIsConnected/);

  assert.match(HELD_HARDWARE_RELEASE_SCRIPT, /EDA6\.detenerTodo/);
  assert.match(HELD_HARDWARE_RELEASE_SCRIPT, /_pybot_cleanup/);

  const board = new FakeMicroPythonTransport();
  const session = new MicroPythonSession(board, 115200);
  await session.detect();
  assert.equal(session.isProgramActive(), false);
  const released = await session.releaseHeldHardware();
  assert.equal(released.skipped, undefined);
  const sent = board.writes.map((w) => new TextDecoder().decode(w)).join("");
  assert.match(sent, /EDA6\.detenerTodo/);
  await session.close();
});

test("releaseHeldHardware skips while a program is active", async () => {
  const board = new FakeMicroPythonTransport();
  const session = new MicroPythonSession(board, 115200);
  await session.detect();
  const runP = session.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: () => {},
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(session.isProgramActive(), true);
  const skipped = await session.releaseHeldHardware();
  assert.deepEqual(skipped, { skipped: true });
  await session.interrupt();
  await runP;
  assert.equal(session.isProgramActive(), false);
  await session.close();
});

test("EDA6 servo hold simulation (USB wrap + BLE profile)", () => {
  const py = findPython();
  if (!py) {
    assert.ok(read("src/assets/EDA6.py").includes("_pybot_cleanup_normal"));
    return;
  }
  const r = spawnSync(py, [SIM, EDA6], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(String(r.stdout).trim().split("\n").pop());
  assert.equal(data.ok, true);
  assert.equal(data.normal_hold.gpio, 25);
  assert.equal(data.normal_hold.alive, true);
  assert.equal(data.normal_hold.duty, data.normal_hold.expected_duty);
  assert.equal(data.second_angle.alive, true);
  assert.equal(data.second_angle.duty, data.second_angle.expected_duty);
  assert.equal(data.stop_after_idle.alive, false);
  assert.equal(data.on_error.alive, false);
  assert.equal(data.motor_rc.alive, false);
  assert.equal(data.ble_profile.module_gpio, 25);
  assert.equal(data.ble_profile.pins_imported_by_star, false);
});
