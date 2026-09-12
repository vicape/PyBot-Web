import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Hex, sha256HexUtf8 } from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FW_BOOT_UPDATE = join(__dirname, "..", "firmware/pybot-ble-runtime/pybot_boot_update.py");

/**
 * MODELO FIEL del boot/update manager del firmware para validar en Node lo que NO
 * se puede probar con una ESP32 real:
 *   - pybot_boot_update.apply (apply transaccional + rollback, re-entrante).
 *   - RuntimeUpdateReceiver.apply (escribe pybot_update.json pending).
 *   - `_confirm_update_if_pending` (confirmación de arranque).
 *
 * Este modelo REPLICA la lógica del .py paso por paso (no un mock que evada lo que
 * se valida). Un filesystem en memoria con inyección de fallos de rename permite
 * ejercitar todos los caminos de apply/rollback y el modelo de corte de energía.
 * Los nombres de archivo y el orden de las operaciones son idénticos al firmware.
 */

const MAIN = "main.py";
const NEW = "pybot_runtime.new";
const BAK = "pybot_runtime.bak";
const STATE = "pybot_update.json";
const APP = "pybot_app.py";
const APP_META = "pybot_app.json";
const PACK_MAGIC = "PYBOTRT1\n";
const RUNTIME_FILES = [
  "main.py",
  "pybot_ble.py",
  "pybot_run.py",
  "pybot_deploy.py",
  "pybot_update.py",
  "pybot_boot_update.py",
  "pybot_repl.py",
  "pybot_rble.py",
  "pybot_net.py",
  "pybot_mpy.py",
];
const RTBAK = ".rtbak";
const COPY_CHUNK = 256;

function byteLen(s) {
  return new TextEncoder().encode(String(s ?? "")).length;
}

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  return new TextEncoder().encode(String(v ?? ""));
}

function bytesToUtf8(u8) {
  return new TextDecoder().decode(u8);
}

