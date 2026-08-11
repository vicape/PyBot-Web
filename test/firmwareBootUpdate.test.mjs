import { test } from "node:test";
import assert from "node:assert/strict";

import { sha256HexUtf8 } from "../src/bleProtocol.js";

/**
 * MODELO FIEL del boot/update manager del firmware para validar en Node lo que NO
 * se puede probar con una ESP32 real:
 *   - boot.py `_boot_apply_update` (apply transaccional + rollback, re-entrante).
 *   - main.py `RuntimeUpdateReceiver.apply` (escribe pybot_update.json pending).
 *   - main.py `_confirm_update_if_pending` (confirmación de arranque).
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

function _doApply(fs, st, size, hash, hasHashlib) {
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

function _doRollback(fs, st) {
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

/** Mirror de main.py `_confirm_update_if_pending` (tras BLE+GATT operacionales). */
function confirmBoot(fs) {
  const st = fs.readJson(STATE);
  if (st && st.state === "applied") {
    fs.remove(BAK);
    fs.remove(STATE);
  }
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
