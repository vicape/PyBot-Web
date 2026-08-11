import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regresión 3.2.3 → 3.2.5: con app/RUN en exec(), el main loop no drena
 * la cola RX. STOP:FORCE debe agendarse por Timer; APP:STOP/DELETE deben ser
 * urgentes (flags en IRQ); safe_boot sticky; FORCE con ack=delete borra.
 * 3.2.5: APP:STOP para cualquier exec; Timer fallback -1/0/1.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLE_PY = path.join(
  __dirname,
  "..",
  "firmware",
  "pybot-ble-runtime",
  "pybot_ble.py",
);
const RUN_PY = path.join(
  __dirname,
  "..",
  "firmware",
  "pybot-ble-runtime",
  "pybot_run.py",
);
const DEPLOY_PY = path.join(
  __dirname,
  "..",
  "firmware",
  "pybot-ble-runtime",
  "pybot_deploy.py",
);

const ble = () => fs.readFileSync(BLE_PY, "utf8");
const run = () => fs.readFileSync(RUN_PY, "utf8");
const deploy = () => fs.readFileSync(DEPLOY_PY, "utf8");

test("runtime 3.2.5 declares version and schedules FORCE via Timer", () => {
  const src = ble();
  assert.match(src, /PYBOT_RUNTIME_VERSION = "3\.2\.5"/);
  assert.match(src, /def _schedule_force_reset/);
  assert.match(src, /for timer_id in \(-1, 0, 1\):/);
  assert.match(src, /machine\.Timer\(timer_id\)/);
  assert.match(src, /force_timer_armed/);
  // FORCE ya no depende solo del flag que el main lee tras exec().
  assert.match(src, /_schedule_force_reset\(\)/);
});

test("APP:STOP and APP:DELETE are handled as urgent when app is running", () => {
  const src = ble();
  assert.match(src, /if upper == "APP:STOP":/);
  assert.match(src, /if upper == "APP:DELETE":/);
  assert.match(src, /request_app_stop\("stop"\)/);
  assert.match(src, /request_app_stop\("delete"\)/);
  // 3.2.5: APP:STOP urgente si hay cualquier exec (no exige _persistent).
  const urgent = src.slice(src.indexOf("def on_urgent"), src.indexOf("def on_command"));
  assert.match(urgent, /if m and m\.running:/);
  assert.ok(!/m\.running and m\._persistent/.test(urgent.split("APP:STOP")[1]?.split("APP:DELETE")[0] ?? ""));
});

test("FORCE disables autostart and deletes when APP:DELETE ack is pending", () => {
  const src = ble();
  assert.match(src, /_app_ack", None\) == "delete"/);
  assert.match(src, /from pybot_deploy import _delete_app/);
  assert.match(src, /def _disable_autostart/);
  assert.match(src, /_disable_autostart\(\)/);
});

test("safe_boot is sticky on boot (not cleared; no autostart)", () => {
  const src = ble();
  // El bloque de boot con safe_boot NO debe limpiar el flag (sticky).
  assert.match(src, /safe_boot sticky|safe_boot STICKY/i);
  assert.match(src, /if st\.get\("safe_boot"\):\s*\n\s*pass/m);
  // _maybe_autostart tampoco limpia safe_boot.
  const maybe = src.slice(src.indexOf("def _maybe_autostart"));
  assert.ok(!maybe.slice(0, 400).includes('st["safe_boot"] = False'));
});

test("APP:START / start_app clears sticky safe_boot", () => {
  const src = run();
  assert.match(src, /def start_app/);
  assert.match(src, /st\.get\("safe_boot"\)/);
  assert.match(src, /st\["safe_boot"\] = False/);
});

test("deploy still clears safe_boot on successful install", () => {
  const src = deploy();
  assert.match(src, /st\["safe_boot"\] = False/);
});

/** Mirror mínimo: flags urgentes + FORCE agenda reset aunque “exec” bloquee. */
test("mirror: APP:STOP flag works while main is blocked in exec", () => {
  const mgr = {
    running: true,
    _persistent: false, // RUN temporal también debe aceptar APP:STOP (3.2.5)
    _stop: false,
    _app_ack: null,
    request_app_stop(action) {
      this._stop = true;
      this._app_ack = action;
    },
    request_force_stop() {
      this._stop = true;
      this._force = true;
    },
    should_stop() {
      return this._stop && this.running;
    },
  };
  const ctx = { manager: mgr, force_reset: false, force_timer_armed: false };
  const scheduled = [];

  function on_urgent(upper) {
    if (upper === "APP:STOP") {
      const m = ctx.manager;
      if (m && m.running) {
        m.request_app_stop("stop");
        return true;
      }
      return false;
    }
    if (upper === "STOP:FORCE") {
      const m = ctx.manager;
      if (m) m.request_force_stop();
      ctx.force_reset = true;
      scheduled.push("timer-reset");
      return true;
    }
    return false;
  }

  // Simula main bloqueado: la cola NO se drena, pero urgent sí.
  assert.equal(on_urgent("APP:STOP"), true);
  assert.equal(mgr._stop, true);
  assert.equal(mgr._app_ack, "stop");
  assert.equal(mgr.should_stop(), true);

  // No cooperativo → FORCE agenda reset aunque exec no haya vuelto.
  assert.equal(on_urgent("STOP:FORCE"), true);
  assert.deepEqual(scheduled, ["timer-reset"]);
  assert.equal(ctx.force_reset, true);
});

test("mirror: FORCE with delete ack removes app before reset", () => {
  const fsMap = new Map([
    ["pybot_app.py", "while True: pass\n"],
    ["pybot_app.json", '{"autostart":true}'],
  ]);
  const mgr = { _app_ack: "delete" };
  function force_reset() {
    if (mgr._app_ack === "delete") {
      fsMap.delete("pybot_app.py");
      fsMap.delete("pybot_app.json");
      mgr._app_ack = null;
    }
    // autostart off + safe_boot would be persisted here
  }
  force_reset();
  assert.equal(fsMap.has("pybot_app.py"), false);
  assert.equal(fsMap.has("pybot_app.json"), false);
  assert.equal(mgr._app_ack, null);
});
