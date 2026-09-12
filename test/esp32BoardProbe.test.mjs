/**
 * Punto 12: fileExists reject ≠ archivo ausente.
 * Comunicación fallida debe abortar inspectPybotOnSession, no producir INCOMPLETE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyBoard,
  inspectPybotOnSession,
} from "../src/esp32/boardProbe.js";
import {
  expectedProvisionFiles,
  PYBOT_MARKER_FILE,
} from "../src/esp32/pybotInstallManifest.js";
import { BOARD_STATE } from "../src/esp32/provisioningPhases.js";
import { PYBOT_RUNTIME_VERSION } from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function makeSession({ existsMap = {}, throwOn = null, throwError = null } = {}) {
  const called = [];
  return {
    called,
    async fileExists(name) {
      called.push(name);
      if (throwOn != null && name === throwOn) {
        throw throwError ?? new Error("serial disconnected");
      }
      if (Object.prototype.hasOwnProperty.call(existsMap, name)) {
        return existsMap[name];
      }
      return true;
    },
    async execRaw() {
      return { stdout: "PYBOT_MP 1.27.0\n" };
    },
  };
}

function allPresentMap() {
  const map = {};
  for (const n of expectedProvisionFiles()) map[n] = true;
  return map;
}

test("TEST1: all files present resolves normally", async () => {
  const session = makeSession({ existsMap: allPresentMap() });
  session.execRaw = async () => ({
    stdout: `PYBOT_MP 1.27.0\nPYBOT_SRC PYBOT_RUNTIME_VERSION = "${PYBOT_RUNTIME_VERSION}"\n`,
  });
  const result = await inspectPybotOnSession(session);
  assert.equal(result.boardState, BOARD_STATE.READY);
  assert.deepEqual(result.missing, []);
  assert.equal(result.files.length, expectedProvisionFiles().length);
});

test("TEST2: real missing file → missing list / INCOMPLETE", async () => {
  const map = allPresentMap();
  map["pybot_rble.py"] = false;
  const session = makeSession({ existsMap: map });
  session.execRaw = async () => ({
    stdout: `PYBOT_MP 1.27.0\nPYBOT_SRC PYBOT_RUNTIME_VERSION = "${PYBOT_RUNTIME_VERSION}"\n`,
  });
  const result = await inspectPybotOnSession(session);
  assert.ok(result.missing.includes("pybot_rble.py"));
  assert.equal(result.boardState, BOARD_STATE.INCOMPLETE);
});

test("TEST3: communication failure rejects (not INCOMPLETE)", async () => {
  const session = makeSession({ throwOn: "pybot_rble.py" });
  await assert.rejects(() => inspectPybotOnSession(session), /serial disconnected/);
});

test("TEST4: original error instance/code preserved", async () => {
  const err = new Error("raw repl timeout");
  err.code = "RAW_REPL_ENTER_TIMEOUT";
  const session = makeSession({ throwOn: "main.py", throwError: err });
  await assert.rejects(
    () => inspectPybotOnSession(session),
    (e) => {
      assert.equal(e, err);
      assert.equal(e.code, "RAW_REPL_ENTER_TIMEOUT");
      return true;
    },
  );
});

test("TEST5: does not continue fileExists after failure", async () => {
  const names = expectedProvisionFiles();
  assert.ok(names.length >= 3);
  const session = makeSession({ throwOn: names[1] });
  await assert.rejects(() => inspectPybotOnSession(session));
  assert.deepEqual(session.called, names.slice(0, 2));
});

test("TEST6: first fileExists throw rejects immediately", async () => {
  const first = expectedProvisionFiles()[0];
  const session = makeSession({ throwOn: first });
  await assert.rejects(() => inspectPybotOnSession(session));
  assert.deepEqual(session.called, [first]);
});

test("TEST7: fail mid-list rejects (no partial INCOMPLETE)", async () => {
  const names = expectedProvisionFiles();
  const session = makeSession({ throwOn: names[3] });
  let resolved;
  try {
    resolved = await inspectPybotOnSession(session);
  } catch (e) {
    assert.match(String(e.message), /serial disconnected/);
    assert.equal(resolved, undefined);
    return;
  }
  assert.fail("expected reject, got " + JSON.stringify(resolved));
});

test("TEST8: marker really absent → MICROPYTHON_ONLY", async () => {
  const map = allPresentMap();
  map[PYBOT_MARKER_FILE] = false;
  const session = makeSession({ existsMap: map });
  const result = await inspectPybotOnSession(session);
  assert.equal(result.boardState, BOARD_STATE.MICROPYTHON_ONLY);
  assert.ok(!result.files.includes(PYBOT_MARKER_FILE));
});

test("TEST9: marker probe fails → reject, not MICROPYTHON_ONLY", async () => {
  const session = makeSession({ throwOn: PYBOT_MARKER_FILE });
  await assert.rejects(() => inspectPybotOnSession(session));
});

test("TEST10: generic USB error rejects before missingProvisionFiles diagnosis", async () => {
  const session = makeSession({
    throwOn: "boot.py",
    throwError: new Error("USB disconnected"),
  });
  await assert.rejects(() => inspectPybotOnSession(session), /USB disconnected/);
});

test("TEST11: options.files subset — false vs throw", async () => {
  const subset = ["boot.py", "main.py", "EDA6.py"];
  const sessionFalse = makeSession({
    existsMap: { "boot.py": true, "main.py": false, "EDA6.py": true },
  });
  const ok = await inspectPybotOnSession(sessionFalse, { files: subset });
  assert.deepEqual(ok.files, ["boot.py", "EDA6.py"]);
  assert.ok(ok.missing.includes("main.py") || !ok.files.includes("main.py"));

  const sessionThrow = makeSession({ throwOn: "main.py" });
  await assert.rejects(() => inspectPybotOnSession(sessionThrow, { files: subset }));
  assert.deepEqual(sessionThrow.called, ["boot.py", "main.py"]);
});

test("TEST12: classifyBoard semantics unchanged", () => {
  assert.equal(classifyBoard({ hasMicroPython: false }), BOARD_STATE.VIRGIN);
  assert.equal(classifyBoard({ hasMicroPython: true, files: [] }), BOARD_STATE.MICROPYTHON_ONLY);
  assert.equal(
    classifyBoard({
      hasMicroPython: true,
      files: expectedProvisionFiles().filter((n) => n !== "pybot_rble.py"),
      runtimeVersion: PYBOT_RUNTIME_VERSION,
      mpVersion: "1.27.0",
    }),
    BOARD_STATE.INCOMPLETE,
  );
  assert.equal(
    classifyBoard({
      hasMicroPython: true,
      files: expectedProvisionFiles(),
      runtimeVersion: PYBOT_RUNTIME_VERSION,
      mpVersion: "1.27.0",
    }),
    BOARD_STATE.READY,
  );
});

test("wiring: hardwareBridge maps inspect reject to UNKNOWN/REPL, not INCOMPLETE", () => {
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  assert.match(bridge, /inspectPybotOnSession\(session\)/);
  assert.match(bridge, /BOARD_STATE\.REPL_UNAVAILABLE/);
  assert.match(bridge, /BOARD_STATE\.UNKNOWN/);
  // probeBoard catch no fuerza INCOMPLETE por error genérico
  const probeFn = bridge.slice(bridge.indexOf("async probeBoard"), bridge.indexOf("connectBootloader"));
  assert.doesNotMatch(probeFn, /boardState:\s*BOARD_STATE\.INCOMPLETE/);
});