class Fs {
  constructor(initial = {}) {
    this.files = new Map(Object.entries(initial));
    this.failRename = new Set();
  }
  exists(p) {
    return this.files.has(p);
  }
  get(p) {
    const v = this.files.get(p);
    if (v instanceof Uint8Array) return bytesToUtf8(v);
    return v;
  }
  getBytes(p) {
    return asBytes(this.files.get(p));
  }
  size(p) {
    if (!this.files.has(p)) return -1;
    return asBytes(this.files.get(p)).length;
  }
  remove(p) {
    if (!this.files.has(p)) return false;
    this.files.delete(p);
    return true;
  }
  rename(src, dst) {
    if (!this.files.has(src)) return false;
    if (this.failRename.has(src + "->" + dst)) return false;
    this.files.set(dst, this.files.get(src));
    this.files.delete(src);
    return true;
  }
  readJson(p) {
    if (!this.files.has(p)) return null;
    try {
      const raw = this.get(p);
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }
  writeJson(p, obj) {
    this.files.set(p, JSON.stringify(obj));
    return true;
  }
}

// --- Mirror de boot.py -----------------------------------------------------

function _shaFile(fs, path, hasHashlib) {
  if (!hasHashlib || !fs.exists(path)) return null;
  return sha256Hex(fs.getBytes(path));
}

function _newValid(fs, size, hash, hasHashlib) {
  if (!fs.exists(NEW)) return false;
  if (size != null && fs.size(NEW) !== size) return false;
  if (hash) {
    const d = _shaFile(fs, NEW, hasHashlib);
    if (d === null || d !== hash) return false;
  }
  return true;
}

function _isPack(fs) {
  if (!fs.exists(NEW)) return false;
  const b = fs.getBytes(NEW);
  const magic = new TextEncoder().encode(PACK_MAGIC);
  if (b.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (b[i] !== magic[i]) return false;
  return true;
}

/** Simula lectura de body en chunks; actualiza stats.maxBodyRead. */
function _consumeBodyBytes(stats, sz) {
  let remaining = sz;
  while (remaining > 0) {
    const n = Math.min(COPY_CHUNK, remaining);
    if (stats) {
      stats.maxBodyRead = Math.max(stats.maxBodyRead ?? 0, n);
      stats.bodyReads = (stats.bodyReads ?? 0) + 1;
    }
    remaining -= n;
  }
}

/**
 * Pasada 1: metadata [(name,size)] sin bodies. Orden: validate antes de backup.
 */
function _validatePack(fs, stats) {
  const raw = fs.getBytes(NEW);
  const enc = new TextEncoder();
  const magic = enc.encode(PACK_MAGIC);
  if (raw.length < magic.length) return null;
  for (let i = 0; i < magic.length; i++) if (raw[i] !== magic[i]) return null;
  let off = magic.length;
  const meta = [];
  const dec = new TextDecoder();
  while (off < raw.length) {
    let nl = raw.indexOf(0x0a, off);
    if (nl < 0) return null;
    const name = dec.decode(raw.subarray(off, nl)).replace(/\r$/, "");
    off = nl + 1;
    nl = raw.indexOf(0x0a, off);
    if (nl < 0) return null;
    const sz = parseInt(dec.decode(raw.subarray(off, nl)).trim(), 10);
    off = nl + 1;
    if (!Number.isFinite(sz) || sz < 0 || sz > 200000) return null;
    if (!RUNTIME_FILES.includes(name)) return null;
    if (off + sz > raw.length) return null;
    _consumeBodyBytes(stats, sz);
    off += sz;
    meta.push([name, sz]);
  }
  return meta.length ? meta : null;
}

/**
 * Pasada 2: copia bodies por chunks al destino.
 */
function _installPackFiles(fs, meta, stats, opts = {}) {
  const raw = fs.getBytes(NEW);
  const enc = new TextEncoder();
  const magic = enc.encode(PACK_MAGIC);
  let off = magic.length;
  const dec = new TextDecoder();
  for (let i = 0; i < meta.length; i++) {
    if (opts.failCopyAt === i) throw new Error("copy fail");
    const [expectedName, expectedSz] = meta[i];
    let nl = raw.indexOf(0x0a, off);
    const name = dec.decode(raw.subarray(off, nl)).replace(/\r$/, "");
    off = nl + 1;
    nl = raw.indexOf(0x0a, off);
    const sz = parseInt(dec.decode(raw.subarray(off, nl)).trim(), 10);
    off = nl + 1;
    if (name !== expectedName || sz !== expectedSz) throw new Error("pack mismatch");
    const data = raw.subarray(off, off + sz);
    _consumeBodyBytes(stats, sz);
    // Guardar bytes exactos (fidelidad UTF-8 / binaria).
    fs.files.set(name, Uint8Array.from(data));
    off += sz;
  }
}

function _backupRuntime(fs, names) {
  for (const name of names) {
    const bak = name + RTBAK;
    fs.remove(bak);
    if (fs.exists(name) && !fs.rename(name, bak)) return false;
  }
  return true;
}

function _restoreRuntime(fs) {
  for (const name of RUNTIME_FILES) {
    const bak = name + RTBAK;
    if (fs.exists(bak)) {
      fs.remove(name);
      fs.rename(bak, name);
    }
  }
}

function _clearRtbaks(fs) {
  for (const name of RUNTIME_FILES) fs.remove(name + RTBAK);
}

function _applyPack(fs, st, size, hash, hasHashlib, opts = {}) {
  const stats = opts.stats ?? null;
  if (stats) {
    stats.order = [];
  }
  if (!_newValid(fs, size, hash, hasHashlib)) {
    if (fs.exists(MAIN)) {
      fs.remove(NEW);
      fs.remove(STATE);
    } else {
      _restoreRuntime(fs);
      if (fs.exists(BAK) && !fs.exists(MAIN)) fs.rename(BAK, MAIN);
      fs.remove(STATE);
    }
    return;
  }
  if (stats) stats.order.push("validate");
  const meta = _validatePack(fs, stats);
  if (!meta) {
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  const names = meta.map(([n]) => n);
  if (stats) stats.order.push("backup");
  if (!_backupRuntime(fs, names)) {
    _restoreRuntime(fs);
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  try {
    if (stats) stats.order.push("write");
    _installPackFiles(fs, meta, stats, opts);
  } catch {
    _restoreRuntime(fs);
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  st.state = "applied";
  st.pack = 1;
  fs.writeJson(STATE, st);
  fs.remove(NEW);
}

function _doApplyLegacy(fs, st, size, hash, hasHashlib) {
  // Re-entrada: main.py YA es el nuevo runtime -> no re-respaldar.
  if (hash && fs.exists(MAIN) && _shaFile(fs, MAIN, hasHashlib) === hash) {
    fs.remove(NEW);
    st.state = "applied";
    fs.writeJson(STATE, st);
    return;
  }
  if (!_newValid(fs, size, hash, hasHashlib)) {
    if (fs.exists(MAIN)) {
      fs.remove(NEW);
      fs.remove(STATE);
    } else if (fs.exists(BAK)) {
      fs.rename(BAK, MAIN);
      fs.remove(STATE);
    }
    return;
  }
  if (fs.exists(MAIN)) {
    fs.remove(BAK);
    if (!fs.rename(MAIN, BAK)) {
      fs.remove(NEW);
      fs.remove(STATE);
      return;
    }
  }
  if (!fs.rename(NEW, MAIN)) {
    if (!fs.exists(MAIN) && fs.exists(BAK)) fs.rename(BAK, MAIN);
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  st.state = "applied";
  fs.writeJson(STATE, st);
  fs.remove(NEW);
}

function _doApply(fs, st, size, hash, hasHashlib, opts = {}) {
  if (fs.exists(NEW) && _isPack(fs)) _applyPack(fs, st, size, hash, hasHashlib, opts);
  else _doApplyLegacy(fs, st, size, hash, hasHashlib);
}

function _doRollback(fs, st) {
  if (st.pack) {
    _restoreRuntime(fs);
    _clearRtbaks(fs);
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  if (fs.exists(BAK)) {
    fs.remove(MAIN);
    if (fs.rename(BAK, MAIN)) {
      fs.remove(STATE);
      return;
    }
  }
  fs.remove(NEW);
  st.state = "rollback_failed";
  fs.writeJson(STATE, st);
}

/** Mirror de boot.py `_boot_apply_update` (corre ANTES de main.py en cada boot). */
function boot(fs, { hasHashlib = true, ...opts } = {}) {
  const st = fs.readJson(STATE);
  if (!st || typeof st !== "object") {
    fs.remove(NEW); // limpiar .new huérfano de una descarga cortada
    return;
  }
  const state = st.state;
  const size = st.size ?? null;
  const hash = (st.hash || "").toLowerCase();
  if (state === "pending") _doApply(fs, st, size, hash, hasHashlib, opts);
  else if (state === "applied") _doRollback(fs, st);
}

/** Mirror de `_confirm_update_if_pending` (tras BLE+GATT operacionales). */
function confirmBoot(fs) {
  const st = fs.readJson(STATE);
  if (st && st.state === "applied") {
    fs.remove(BAK);
    _clearRtbaks(fs);
    fs.remove(STATE);
  }
}

function buildPack(files) {
  const enc = new TextEncoder();
  const parts = [enc.encode(PACK_MAGIC)];
  for (const [name, data] of files) {
    const body = asBytes(data);
    parts.push(enc.encode(name + "\n" + body.length + "\n"));
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

function packHash(pack) {
  return sha256Hex(asBytes(pack));
}

function packSize(pack) {
  return asBytes(pack).length;
}

/** Mirror de RuntimeUpdateReceiver.apply(): escribe el estado pending y "resetea". */
function webApply(fs, { from, to, size, hash }) {
  fs.writeJson(STATE, { state: "pending", from, to, size, hash });
}

const OLD = "# RUNTIME 3.1.0\nprint('old')\n";
const NEWR = "# RUNTIME 3.2.0\nprint('new')\n".repeat(30);
const APP_CODE = "salidaDigital(1, 1)\nwait(0.5)\n";
const APP_METADATA = { version: 3, mode: "eda6", profile: "WEMOS", autostart: true, size: byteLen(APP_CODE), hash: "abc" };

function boardWithApp(extra = {}) {
  return new Fs({
    [MAIN]: OLD,
    [APP]: APP_CODE,
    [APP_META]: JSON.stringify(APP_METADATA),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Ciclo completo exitoso + preservación de la APP del alumno
// ---------------------------------------------------------------------------

test("successful OTA: swap main.py, confirm boot, and PRESERVE the student app", () => {
  const fs = boardWithApp();
  // La web transfirió y verificó el .new (VERIFY:OK) y pidió APPLY:
  fs.files.set(NEW, NEWR);
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });

  boot(fs); // boot.py aplica el swap
  assert.equal(fs.get(MAIN), NEWR);
  assert.equal(fs.get(BAK), OLD); // backup para rollback
  assert.equal(fs.readJson(STATE).state, "applied");
  assert.equal(fs.exists(NEW), false);

  confirmBoot(fs); // el nuevo runtime arranca operacional y confirma
  assert.equal(fs.exists(BAK), false);
  assert.equal(fs.exists(STATE), false);

  // El programa del alumno y su metadata quedan EXACTAMENTE igual (nunca se tocan).
  assert.equal(fs.get(APP), APP_CODE);
  assert.deepEqual(fs.readJson(APP_META), APP_METADATA);
  assert.equal(fs.readJson(APP_META).autostart, true); // autostart preservado
});

// ---------------------------------------------------------------------------
// Boot manager: casos base
// ---------------------------------------------------------------------------

test("boot: no update in progress cleans an orphan .new, keeps main.py", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: "partial-download..." });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(NEW), false);
});

test("boot: pending + valid .new installs the new runtime", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), NEWR);
  assert.equal(fs.get(BAK), OLD);
  assert.equal(fs.readJson(STATE).state, "applied");
});

test("boot: pending + corrupt .new (hash mismatch) aborts, main.py intact", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR + "TAMPERED" });
  // El estado declara el hash del .new ORIGINAL (no el manipulado).
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD); // no se instaló nada corrupto
  assert.equal(fs.exists(BAK), false);
  assert.equal(fs.exists(STATE), false); // update abortado
});

