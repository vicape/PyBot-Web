import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunnableProgram } from "../src/micropython/programWrap.js";
import {
  buildEda6ImportedPrelude,
  EDA6_INVALIDATE_SCRIPT,
  parseEda6PresenceProbe,
  eda6NeedsInstall,
  ensureEda6OnSession,
} from "../src/eda6Ensure.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const BUNDLED_SOURCE = "# EDA6 bundled for install when missing\nPLACA_ACTUAL = \"WEMOS\"\n";

function mockSession(presenceStdout) {
  const calls = [];
  return {
    calls,
    async execRaw(code) {
      calls.push({ op: "execRaw", code });
      if (String(code).includes("EDA6_OK") || String(code).includes("EDA6_MISSING") || String(code).includes("import EDA6")) {
        if (String(code).includes("del sys.modules")) {
          return { stdout: "" };
        }
        return { stdout: presenceStdout };
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
  assert.doesNotMatch(usb, /buildEda6VersionGuard/);
});

test("ensure EDA6 skips installFile when library is already present (original OK)", async () => {
  const session = mockSession("EDA6_OK");
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, false);
  assert.equal(session.calls.some((c) => c.op === "installFile"), false);
});

test("ensure EDA6 installs current source when the library is missing", async () => {
  const session = mockSession("EDA6_MISSING");
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, true);
  const install = session.calls.find((c) => c.op === "installFile");
  assert.equal(install.name, "EDA6.py");
  assert.equal(install.source, BUNDLED_SOURCE);
});

test("ensure EDA6 does not overwrite original for lacking invented version", async () => {
  // Presence-only: any successful import counts as present (no EDA6_VERSION required).
  const session = mockSession("EDA6_OK");
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, false);
  assert.equal(eda6NeedsInstall(parseEda6PresenceProbe("EDA6_OK")), false);
  assert.equal(eda6NeedsInstall(parseEda6PresenceProbe("EDA6_MISSING")), true);
});

test("install path still clears sys.modules after write", async () => {
  const session = mockSession("EDA6_MISSING");
  await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  const afterInstall = session.calls.filter((c) => c.op === "execRaw").pop();
  assert.match(afterInstall.code, /del sys\.modules\['EDA6'\]/);
  assert.match(afterInstall.code, /gc\.collect\(\)/);
  assert.equal(afterInstall.code, EDA6_INVALIDATE_SCRIPT);
});

test("buildEda6ImportedPrelude applies WEMOS and ESP32 profiles; bundled has no VERSION", () => {
  assert.match(buildEda6ImportedPrelude("WEMOS"), /EDA6\.PLACA_ACTUAL = "WEMOS"/);
  assert.match(buildEda6ImportedPrelude("ESP32"), /EDA6\.PLACA_ACTUAL = "ESP32"/);
  const bundled = readFileSync(join(root, "src", "assets", "EDA6.py"), "utf8");
  assert.doesNotMatch(bundled, /EDA6_VERSION/);
  assert.doesNotMatch(bundled, /1\.1\.0|1\.1\.1/);
});
