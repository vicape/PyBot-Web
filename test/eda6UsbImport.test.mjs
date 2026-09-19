import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunnableProgram } from "../src/micropython/programWrap.js";
import {
  buildEda6ImportedPrelude,
  EDA6_INVALIDATE_SCRIPT,
  EDA6_HASH_QUERY_SCRIPT,
  EDA6_EXACT_HASH_QUERY_SCRIPT,
  eda6FileHash,
  eda6CanonicalHash,
  eda6NeedsInstall,
  parseEda6HashProbe,
  ensureEda6OnSession,
  assertEda6CanonicalOnSession,
} from "../src/eda6Ensure.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const BUNDLED_SOURCE = readFileSync(join(root, "src", "assets", "EDA6.py"), "utf8");

function mockSession(hashStdout) {
  const calls = [];
  return {
    calls,
    async execRaw(code) {
      calls.push({ op: "execRaw", code });
      if (String(code).includes("del sys.modules")) {
        return { stdout: "" };
      }
      if (String(code).includes("EDA6_HASH") || String(code).includes("open('EDA6.py'")) {
        return { stdout: hashStdout };
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
  assert.match(program, /EDA6\._aplicar_placa\("WEMOS"\)/);
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

test("ensure EDA6 skips installFile when exact file hash matches", async () => {
  const want = eda6FileHash(BUNDLED_SOURCE);
  const session = mockSession(`EDA6_HASH:${want}`);
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, false);
  assert.equal(session.calls.some((c) => c.op === "installFile"), false);
  assert.match(session.calls[0].code, /EDA6_HASH|open\('EDA6\.py'/);
  assert.equal(session.calls[0].code, EDA6_EXACT_HASH_QUERY_SCRIPT);
});

test("ensure EDA6 installs when library is missing", async () => {
  const session = mockSession("EDA6_MISSING");
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, true);
  const install = session.calls.find((c) => c.op === "installFile");
  assert.equal(install.name, "EDA6.py");
  assert.equal(install.source, BUNDLED_SOURCE);
});

test("ensure EDA6 reinstalls stale altered board copy (not presence-only)", async () => {
  const session = mockSession("EDA6_HASH:" + "ff".repeat(32));
  const result = await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  assert.equal(result.updated, true);
  assert.equal(eda6NeedsInstall(parseEda6HashProbe("EDA6_MISSING"), eda6FileHash(BUNDLED_SOURCE)), true);
  assert.equal(
    eda6NeedsInstall(eda6FileHash(BUNDLED_SOURCE), eda6FileHash(BUNDLED_SOURCE)),
    false,
  );
});

test("install path still clears sys.modules after write", async () => {
  const session = mockSession("EDA6_MISSING");
  await ensureEda6OnSession(session, { getSource: () => BUNDLED_SOURCE });
  const afterInstall = session.calls.filter((c) => c.op === "execRaw").pop();
  assert.match(afterInstall.code, /del sys\.modules\['EDA6'\]/);
  assert.match(afterInstall.code, /gc\.collect\(\)/);
  assert.equal(afterInstall.code, EDA6_INVALIDATE_SCRIPT);
});

test("BLE assertEda6CanonicalOnSession errors clearly when hash mismatches", async () => {
  const session = mockSession("EDA6_HASH:" + "ab".repeat(32));
  await assert.rejects(
    () => assertEda6CanonicalOnSession(session, { getSource: () => BUNDLED_SOURCE }),
    /EDA6_NEED_USB_SYNC/,
  );
  assert.match(EDA6_HASH_QUERY_SCRIPT, /hashlib\.sha256/);
  assert.ok(eda6CanonicalHash(BUNDLED_SOURCE));
});

test("buildEda6ImportedPrelude applies WEMOS and ESP32 profiles; bundled has no VERSION", () => {
  assert.match(buildEda6ImportedPrelude("WEMOS"), /EDA6\._aplicar_placa\("WEMOS"\)/);
  assert.match(buildEda6ImportedPrelude("ESP32"), /EDA6\._aplicar_placa\("ESP32"\)/);
  assert.doesNotMatch(BUNDLED_SOURCE, /EDA6_VERSION/);
  assert.doesNotMatch(BUNDLED_SOURCE, /1\.1\.0|1\.1\.1/);
  assert.match(BUNDLED_SOURCE, /def _aplicar_placa\(/);
});

test("bundled EDA6.py has no trailing whitespace (git diff --check hygiene)", () => {
  const normalized = BUNDLED_SOURCE.replace(/\r\n/g, "\n");
  assert.equal(normalized.includes("\r"), false);
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    assert.equal(
      line,
      line.replace(/[ \t]+$/, ""),
      `EDA6.py line ${i + 1} has trailing whitespace`,
    );
  }
});
