import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PYBOT_RUNTIME_VERSION,
  PYBOT_PROTOCOL_VERSION,
  sha256Hex,
} from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FW = join(__dirname, "..", "firmware", "pybot-ble-runtime");

const MODULE_FILES = [
  "main.py",
  "pybot_ble.py",
  "pybot_run.py",
  "pybot_deploy.py",
  "pybot_update.py",
  "pybot_boot_update.py",
];
const BOOT_CORE_FILES = ["boot.py", "main.py", "pybot_ble.py"];
const PACK_MAGIC = "PYBOTRT1\n";
const BOOT_CORE_MAX_BYTES = 28000;
const LEGACY_MAIN_BYTES = 56421;

function readFw(name) {
  return readFileSync(join(FW, name), "utf8");
}

function utf8Len(s) {
  return new TextEncoder().encode(s).length;
}

function buildPackBytes(modules) {
  const enc = new TextEncoder();
  const chunks = [enc.encode(PACK_MAGIC)];
  for (const { name, source } of modules) {
    const data = enc.encode(source);
    chunks.push(enc.encode(name + "\n"));
    chunks.push(enc.encode(String(data.length) + "\n"));
    chunks.push(data);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

test("runtime modules declare 3.2.1 / protocol 3.1", () => {
  assert.equal(PYBOT_RUNTIME_VERSION, "3.2.1");
  assert.equal(PYBOT_PROTOCOL_VERSION, "3.1");
  const core = readFw("pybot_ble.py");
  assert.match(core, /PYBOT_RUNTIME_VERSION = "3\.2\.1"/);
  assert.match(core, /PYBOT_PROTOCOL_VERSION = "3\.1"/);
});

test("main.py is a tiny stub that imports pybot_ble", () => {
  const main = readFw("main.py");
  assert.ok(utf8Len(main) < 200);
  assert.match(main, /import pybot_ble/);
  assert.match(main, /pybot_ble\.main\(\)/);
});

test("boot.py is minimal and lazy-loads pybot_boot_update", () => {
  const boot = readFw("boot.py");
  assert.ok(utf8Len(boot) < 500);
  assert.match(boot, /pybot_update\.json/);
  assert.match(boot, /import pybot_boot_update/);
  assert.match(boot, /pybot_boot_update\.apply\(\)/);
});

test("pybot_ble lazy-loads run/deploy/update modules", () => {
  const core = readFw("pybot_ble.py");
  assert.match(core, /def _load_run\(/);
  assert.match(core, /import pybot_run/);
  assert.match(core, /def _load_deploy\(/);
  assert.match(core, /import pybot_deploy/);
  assert.match(core, /def _load_update\(/);
  assert.match(core, /import pybot_update/);
  assert.doesNotMatch(core, /^import pybot_run/m);
  assert.doesNotMatch(core, /^import pybot_deploy/m);
  assert.doesNotMatch(core, /^import pybot_update/m);
});

test("pybot_ble preloads RUN after advertise and reports LOAD errors", () => {
  const core = readFw("pybot_ble.py");
  // Precarga en main() (fuera del IRQ) para que RUN:BEGIN no importe en GATTS_WRITE.
  assert.match(core, /_ensure_manager\(\)/);
  assert.match(core, /Precargar pybot_run/);
  // Fallos de lazy-import deben emitir frames visibles, nunca silencio/timeout.
  assert.match(core, /RUN:ERROR:LOAD:/);
  assert.match(core, /DEPLOY:ERROR:LOAD:/);
  assert.match(core, /APP:ERROR:LOAD:/);
  assert.match(core, /UPDATE:ERROR:LOAD:/);
});

test("RUN:BEGIN path reaches ProgramManager.begin -> RUN:READY", () => {
  const run = readFw("pybot_run.py");
  assert.match(run, /def handle_run\(/);
  assert.match(run, /RUN:BEGIN:/);
  assert.match(run, /def begin\(/);
  assert.match(run, /self\._send\("RUN:READY"\)/);
  const core = readFw("pybot_ble.py");
  assert.match(core, /startswith\("RUN:"\)/);
  assert.match(core, /handle_run\(/);
});

test("boot core size is well below the legacy monolith", () => {
  let bootCore = 0;
  let total = 0;
  for (const name of ["boot.py", ...MODULE_FILES]) {
    const n = utf8Len(readFw(name));
    total += n;
    if (BOOT_CORE_FILES.includes(name)) bootCore += n;
  }
  assert.ok(bootCore < BOOT_CORE_MAX_BYTES, `bootCore=${bootCore}`);
  assert.ok(bootCore < LEGACY_MAIN_BYTES * 0.5, `bootCore=${bootCore} should be <50% of legacy`);
  assert.ok(total > bootCore);
});

test("firmware module files exist and are non-trivial", () => {
  for (const name of MODULE_FILES) {
    assert.ok(utf8Len(readFw(name)) > 8, name);
  }
  assert.ok(utf8Len(readFw("boot.py")) > 8);
});

test("OTA pack PYBOTRT1 round-trips module names and sizes", () => {
  const modules = MODULE_FILES.map((name) => ({ name, source: readFw(name) }));
  const bytes = buildPackBytes(modules);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith(PACK_MAGIC));
  assert.equal(sha256Hex(bytes).length, 64);

  let off = PACK_MAGIC.length;
  const found = [];
  const enc = new TextEncoder();
  while (off < bytes.length) {
    let nl = bytes.indexOf(0x0a, off);
    assert.ok(nl > off);
    const name = new TextDecoder().decode(bytes.subarray(off, nl));
    off = nl + 1;
    nl = bytes.indexOf(0x0a, off);
    assert.ok(nl > off);
    const size = parseInt(new TextDecoder().decode(bytes.subarray(off, nl)), 10);
    off = nl + 1;
    const data = bytes.subarray(off, off + size);
    assert.equal(data.length, size);
    off += size;
    found.push(name);
    assert.ok(MODULE_FILES.includes(name), name);
    const mod = modules.find((m) => m.name === name);
    assert.deepEqual(data, enc.encode(mod.source));
  }
  assert.deepEqual(found, MODULE_FILES);
});