test("boot: pending but .new missing aborts, keeps current runtime", () => {
  const fs = new Fs({ [MAIN]: OLD });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(STATE), false);
});

test("boot: confirmation missing on next boot -> ROLLBACK to backup", () => {
  // main.py = nuevo runtime que NUNCA confirmó; BAK = runtime anterior.
  const fs = new Fs({ [MAIN]: NEWR, [BAK]: OLD });
  fs.writeJson(STATE, { state: "applied", from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD); // restaurado el runtime conocido-bueno
  assert.equal(fs.exists(BAK), false);
  assert.equal(fs.exists(STATE), false); // sin boot-loop
});

// ---------------------------------------------------------------------------
// Modelo de corte de energía (power loss) en cada punto crítico
// ---------------------------------------------------------------------------

test("power loss DURING download (before verify): old runtime intact, .new cleaned", () => {
  // No hay estado pending todavía (se escribe recién en APPLY).
  const fs = new Fs({ [MAIN]: OLD, [NEW]: "half-runtime..." });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(NEW), false);
});

test("power loss AFTER verify, BEFORE apply: no pending state -> old runtime intact", () => {
  // .new completo y válido, pero el corte fue antes de APPLY (sin pybot_update.json).
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(NEW), false); // .new huérfano limpiado; se re-hará el update
});

