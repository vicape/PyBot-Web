import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("Arduino Firmata / compiler / VM files are untouched in spirit (still present)", () => {
  const firmata = read("src/firmataSession.js");
  const compiler = read("src/arduino/pybotArduinoCompiler.js");
  const vm = read("src/arduinoVmSession.js");
  const bridge = read("src/hardwareBridge.js");
  assert.match(firmata, /connectFirmataSession/);
  assert.match(compiler, /compileToBytecode/);
  assert.match(vm, /downloadProgramToArduino/);
  assert.match(bridge, /arduino-firmata/);
  assert.match(bridge, /downloadToArduino/);
  assert.doesNotMatch(firmata, /MicroPythonSession/);
  assert.doesNotMatch(compiler, /bleRunSession/);
});

test("Pyodide runner is independent of the MicroPython BLE refactor", () => {
  const pyodide = read("src/pyodideRunner.js");
  assert.doesNotMatch(pyodide, /BleRunSession/);
  assert.doesNotMatch(pyodide, /dupterm/);
});

test("native path does not introduce AST checkpoints or sleep monkeypatch in web session", () => {
  const session = read("src/micropythonEsp32Session.js");
  assert.doesNotMatch(session, /time\.sleep\s*=/);
  assert.doesNotMatch(session, /acorn|recast|shift-parser/);
  assert.match(session, /CTRL_C|\\\\x03|\\x03/);
});

test("filesystem helpers stay on MicroPythonSession (USB and BLE share them)", () => {
  const session = read("src/micropythonEsp32Session.js");
  for (const m of ["installFile", "fileExists", "removeFile", "getFileSize", "syncFilesystem"]) {
    assert.match(session, new RegExp("async " + m + "\\("));
  }
});

test("boot.py stays tiny and OTA-only", () => {
  const boot = read("firmware/pybot-ble-runtime/boot.py");
  assert.ok(new TextEncoder().encode(boot).length < 500);
  assert.match(boot, /pybot_update\.json/);
  assert.doesNotMatch(boot, /bluetooth/);
});
