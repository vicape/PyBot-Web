/** Regresión: import EDA6 en código del alumno no debe chocar con el probe de PyBot. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRunnableProgram } from "../src/micropython/programWrap.js";

const bridge = readFileSync(join(process.cwd(), "src/hardwareBridge.js"), "utf8");

test("EDA6 USB and native BLE do not inject a module probe before user's import", () => {
  assert.doesNotMatch(bridge, /buildEda6ModuleProbe/);
  assert.doesNotMatch(bridge, /probe\s*\+\s*wrapEda6UserCodeForRun/);
  const calls = bridge.match(/const userCode = wrapEda6UserCodeForRun\(body\);/g) ?? [];
  assert.equal(calls.length, 2, "USB and native BLE must share the no-probe path");
  assert.match(bridge, /return _mpSession\.runProgram\(userCode, \{ \.\.\.cb, prelude, eda6Lifecycle: true \}\)/);
  assert.match(bridge, /return _bleMpSession\.runProgram\(userCode, \{ \.\.\.cb, prelude, eda6Lifecycle: true \}\)/);
});

test("student code with import EDA6 executes without Python local-variable scope error", () => {
  const prelude = [
    "import sys, types",
    "_eda6_mock = types.ModuleType('EDA6')",
    "_eda6_mock.PLACA_ACTUAL = 'WEMOS'",
    "sys.modules['EDA6'] = _eda6_mock",
    "import EDA6",
    "",
  ].join("\n");
  const body = [
    "try:",
    "    import EDA6",
    "    print('EDA6_PROFILE', EDA6.PLACA_ACTUAL)",
    "except Exception as e:",
    "    import sys",
    "    raise",
    "",
  ].join("\n");
  const runnable = buildRunnableProgram(prelude, body);
  let py;
  for (const bin of ["python3", "python", "py"]) {
    const check = spawnSync(bin, ["-c", "print(42)"], { encoding: "utf8" });
    if (check.status === 0 && check.stdout.includes("42")) { py = bin; break; }
  }
  assert.ok(py, "Python interpreter required for local scope regression test");
  const result = spawnSync(py, ["-c", runnable], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EDA6_PROFILE WEMOS/);
});
