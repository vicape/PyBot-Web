import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { wrapStudentExecution, buildRunnableProgram } from "../src/micropython/programWrap.js";
import { buildEda6ImportedPrelude } from "../src/eda6Ensure.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("EDA6 preserves vendor PWM until student code, while GPIO retains pre-run cleanup", () => {
  const eda6 = wrapStudentExecution("servomotor(1, 90)", { eda6Lifecycle: true });
  const gpio = wrapStudentExecution("pin(2, 1)");
  const beforeMain = eda6.split("def __pybot_main():")[0];
  assert.doesNotMatch(beforeMain, /detenerTodo\(\)/);
  assert.match(eda6, /finally:/);
  assert.match(eda6, /detenerTodo\(\)/);
  assert.match(gpio.split("def __pybot_main():")[0], /detenerTodo\(\)/);
});

test("USB and native BLE opt into EDA6-only lifecycle without modifying GPIO path", () => {
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  const session = readFileSync(join(root, "src/micropython/micropythonSession.js"), "utf8");
  assert.match(bridge, /_mpSession\.runProgram\(userCode, \{ \.\.\.cb, prelude, eda6Lifecycle: true \}\)/);
  assert.match(bridge, /_bleMpSession\.runProgram\(userCode, \{ \.\.\.cb, prelude, eda6Lifecycle: true \}\)/);
  assert.match(bridge, /return _mpSession\.runProgram\(code, cb\)/);
  assert.match(session, /eda6Lifecycle: cb\.eda6Lifecycle === true/);
  const src = readFileSync(join(root, "src/assets/EDA6.py"));
  assert.equal(createHash("sha256").update(src).digest("hex"), "23a33c19b30d77a888692559e56ca73cc41e45334afdc9a7287419dd79891442");
});

test("EDA6 Run, error/Stop cleanup, Run recreates usable vendor PWM", () => {
  const py = ["python3", "python", "py"].find((name) => {
    const r = spawnSync(name, ["-c", "print(42)"], { encoding: "utf8" });
    return r.status === 0 && r.stdout.includes("42");
  });
  assert.ok(py, "Python required for EDA6 lifecycle simulation");

  const dir = mkdtempSync(join(tmpdir(), "pybot-eda6-lifecycle-"));
  try {
    // The vendor module creates PWM when imported and deinit makes it permanently
    // inactive. Re-import is necessary; Stop must never be removed for safety.
    writeFileSync(join(dir, "EDA6.py"), [
      "import builtins",
      "log = builtins.eda6_lifecycle_log",
      "log['imports'] += 1",
      "PLACA_ACTUAL = 'WEMOS'",
      "PIN_MAPS = {'WEMOS': {'servo_pins': [25,16,14,13]}}",
      "PINS = PIN_MAPS[PLACA_ACTUAL]",
      "_alive = True",
      "def servomotor(port, angle):",
      "    if not _alive: raise RuntimeError('PWM is inactive')",
      "    log['moves'] += 1",
      "def detenerTodo():",
      "    global _alive",
      "    _alive = False",
      "    log['stops'] += 1",
      "",
    ].join("\n"));

    const prelude = buildEda6ImportedPrelude("WEMOS");
    const good = buildRunnableProgram(prelude, "servomotor(1, 90)", { eda6Lifecycle: true });
    const fail = buildRunnableProgram(prelude, "servomotor(1, 0)\nraise ValueError('stop')", { eda6Lifecycle: true });
    const script = [
      "import sys, builtins, json",
      "sys.path.insert(0, " + JSON.stringify(dir) + ")",
      "builtins.eda6_lifecycle_log = {'imports': 0, 'moves': 0, 'stops': 0}",
      "exec(compile(" + JSON.stringify(good) + ", '<run1>', 'exec'), {})",
      "try:",
      "    exec(compile(" + JSON.stringify(fail) + ", '<stopped>', 'exec'), {})",
      "except ValueError:",
      "    pass",
      "exec(compile(" + JSON.stringify(good) + ", '<run3>', 'exec'), {})",
      "print(json.dumps(builtins.eda6_lifecycle_log))",
    ].join("\n");
    const result = spawnSync(py, ["-c", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(report.imports, 3, "each Run must re-create deinitialized PWM");
    assert.equal(report.moves, 3, "all Runs must be able to move servo");
    assert.ok(report.stops >= 3, "normal end and errors must still release actuators");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
