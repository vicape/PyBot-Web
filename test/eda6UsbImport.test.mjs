import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunnableProgram } from "../src/micropython/programWrap.js";
import {
  buildEda6ImportedPrelude,
  EDA6_LIBRARY_VERSION,
  EDA6_INVALIDATE_SCRIPT,
  parseEda6VersionProbe,
  eda6NeedsInstall,
  ensureEda6OnSession,
} from "../src/eda6Ensure.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const CURRENT_SOURCE = "EDA6_VERSION = \"" + EDA6_LIBRARY_VERSION + "\"\n";

function mockSession(versionStdout) {
  const calls = [];
  return {
    calls,
    async execRaw(code) {
      calls.push({ op: "execRaw", code });
      if (String(code).includes("EDA6_VER")) {
        return { stdout: versionStdout };
      }
      return { stdout: "" };
    },
    async installFile(name, source) {
      calls.push({ op: "installFile", name, source });
    },
  };
}

test("USB esp32-eda6 prelude imports EDA6 and does not embed the library source", () => {
  const prelude = buildEda6ImportedPrelude("WEMOS");
  const program = buildRunnableProgram(prelude, "servomotor(1, 90)");
  assert.match(program, /import EDA6/);
  assert.match(program, /EDA6\.PLACA_ACTUAL = "WEMOS"/);
  assert.match(program, /from EDA6 import \*/);
  assert.match(program, /_pybot_cleanup_normal = EDA6\._pybot_cleanup_normal/);
  assert.doesNotMatch(program, /def entradaAnalogica\(/);
  assert.doesNotMatch(program, /def servomotor\(/);
  assert.doesNotMatch(program, /def motorRC\(/);

  const bridge = readFileSync(join(root, "src", "hardwareBridge.js"), "utf8");
  const usb = bridge.slice(
    bridge.indexOf("if (_mode === \"esp32-eda6\")"),
    bridge.indexOf("if (isNativeBleEnabled() && _bleMpSession)"),
  );
  assert.match(usb, /ensureEda6OnSession/);
  assert.match(usb, /buildEda6ImportedPrelude|buildEda6RunPrelude/);
  assert.doesNotMatch(usb, /getEda6ExecPrelude/);
});

test("ensure EDA6 skips installFile when the installed version matches", async () => {
  const session = mockSession("EDA6_VER " + EDA6_LIBRARY_VERSION);
  const result = await ensureEda6OnSession(session, { getSource: () => CURRENT_SOURCE });
  assert.equal(result.updated, false);
  assert.equal(session.calls.some((c) => c.op === "installFile"), false);
});

test("ensure EDA6 installs current source when the library is missing", async () => {
  const session = mockSession("EDA6_VER MISSING");
  const result = await ensureEda6OnSession(session, { getSource: () => CURRENT_SOURCE });
  assert.equal(result.updated, true);
  const install = session.calls.find((c) => c.op === "installFile");
  assert.equal(install.name, "EDA6.py");
  assert.equal(install.source, CURRENT_SOURCE);
});

test("ensure EDA6 updates an old version and clears sys.modules", async () => {
  const session = mockSession("EDA6_VER 1.0.0");
  const result = await ensureEda6OnSession(session, { getSource: () => CURRENT_SOURCE });
  assert.equal(result.updated, true);
  assert.equal(session.calls.filter((c) => c.op === "installFile").length, 1);
  const afterInstall = session.calls.filter((c) => c.op === "execRaw").pop();
  assert.match(afterInstall.code, /del sys\.modules\['EDA6'\]/);
  assert.match(afterInstall.code, /gc\.collect\(\)/);
  assert.equal(afterInstall.code, EDA6_INVALIDATE_SCRIPT);
  assert.equal(eda6NeedsInstall(parseEda6VersionProbe("EDA6_VER 1.0.0")), true);
});

test("buildEda6ImportedPrelude applies WEMOS and ESP32 profiles", () => {
  assert.match(buildEda6ImportedPrelude("WEMOS"), /EDA6\.PLACA_ACTUAL = "WEMOS"/);
  assert.match(buildEda6ImportedPrelude("ESP32"), /EDA6\.PLACA_ACTUAL = "ESP32"/);
  const bundled = readFileSync(join(root, "src", "assets", "EDA6.py"), "utf8");
  assert.match(bundled, new RegExp('EDA6_VERSION = "' + EDA6_LIBRARY_VERSION + '"'));
});