test("power loss AFTER backup (main.py moved to .bak) is recoverable via re-entrant apply", () => {
  // Corte JUSTO después de main.py->bak y antes de new->main: main.py ausente.
  const fs = new Fs({ [BAK]: OLD, [NEW]: NEWR });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs); // re-entrada: main ausente + .new válido -> instala el nuevo
  assert.equal(fs.get(MAIN), NEWR);
  assert.equal(fs.readJson(STATE).state, "applied");
  confirmBoot(fs);
  assert.equal(fs.exists(BAK), false);
});

test("power loss after backup with UNUSABLE .new restores the previous runtime from backup", () => {
  // main.py ausente, .new inservible (falta), pero hay backup -> restaurar.
  const fs = new Fs({ [BAK]: OLD });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD); // runtime anterior restaurado
  assert.equal(fs.exists(STATE), false);
});

test("power loss AFTER rename (main.py already new), state still pending: re-entrant, no double backup", () => {
  // main.py ya ES el nuevo (rename new->main ocurrió); el corte fue antes de
  // marcar 'applied'. El backup NO debe sobrescribirse con el runtime nuevo.
  const fs = new Fs({ [MAIN]: NEWR, [BAK]: OLD });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), NEWR);
  assert.equal(fs.get(BAK), OLD); // backup del runtime ANTERIOR preservado (rollback posible)
  assert.equal(fs.readJson(STATE).state, "applied");
});

