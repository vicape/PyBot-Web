import { test } from "node:test";
import assert from "node:assert/strict";

import { sha256HexUtf8 } from "../src/bleProtocol.js";

/**
 * MODELO FIEL del firmware (firmware/pybot-ble-runtime/main.py) para validar,
 * en Node, la parte que NO se puede probar con una ESP32 real:
 *   - DeployReceiver.end() + _atomic_install_app(): reemplazo transaccional con
 *     backup/rollback (P0-8), hash obligatorio si se declara (P0-9).
 *   - _delete_app(): borra + verifica ausencia (P0-10 / DELETE_FAILED).
 *   - APP:STOP / APP:DELETE con confirmacion diferida (P0-4A): el ACK significa
 *     "detenida de verdad", no "pedido recibido".
 *
 * Este modelo REPLICA la logica del .py paso por paso (no un mock que evada lo que
 * se valida). Un filesystem en memoria permite inyectar fallos de rename/write
 * para ejercitar los caminos de rollback. Los nombres de archivo y el orden de las
 * operaciones son identicos al firmware.
 */

const APP = "pybot_app.py";
const TMP = "pybot_app.tmp";
const BAK = "pybot_app.bak";
const META = "pybot_app.json";
const META_TMP = "pybot_app.json.tmp";
const META_BAK = "pybot_app.json.bak";
const STATE = "pybot_state.json";

function byteLen(s) {
  return new TextEncoder().encode(String(s ?? "")).length;
}

/** Filesystem en memoria con inyeccion de fallos (mirror de os.* + helpers .py). */
class Fs {
  constructor(initial = {}) {
    this.files = new Map(Object.entries(initial));
    this.failRename = new Set(); // pares "src->dst" cuyo rename debe fallar
    this.failWrite = new Set(); // paths cuyo write_json debe fallar
  }
  exists(p) {
    return this.files.has(p);
  }
  size(p) {
    return this.files.has(p) ? byteLen(this.files.get(p)) : -1;
  }
  remove(p) {
    // _remove: True si borro, False si no existia/fallo (best-effort).
    if (!this.files.has(p)) return false;
    this.files.delete(p);
    return true;
  }
  rename(src, dst) {
    // _rename: os.rename envuelto en try/except -> True/False.
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
    if (this.failWrite.has(p)) return false;
    this.files.set(p, JSON.stringify(obj));
    return true;
  }
}

/** Mirror de _atomic_install_app(meta, expected_size). */
function atomicInstallApp(fs, meta, expectedSize) {
  fs.remove(META_TMP);
  if (!fs.writeJson(META_TMP, meta) || fs.readJson(META_TMP) === null) {
    fs.remove(META_TMP);
    return false;
  }
  const hadApp = fs.exists(APP);
  const hadMeta = fs.exists(META);
  fs.remove(BAK);
  fs.remove(META_BAK);

  if (hadApp && !fs.rename(APP, BAK)) {
    fs.remove(META_TMP);
    return false;
  }
  if (!fs.rename(TMP, APP)) {
    if (hadApp) fs.rename(BAK, APP);
    fs.remove(META_TMP);
    return false;
  }
  if (hadMeta) fs.rename(META, META_BAK);
  if (!fs.rename(META_TMP, META)) {
    fs.remove(APP);
    if (hadApp) fs.rename(BAK, APP);
    if (hadMeta) fs.rename(META_BAK, META);
    fs.remove(META_TMP);
    return false;
  }
  if (fs.size(APP) !== expectedSize || fs.readJson(META) === null) {
    fs.remove(APP);
    fs.remove(META);
    if (hadApp) fs.rename(BAK, APP);
    if (hadMeta) fs.rename(META_BAK, META);
    return false;
  }
  fs.remove(BAK);
  fs.remove(META_BAK);
  const st = fs.readJson(STATE) || {};
  st.fail_count = 0;
  st.last_error = "";
  st.safe_boot = false;
  fs.writeJson(STATE, st);
  return true;
}

