import { test } from "node:test";
import assert from "node:assert/strict";

import { sha256HexUtf8 } from "../src/bleProtocol.js";

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
];
const RTBAK = ".rtbak";

function byteLen(s) {
  return new TextEncoder().encode(String(s ?? "")).length;
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
    return this.files.get(p);
  }
  size(p) {
    return this.files.has(p) ? byteLen(this.files.get(p)) : -1;
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
      const obj = JSON.parse(this.files.get(p));
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
  return sha256HexUtf8(fs.get(path));
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
  return String(fs.get(NEW) ?? "").startsWith(PACK_MAGIC);
}

function _parsePack(fs) {
  const raw = String(fs.get(NEW) ?? "");
  if (!raw.startsWith(PACK_MAGIC)) return null;
  let rest = raw.slice(PACK_MAGIC.length);
  const files = [];
  while (rest.length) {
    const nli = rest.indexOf("\n");
    if (nli < 0) return null;
    const name = rest.slice(0, nli);
    rest = rest.slice(nli + 1);
    const sli = rest.indexOf("\n");
    if (sli < 0) return null;
    const sz = parseInt(rest.slice(0, sli), 10);
    rest = rest.slice(sli + 1);
    if (!Number.isFinite(sz) || sz < 0 || rest.length < sz) return null;
    if (!RUNTIME_FILES.includes(name)) return null;
    files.push([name, rest.slice(0, sz)]);
    rest = rest.slice(sz);
  }
  return files.length ? files : null;
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

function _applyPack(fs, st, size, hash, hasHashlib) {
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
  const files = _parsePack(fs);
  if (!files) {
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  const names = files.map(([n]) => n);
  if (!_backupRuntime(fs, names)) {
    _restoreRuntime(fs);
    fs.remove(NEW);
    fs.remove(STATE);
    return;
  }
  for (const [name, data] of files) fs.files.set(name, data);
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

function _doApply(fs, st, size, hash, hasHashlib) {
  if (fs.exists(NEW) && _isPack(fs)) _applyPack(fs, st, size, hash, hasHashlib);
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
function boot(fs, { hasHashlib = true } = {}) {
  const st = fs.readJson(STATE);
  if (!st || typeof st !== "object") {
    fs.remove(NEW); // limpiar .new huérfano de una descarga cortada
    return;
  }
  const state = st.state;
  const size = st.size ?? null;
  const hash = (st.hash || "").toLowerCase();
  if (state === "pending") _doApply(fs, st, size, hash, hasHashlib);
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
  let out = PACK_MAGIC;
  for (const [name, data] of files) {
    out += name + "\n" + byteLen(data) + "\n" + data;
  }
  return out;
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
  webApply(fs, { from: "3.2.0", to: "3.2.1", size: byteLen(pack), hash: sha256HexUtf8(pack) });
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
  webApply(fs, { from: "3.2.0", to: "3.2.1", size: byteLen(full), hash: sha256HexUtf8(full) });
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