test("power loss BEFORE confirmation -> next boot rolls back (never a broken runtime)", () => {
  // Aplicado (main=nuevo, bak=viejo, state applied) pero el nuevo runtime no llegó
  // a confirmar (p.ej. crash al importar). El siguiente boot revierte.
  const fs = new Fs({ [MAIN]: NEWR, [BAK]: OLD });
  fs.writeJson(STATE, { state: "applied", from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(STATE), false);
});

// ---------------------------------------------------------------------------
// Robustez del apply ante fallos de rename (backup no se puede crear)
// ---------------------------------------------------------------------------

test("apply aborts safely if backing up main.py fails (main.py never lost)", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR });
  fs.failRename.add(MAIN + "->" + BAK); // no se puede respaldar
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD); // runtime actual conservado
  assert.equal(fs.exists(STATE), false); // update abortado, sin loop
});

test("apply restores backup if new->main rename fails after backup", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR });
  fs.failRename.add(NEW + "->" + MAIN); // el swap falla tras el backup
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), OLD); // main.py restaurado desde el backup
  assert.equal(fs.exists(STATE), false);
});

// ---------------------------------------------------------------------------
// La APP del alumno se preserva ante un update interrumpido/roto
// ---------------------------------------------------------------------------

test("student app + metadata survive a corrupt/aborted OTA untouched", () => {
  const fs = boardWithApp({ [NEW]: NEWR + "X" });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs); // hash no coincide -> aborta
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.get(APP), APP_CODE);
  assert.deepEqual(fs.readJson(APP_META), APP_METADATA);
});

// ---------------------------------------------------------------------------
// Pack multi-archivo (runtime 3.2+)
// ---------------------------------------------------------------------------

