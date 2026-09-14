/**
 * #15 — release 4.0.7: aserciones CURRENT + matriz OTA/USB + _version_is_newer.
 * Fixtures históricos de 4.0.6 (boot apply, CASO11, native 4.0.6 board) se
 * mantienen en otros tests a propósito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PYBOT_RUNTIME_VERSION,
  PYBOT_PROTOCOL_VERSION,
  runtimeUpdateStatus,
  compareRuntimeVersions,
  sha256Hex,
} from "../src/bleProtocol.js";
import {
  PYBOT_RUNTIME_FILES,
  PYBOT_RUNTIME_MODULE_FILES,
} from "../src/esp32/pybotInstallManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FW = join(ROOT, "firmware", "pybot-ble-runtime");
const PACK_MAGIC = "PYBOTRT1\n";

function readFw(name) {
  return readFileSync(join(FW, name), "utf8");
}

function buildPackBytesFromDisk() {
  const enc = new TextEncoder();
  const parts = [enc.encode(PACK_MAGIC)];
  for (const name of PYBOT_RUNTIME_MODULE_FILES) {
    const body = enc.encode(readFw(name));
    parts.push(enc.encode(`${name}\n${body.length}\n`));
    parts.push(body);
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

test("#15 CURRENT: PYBOT_RUNTIME_VERSION is 4.0.7", () => {
  assert.equal(PYBOT_RUNTIME_VERSION, "4.0.7");
});

test("#15 firmware pybot_ble.py declares 4.0.7 / protocol 3.2", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /PYBOT_RUNTIME_VERSION = "4\.0\.7"/);
  assert.match(ble, /PYBOT_PROTOCOL_VERSION = "3\.2"/);
  assert.equal(PYBOT_PROTOCOL_VERSION, "3.2");
});

test("#15 EDA6 and protocol stay unchanged", () => {
  assert.equal(PYBOT_PROTOCOL_VERSION, "3.2");
  const eda6 = readFileSync(join(ROOT, "src/assets/EDA6.py"), "utf8");
  assert.match(eda6, /EDA6_VERSION\s*=\s*"1\.1\.0"/);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.1");
});

test("#15 4.0.6 → 4.0.7: OTA available, not USB", () => {
  const s = runtimeUpdateStatus(
    {
      firmware: "4.0.6",
      capabilities: ["runtime-update", "native-repl", "reliable-repl-v1"],
    },
    PYBOT_RUNTIME_VERSION,
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.supportsOta, true);
  assert.equal(s.canUpdateOta, true);
  assert.equal(s.needsUsb, false);
});

test("#15 4.0.7 installed: no update", () => {
  const s = runtimeUpdateStatus(
    {
      firmware: "4.0.7",
      capabilities: ["runtime-update", "native-repl", "reliable-repl-v1"],
    },
    PYBOT_RUNTIME_VERSION,
  );
  assert.equal(s.updateAvailable, false);
  assert.equal(s.canUpdateOta, false);
});

test("#15 4.0.8 installed: no downgrade", () => {
  const s = runtimeUpdateStatus(
    {
      firmware: "4.0.8",
      capabilities: ["runtime-update", "native-repl", "reliable-repl-v1"],
    },
    PYBOT_RUNTIME_VERSION,
  );
  assert.equal(s.updateAvailable, false);
  assert.equal(s.canUpdateOta, false);
  assert.ok(compareRuntimeVersions("4.0.8", "4.0.7") > 0);
});

test("#15 4.0.4 → 4.0.7 still needs USB", () => {
  const s = runtimeUpdateStatus(
    { firmware: "4.0.4", capabilities: ["runtime-update", "native-repl"] },
    PYBOT_RUNTIME_VERSION,
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.canUpdateOta, false);
  assert.equal(s.needsUsb, true);
});

test("#15 3.1.x → 4.0.7 still needs USB", () => {
  const s = runtimeUpdateStatus(
    { firmware: "3.1.0", capabilities: ["runtime-update"] },
    PYBOT_RUNTIME_VERSION,
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.canUpdateOta, false);
  assert.equal(s.needsUsb, true);
});

test("#15 firmware _version_is_newer: 4.0.7 vs 4.0.6", () => {
  const script = `
import re, pathlib
src = pathlib.Path(r"${join(FW, "pybot_ble.py").replace(/\\/g, "\\\\")}").read_text(encoding="utf-8")
m = re.search(r"def _version_is_newer\\(candidate, current\\):\\n(?:    .*\\n)+", src)
assert m, "function not found"
ns = {}
exec(m.group(0), ns)
fn = ns["_version_is_newer"]
assert fn("4.0.7", "4.0.6") is True
assert fn("4.0.7", "4.0.7") is False
assert fn("4.0.6", "4.0.7") is False
print("OK")
`;
  const r = spawnSync("python", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /OK/);
});

test("#15 buildBleRuntimePackBytes-equivalent pack is valid PYBOTRT1 with all modules", () => {
  const bytes = buildPackBytesFromDisk();
  const text = new TextDecoder().decode(bytes.subarray(0, PACK_MAGIC.length));
  assert.equal(text, PACK_MAGIC);
  assert.equal(sha256Hex(bytes).length, 64);
  const full = new TextDecoder().decode(bytes);
  for (const name of PYBOT_RUNTIME_MODULE_FILES) {
    assert.ok(full.includes(`${name}\n`), name);
  }
  assert.match(readFw("pybot_ble.py"), /PYBOT_RUNTIME_VERSION = "4\.0\.7"/);
  assert.ok(PYBOT_RUNTIME_MODULE_FILES.includes("pybot_rble.py"));
  assert.ok(PYBOT_RUNTIME_MODULE_FILES.includes("pybot_net.py"));
  assert.ok(PYBOT_RUNTIME_MODULE_FILES.includes("pybot_update.py"));
});

test("#15 USB install list remains full runtime set", () => {
  assert.ok(PYBOT_RUNTIME_FILES.includes("boot.py"));
  assert.ok(PYBOT_RUNTIME_FILES.includes("main.py"));
  assert.ok(PYBOT_RUNTIME_FILES.includes("pybot_ble.py"));
  for (const name of PYBOT_RUNTIME_MODULE_FILES) {
    assert.ok(PYBOT_RUNTIME_FILES.includes(name), name);
  }
  // boot + modules; boot is not in the OTA pack module list.
  assert.ok(PYBOT_RUNTIME_FILES.length >= PYBOT_RUNTIME_MODULE_FILES.length);
});