/** Mirror de _delete_app(). */
function deleteApp(fs) {
  fs.remove(TMP);
  fs.remove(BAK);
  fs.remove(META_TMP);
  fs.remove(META_BAK);
  if (fs.exists(APP)) fs.remove(APP);
  if (fs.exists(META)) fs.remove(META);
  const st = fs.readJson(STATE) || {};
  st.fail_count = 0;
  st.last_error = "";
  st.safe_boot = false;
  fs.writeJson(STATE, st);
  if (fs.exists(APP) || fs.exists(META)) return false;
  return true;
}

/**
 * Mirror de DeployReceiver.end(): asume que los chunks ya se escribieron en TMP.
 * Devuelve el frame que enviaria el firmware.
 */
function deployEnd(fs, { declaredSize, declaredHash, hasUhashlib, mode = "mpy", profile = "WEMOS" }) {
  const actual = fs.size(TMP);
  if (actual !== declaredSize) {
    fs.remove(TMP);
    return "DEPLOY:ERROR:VERIFY_FAILED";
  }
  if (declaredHash) {
    const digest = hasUhashlib ? sha256HexUtf8(fs.files.get(TMP)) : null;
    if (digest === null) {
      fs.remove(TMP);
      return "DEPLOY:ERROR:HASH_UNAVAILABLE";
    }
    if (digest !== declaredHash) {
      fs.remove(TMP);
      return "DEPLOY:ERROR:BAD_HASH";
    }
  }
  const meta = {
    version: 3,
    mode,
    profile,
    autostart: true,
    size: declaredSize,
    hash: declaredHash,
    runtime: "3.0.1",
  };
  if (!atomicInstallApp(fs, meta, declaredSize)) {
    fs.remove(TMP);
    return "DEPLOY:ERROR:WRITE_FAILED";
  }
  return "DEPLOY:VERIFY:OK";
}

/** Mirror del ProgramManager + _handle_app para APP:STOP / APP:DELETE / finish. */
class Board {
  constructor(fs, { running = false, persistent = false } = {}) {
    this.fs = fs;
    this.running = running;
    this.persistent = persistent;
    this.appAck = null;
  }
  handleApp(cmd) {
    if (cmd === "APP:STOP") {
      // 3.2.5: cualquier exec (no solo persistent) → ACK diferido.
      if (this.running) {
        this.appAck = "stop"; // diferido: sin respuesta inmediata
        return null;
      }
      return "APP:OK:STOP";
    }
    if (cmd === "APP:DELETE") {
      if (this.running && this.persistent) {
        this.appAck = "delete";
        return null;
      }
      return deleteApp(this.fs) ? "APP:OK:DELETE" : "APP:ERROR:DELETE_FAILED";
    }
    return "APP:ERROR:BAD_FRAME";
  }
  /** Mirror de _finish(): la app persistente realmente termino/paro. */
  finishRun(outcome) {
    const frames = [outcome === "stopped" ? "RUN:STOPPED" : "RUN:DONE"];
    this.running = false;
    const ack = this.appAck;
    this.appAck = null;
    if (ack === "stop") {
      frames.push("APP:OK:STOP");
    } else if (ack === "delete") {
      frames.push(deleteApp(this.fs) ? "APP:OK:DELETE" : "APP:ERROR:DELETE_FAILED");
    }
    return frames;
  }
}

// ---------------------------------------------------------------------------
// DEPLOY transaccional (P0-8)
// ---------------------------------------------------------------------------

test("deploy on empty board installs app + metadata atomically", () => {
  const fs = new Fs();
  const code = "salidaDigital(1,1)\n";
  fs.files.set(TMP, code);
  const r = deployEnd(fs, { declaredSize: byteLen(code), declaredHash: sha256HexUtf8(code), hasUhashlib: true, mode: "eda6" });
  assert.equal(r, "DEPLOY:VERIFY:OK");
  assert.equal(fs.files.get(APP), code);
  assert.equal(fs.readJson(META).mode, "eda6");
  assert.equal(fs.exists(TMP), false);
  assert.equal(fs.exists(BAK), false);
  assert.equal(fs.exists(META_BAK), false);
});