test("successful OTA pack: installs modules, confirms, preserves student app", () => {
  const pack = buildPack([
    ["main.py", "import pybot_ble\npybot_ble.main()\n"],
    ["pybot_ble.py", "PYBOT_RUNTIME_VERSION='3.2.1'\n"],
    ["pybot_run.py", "# run\n"],
    ["pybot_deploy.py", "# deploy\n"],
    ["pybot_update.py", "# update\n"],
    ["pybot_boot_update.py", "# boot update\n"],
  ]);
  const fs = boardWithApp({
    "pybot_ble.py": "OLD_CORE\n",
    "pybot_run.py": "OLD_RUN\n",
  });
  fs.files.set(NEW, pack);
  webApply(fs, { from: "3.2.0", to: "3.2.1", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  assert.equal(fs.get(MAIN), "import pybot_ble\npybot_ble.main()\n");
  assert.equal(fs.get("pybot_ble.py"), "PYBOT_RUNTIME_VERSION='3.2.1'\n");
  assert.equal(fs.get("pybot_run.py"), "# run\n");
  assert.equal(fs.readJson(STATE).pack, 1);
  assert.equal(fs.exists(MAIN + RTBAK), true);
  confirmBoot(fs);
  assert.equal(fs.exists(STATE), false);
  assert.equal(fs.exists(MAIN + RTBAK), false);
  assert.equal(fs.get(APP), APP_CODE);
});

test("pack OTA without confirm rolls back modules from .rtbak", () => {
  const full = buildPack([
    ["main.py", "NEW_MAIN\n"],
    ["pybot_ble.py", "NEW_CORE\n"],
    ["pybot_run.py", "NEW_RUN\n"],
    ["pybot_deploy.py", "NEW_DEP\n"],
    ["pybot_update.py", "NEW_UPD\n"],
    ["pybot_boot_update.py", "NEW_BU\n"],
  ]);
  const fs = new Fs({
    [MAIN]: "OLD_MAIN\n",
    "pybot_ble.py": "OLD_CORE\n",
    "pybot_run.py": "OLD_RUN\n",
    [NEW]: full,
  });
  webApply(fs, { from: "3.2.0", to: "3.2.1", size: packSize(full), hash: packHash(full) });
  boot(fs);
  assert.equal(fs.get(MAIN), "NEW_MAIN\n");
  assert.equal(fs.readJson(STATE).state, "applied");
  // Sin confirm: siguiente boot hace rollback pack.
  boot(fs);
  assert.equal(fs.get(MAIN), "OLD_MAIN\n");
  assert.equal(fs.get("pybot_ble.py"), "OLD_CORE\n");
  assert.equal(fs.get("pybot_run.py"), "OLD_RUN\n");
  assert.equal(fs.exists(STATE), false);
});

// ---------------------------------------------------------------------------
// #17 — boot updater: streaming de bodies (sin cargar pack completo en RAM)
// ---------------------------------------------------------------------------

test("#17 pack exitoso: módulos, state applied, rtbak, confirm limpia", () => {
  const pack = buildPack([
    ["main.py", "M1\n"],
    ["pybot_ble.py", "B1\n"],
    ["pybot_run.py", "R1\n"],
    ["pybot_deploy.py", "D1\n"],
    ["pybot_update.py", "U1\n"],
    ["pybot_boot_update.py", "BU1\n"],
  ]);
  const fs = boardWithApp({
    "pybot_ble.py": "OLD_B\n",
    "pybot_run.py": "OLD_R\n",
    [NEW]: pack,
  });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  assert.equal(fs.get(MAIN), "M1\n");
  assert.equal(fs.get("pybot_ble.py"), "B1\n");
  assert.equal(fs.get("pybot_run.py"), "R1\n");
  assert.equal(fs.readJson(STATE).state, "applied");
  assert.equal(fs.readJson(STATE).pack, 1);
  assert.equal(fs.exists(MAIN + RTBAK), true);
  assert.equal(fs.exists("pybot_ble.py" + RTBAK), true);
  confirmBoot(fs);
  assert.equal(fs.exists(STATE), false);
  assert.equal(fs.exists(MAIN + RTBAK), false);
  assert.equal(fs.exists("pybot_ble.py" + RTBAK), false);
});

test("#17 módulo grande (>=80KB): maxBodyRead <= COPY_CHUNK", () => {
  const big = "X".repeat(80 * 1024);
  const pack = buildPack([
    ["main.py", "tiny\n"],
    ["pybot_ble.py", big],
    ["pybot_run.py", "end\n"],
  ]);
  const stats = {};
  const fs = new Fs({
    [MAIN]: "OLD\n",
    "pybot_ble.py": "OLD_B\n",
    "pybot_run.py": "OLD_R\n",
    [NEW]: pack,
  });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs, { stats });
  assert.equal(fs.get("pybot_ble.py"), big);
  assert.ok((stats.maxBodyRead ?? 0) <= COPY_CHUNK);
  assert.equal(stats.maxBodyRead, COPY_CHUNK);
  assert.ok((stats.bodyReads ?? 0) >= Math.ceil((80 * 1024) / COPY_CHUNK));
});

test("#17 firmware: no f.read(sz) ni lista de bodies en camino pack", () => {
  const src = readFileSync(FW_BOOT_UPDATE, "utf8");
  assert.match(src, /_COPY_CHUNK\s*=\s*256/);
  assert.match(src, /def _validate_pack\(/);
  assert.match(src, /def _install_pack_files\(/);
  assert.match(src, /def _skip_bytes\(/);
  assert.match(src, /def _copy_bytes\(/);
  assert.doesNotMatch(src, /files\.append\(\(name,\s*data\)\)/);
  assert.doesNotMatch(src, /data\s*=\s*f\.read\(sz\)/);
  assert.doesNotMatch(src, /data\s*=\s*src\.read\(sz\)/);
  assert.doesNotMatch(src, /def _parse_pack\(/);
  // Bodies solo vía min(_COPY_CHUNK, remaining)
  assert.match(src, /\.read\(min\(_COPY_CHUNK,\s*remaining\)\)/);
});

test("#17 pack truncado: falla antes de backup; runtime intacto", () => {
  const enc = new TextEncoder();
  const body = enc.encode("hello");
  // Declara size=1000 pero solo entrega 5 bytes.
  const bad = new Uint8Array([
    ...enc.encode(PACK_MAGIC),
    ...enc.encode("main.py\n1000\n"),
    ...body,
  ]);
  const stats = {};
  const fs = new Fs({ [MAIN]: OLD, [NEW]: bad });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: bad.length, hash: sha256Hex(bad) });
  boot(fs, { stats });
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(MAIN + RTBAK), false);
  assert.equal(fs.exists(STATE), false);
  assert.deepEqual(stats.order, ["validate"]); // sin backup/write
});

test("#17 nombre inválido evil.py: rechazo antes de modificar runtime", () => {
  const enc = new TextEncoder();
  const body = enc.encode("x");
  const evil = new Uint8Array([
    ...enc.encode(PACK_MAGIC),
    ...enc.encode("evil.py\n1\n"),
    ...body,
  ]);
  const stats = {};
  const fs = new Fs({ [MAIN]: OLD, "pybot_ble.py": "B\n", [NEW]: evil });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: evil.length, hash: sha256Hex(evil) });
  boot(fs, { stats });
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.get("pybot_ble.py"), "B\n");
  assert.equal(fs.exists(MAIN + RTBAK), false);
  assert.equal(fs.exists(STATE), false);
  assert.deepEqual(stats.order, ["validate"]);
});