test("rename tmp->app fails: previous VALID app is restored (never left without app)", () => {
  const old = "OLD_APP = 1\n";
  const oldMeta = { version: 3, mode: "mpy", profile: "WEMOS", autostart: true, size: byteLen(old), hash: "old" };
  const fs = new Fs({ [APP]: old, [META]: JSON.stringify(oldMeta) });
  const nueva = "NUEVA = 2\n";
  fs.files.set(TMP, nueva);
  fs.failRename.add(TMP + "->" + APP); // el paso tmp->app falla (el rollback BAK->APP sí puede)

  const r = deployEnd(fs, { declaredSize: byteLen(nueva), declaredHash: sha256HexUtf8(nueva), hasUhashlib: true });
  assert.equal(r, "DEPLOY:ERROR:WRITE_FAILED");
  // App y metadata ANTERIORES intactas y correspondientes.
  assert.equal(fs.files.get(APP), old);
  assert.equal(fs.readJson(META).hash, "old");
  assert.equal(fs.exists(TMP), false);
});

test("metadata activation fails: app AND metadata roll back (never new+old mismatch)", () => {
  const old = "OLD = 1\n";
  const oldMeta = { version: 3, mode: "mpy", profile: "WEMOS", autostart: true, size: byteLen(old), hash: "old" };
  const fs = new Fs({ [APP]: old, [META]: JSON.stringify(oldMeta) });
  const nueva = "NUEVA = 22\n";
  fs.files.set(TMP, nueva);
  fs.failRename.add(META_TMP + "->" + META); // activar metadata nueva falla (rollback META_BAK->META sí puede)

  const r = deployEnd(fs, { declaredSize: byteLen(nueva), declaredHash: sha256HexUtf8(nueva), hasUhashlib: true });
  assert.equal(r, "DEPLOY:ERROR:WRITE_FAILED");
  // Programa y metadata SIEMPRE se corresponden: la vieja quedo intacta.
  assert.equal(fs.files.get(APP), old);
  assert.equal(fs.readJson(META).hash, "old");
});

test("metadata tmp write fails: previous app intact, no partial state", () => {
  const old = "OLD = 1\n";
  const fs = new Fs({ [APP]: old });
  const nueva = "N = 3\n";
  fs.files.set(TMP, nueva);
  fs.failWrite.add(META_TMP);
  const r = deployEnd(fs, { declaredSize: byteLen(nueva), declaredHash: sha256HexUtf8(nueva), hasUhashlib: true });
  assert.equal(r, "DEPLOY:ERROR:WRITE_FAILED");
  assert.equal(fs.files.get(APP), old);
});

test("corrupt tmp (size mismatch) keeps previous app intact -> VERIFY_FAILED", () => {
  const old = "OLD = 1\n";
  const fs = new Fs({ [APP]: old });
  const nueva = "N = 3\n";
  fs.files.set(TMP, nueva);
  const r = deployEnd(fs, { declaredSize: byteLen(nueva) + 5, declaredHash: sha256HexUtf8(nueva), hasUhashlib: true });
  assert.equal(r, "DEPLOY:ERROR:VERIFY_FAILED");
  assert.equal(fs.files.get(APP), old);
  assert.equal(fs.exists(TMP), false);
});

test("wrong hash keeps previous app intact -> BAD_HASH", () => {
  const old = "OLD = 1\n";
  const fs = new Fs({ [APP]: old });
  const nueva = "N = 3\n";
  fs.files.set(TMP, nueva);
  const r = deployEnd(fs, { declaredSize: byteLen(nueva), declaredHash: sha256HexUtf8("otra cosa"), hasUhashlib: true });
  assert.equal(r, "DEPLOY:ERROR:BAD_HASH");
  assert.equal(fs.files.get(APP), old);
});