test("#17 size inválido: no numérico / negativo / >200000", () => {
  const enc = new TextEncoder();
  function packWithSizeLine(sizeLine, body = "x") {
    const b = enc.encode(body);
    return new Uint8Array([
      ...enc.encode(PACK_MAGIC),
      ...enc.encode("main.py\n" + sizeLine + "\n"),
      ...b,
    ]);
  }
  for (const sizeLine of ["abc", "-1", "200001"]) {
    const bad = packWithSizeLine(sizeLine, sizeLine === "abc" || sizeLine === "-1" ? "x" : "x");
    // Para >200000 el body no importa (falla en parse de size).
    const payload =
      sizeLine === "200001"
        ? new Uint8Array([...enc.encode(PACK_MAGIC), ...enc.encode("main.py\n200001\n"), ...enc.encode("x")])
        : bad;
    const fs = new Fs({ [MAIN]: OLD, [NEW]: payload });
    webApply(fs, { from: "4.0.6", to: "4.0.6", size: payload.length, hash: sha256Hex(payload) });
    boot(fs);
    assert.equal(fs.get(MAIN), OLD, `sizeLine=${sizeLine}`);
    assert.equal(fs.exists(STATE), false, `sizeLine=${sizeLine}`);
  }
});

test("#17 magic incorrecto: no se trata como pack (camino legacy)", () => {
  const fake = "NOTAPACK\nmain.py\n3\nabc";
  const fs = new Fs({ [MAIN]: OLD, [NEW]: fake });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(fake), hash: sha256HexUtf8(fake) });
  boot(fs);
  // Legacy: renombra .new -> main.py
  assert.equal(fs.get(MAIN), fake);
  assert.equal(fs.get(BAK), OLD);
  assert.equal(fs.readJson(STATE).pack, undefined);
});

test("#17 fallo en backup: ningún runtime nuevo instalado", () => {
  const pack = buildPack([
    ["main.py", "NEW_M\n"],
    ["pybot_ble.py", "NEW_B\n"],
  ]);
  const fs = new Fs({
    [MAIN]: "OLD_M\n",
    "pybot_ble.py": "OLD_B\n",
    [NEW]: pack,
  });
  fs.failRename.add(MAIN + "->" + MAIN + RTBAK);
  const stats = {};
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs, { stats });
  assert.equal(fs.get(MAIN), "OLD_M\n");
  assert.equal(fs.get("pybot_ble.py"), "OLD_B\n");
  assert.equal(fs.exists(STATE), false);
  assert.deepEqual(stats.order, ["validate", "backup"]);
});

test("#17 fallo durante copia del primer archivo: restore + abort", () => {
  const pack = buildPack([
    ["main.py", "NEW_M\n"],
    ["pybot_ble.py", "NEW_B\n"],
  ]);
  const fs = new Fs({
    [MAIN]: "OLD_M\n",
    "pybot_ble.py": "OLD_B\n",
    [NEW]: pack,
  });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs, { failCopyAt: 0 });
  assert.equal(fs.get(MAIN), "OLD_M\n");
  assert.equal(fs.get("pybot_ble.py"), "OLD_B\n");
  assert.equal(fs.exists(STATE), false);
  assert.equal(fs.exists(NEW), false);
});