// ---------------------------------------------------------------------------
// HASH obligatorio si se declara VERIFY (P0-9)
// ---------------------------------------------------------------------------

test("hash declared but uhashlib unavailable -> HASH_UNAVAILABLE (never VERIFY:OK)", () => {
  const old = "OLD = 1\n";
  const fs = new Fs({ [APP]: old });
  const nueva = "N = 3\n";
  fs.files.set(TMP, nueva);
  const r = deployEnd(fs, { declaredSize: byteLen(nueva), declaredHash: sha256HexUtf8(nueva), hasUhashlib: false });
  assert.equal(r, "DEPLOY:ERROR:HASH_UNAVAILABLE");
  // No se afirmo una verificacion que no ocurrio: app anterior intacta.
  assert.equal(fs.files.get(APP), old);
  assert.equal(fs.exists(TMP), false);
});

// ---------------------------------------------------------------------------
// DELETE seguro (P0-10)
// ---------------------------------------------------------------------------

test("delete removes app+metadata and verifies absence -> OK", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  const board = new Board(fs, { running: false });
  const resp = board.handleApp("APP:DELETE");
  assert.equal(resp, "APP:OK:DELETE");
  assert.equal(fs.exists(APP), false);
  assert.equal(fs.exists(META), false);
});

test("delete that cannot remove the file reports DELETE_FAILED (no fake success)", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  // Simular que APP no se puede borrar: remove() lo deja presente.
  fs.remove = (p) => {
    if (p === APP) return false; // no se pudo borrar
    return Fs.prototype.remove.call(fs, p);
  };
  const board = new Board(fs, { running: false });
  const resp = board.handleApp("APP:DELETE");
  assert.equal(resp, "APP:ERROR:DELETE_FAILED");
  assert.equal(fs.exists(APP), true); // sigue presente: no hubo exito ficticio
});

// ---------------------------------------------------------------------------
// APP:STOP / APP:DELETE confirmados de verdad (P0-4A)
// ---------------------------------------------------------------------------

test("APP:STOP with nothing persistent running acks immediately (already stopped)", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  const board = new Board(fs, { running: false, persistent: false });
  assert.equal(board.handleApp("APP:STOP"), "APP:OK:STOP");
});

test("APP:STOP on a running app defers APP:OK:STOP until it truly stops", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  // App corriendo (p.ej. arrancada por autostart ANTES de la sesion web).
  const board = new Board(fs, { running: true, persistent: true });
  const immediate = board.handleApp("APP:STOP");
  assert.equal(immediate, null); // NO se confirma antes de parar
  // Cuando la app cede al STOP cooperativo y termina:
  const frames = board.finishRun("stopped");
  assert.deepEqual(frames, ["RUN:STOPPED", "APP:OK:STOP"]);
  assert.equal(board.running, false);
});

test("non-cooperative app never fake-acks APP:STOP (web must escalate to FORCE)", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  const board = new Board(fs, { running: true, persistent: true });
  assert.equal(board.handleApp("APP:STOP"), null);
  // El bucle no cede: finishRun NUNCA se invoca -> no hay APP:OK:STOP. La web
  // detecta el timeout y escala a STOP:FORCE (reset). Aqui verificamos que el
  // firmware no minitio una confirmacion.
  assert.equal(board.appAck, "stop");
});

test("APP:DELETE on a running app stops first, then deletes and acks", () => {
  const fs = new Fs({ [APP]: "x=1\n", [META]: JSON.stringify({ version: 3 }) });
  const board = new Board(fs, { running: true, persistent: true });
  assert.equal(board.handleApp("APP:DELETE"), null);
  const frames = board.finishRun("stopped");
  assert.deepEqual(frames, ["RUN:STOPPED", "APP:OK:DELETE"]);
  assert.equal(fs.exists(APP), false);
  assert.equal(fs.exists(META), false);
});