test("#17 fallo durante módulo posterior: rollback restaura previos", () => {
  const pack = buildPack([
    ["main.py", "NEW_M\n"],
    ["pybot_ble.py", "NEW_B\n"],
    ["pybot_run.py", "NEW_R\n"],
  ]);
  const fs = new Fs({
    [MAIN]: "OLD_M\n",
    "pybot_ble.py": "OLD_B\n",
    "pybot_run.py": "OLD_R\n",
    [NEW]: pack,
  });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs, { failCopyAt: 1 }); // falla en segundo módulo
  assert.equal(fs.get(MAIN), "OLD_M\n");
  assert.equal(fs.get("pybot_ble.py"), "OLD_B\n");
  assert.equal(fs.get("pybot_run.py"), "OLD_R\n");
  assert.equal(fs.exists(STATE), false);
});

test("#17 bytes UTF-8 idénticos (—, á, º)", () => {
  const text = "# net — café á º\n";
  const pack = buildPack([
    ["main.py", "ok\n"],
    ["pybot_net.py", text],
  ]);
  const fs = new Fs({ [MAIN]: OLD, [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  const got = fs.getBytes("pybot_net.py");
  const expect = new TextEncoder().encode(text);
  assert.equal(got.length, expect.length);
  for (let i = 0; i < expect.length; i++) assert.equal(got[i], expect[i]);
});

test("#17 archivo vacío size=0 permitido", () => {
  const pack = buildPack([
    ["main.py", ""],
    ["pybot_ble.py", "x\n"],
  ]);
  const fs = new Fs({ [MAIN]: OLD, "pybot_ble.py": "old\n", [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  assert.equal(fs.size(MAIN), 0);
  assert.equal(fs.get("pybot_ble.py"), "x\n");
});

test("#17 múltiples módulos: límites exactos, sin consumir bytes del siguiente", () => {
  const pack = buildPack([
    ["main.py", "AAA"],
    ["pybot_ble.py", "BBBB"],
    ["pybot_run.py", "C"],
  ]);
  const fs = new Fs({ [MAIN]: "o", "pybot_ble.py": "o", "pybot_run.py": "o", [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  assert.equal(fs.get(MAIN), "AAA");
  assert.equal(fs.get("pybot_ble.py"), "BBBB");
  assert.equal(fs.get("pybot_run.py"), "C");
});

test("#17 student app intacta durante pack OTA", () => {
  const pack = buildPack([
    ["main.py", "N\n"],
    ["pybot_ble.py", "N\n"],
  ]);
  const fs = boardWithApp({ [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs);
  confirmBoot(fs);
  assert.equal(fs.get(APP), APP_CODE);
  assert.deepEqual(fs.readJson(APP_META), APP_METADATA);
});

test("#17 orden: validate completo BEFORE backup BEFORE write", () => {
  const pack = buildPack([
    ["main.py", "N\n"],
    ["pybot_ble.py", "N\n"],
  ]);
  const stats = {};
  const fs = new Fs({ [MAIN]: OLD, "pybot_ble.py": "B\n", [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: packHash(pack) });
  boot(fs, { stats });
  assert.deepEqual(stats.order, ["validate", "backup", "write"]);
});

test("#17 SHA exterior incorrecto aborta antes de parse/apply", () => {
  const pack = buildPack([["main.py", "N\n"]]);
  const stats = {};
  const fs = new Fs({ [MAIN]: OLD, [NEW]: pack });
  webApply(fs, { from: "4.0.6", to: "4.0.6", size: packSize(pack), hash: "00".repeat(32) });
  boot(fs, { stats });
  assert.equal(fs.get(MAIN), OLD);
  assert.equal(fs.exists(STATE), false);
  // SHA exterior falla antes de validate/backup/write.
  assert.deepEqual(stats.order, []);
});

test("#17 legacy apply intacto (casos base siguen pasando vía NEWR)", () => {
  const fs = new Fs({ [MAIN]: OLD, [NEW]: NEWR });
  webApply(fs, { from: "3.1.0", to: "3.2.0", size: byteLen(NEWR), hash: sha256HexUtf8(NEWR) });
  boot(fs);
  assert.equal(fs.get(MAIN), NEWR);
  assert.equal(fs.get(BAK), OLD);
});
