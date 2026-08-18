import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mirror minimo de ProgramManager (pybot_run.py 3.2.7) para el ciclo
 * Run → Stop → Run: should_stop exige running, y begin() resetea idle.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_PY = path.join(
  __dirname,
  "..",
  "firmware",
  "pybot-ble-runtime",
  "pybot_run.py",
);
const BLE_PY = path.join(
  __dirname,
  "..",
  "firmware",
  "pybot-ble-runtime",
  "pybot_ble.py",
);

class ProgramManagerMirror {
  constructor() {
    this.running = false;
    this.pending = false;
    this._stop = false;
    this._force = false;
    this._collecting = false;
    this._chunks = [];
    this.frames = [];
  }

  reset_idle() {
    this._chunks = [];
    this._collecting = false;
    this.pending = false;
    this._stop = false;
    this._force = false;
  }

  should_stop() {
    return this._stop && this.running;
  }

  request_stop() {
    this._stop = true;
  }

  begin() {
    if (this.running) {
      this.frames.push("RUN:ERROR:BUSY");
      return;
    }
    this.reset_idle();
    this._collecting = true;
    this.frames.push("RUN:READY");
  }

  /** Simula fin de Stop cooperativo. */
  finishStopped() {
    this.running = false;
    this._force = false;
    this._stop = false;
    this.frames.push("RUN:STOPPED");
    this.reset_idle();
  }
}

test("firmware 4.0.0 queues non-urgent RX and polls on main loop", () => {
  const ble = fs.readFileSync(BLE_PY, "utf8");
  assert.match(ble, /PYBOT_RUNTIME_VERSION = "4\.0\.5"/);
  assert.match(ble, /def poll_commands/);
  assert.match(ble, /def on_urgent/);
  assert.match(ble, /self\._cmd_q/);
  // STOP sigue siendo urgente (flag en IRQ); FORCE agenda Timer (no reset en IRQ).
  assert.match(ble, /def _schedule_force_reset/);
  assert.match(ble, /def _cancel_force_reset/);
  assert.match(ble, /ctx\["force_reset"\] = True/);
  assert.match(ble, /transport\.poll_commands\(\)/);
  // RUN:BEGIN cancela FORCE huerfano (defensa ante Stop→Run).
  assert.match(ble, /RUN:BEGIN:[\s\S]*_cancel_force_reset/);
});

test("should_stop is false after stop even if _stop was left true (leaked patch guard)", () => {
  const m = new ProgramManagerMirror();
  m.running = true;
  m.request_stop();
  assert.equal(m.should_stop(), true);
  m.finishStopped();
  // Bug clasico: _stop=True + sleep patch → main loop raise. Con el guard:
  m._stop = true; // simula flag sucio
  assert.equal(m.running, false);
  assert.equal(m.should_stop(), false, "sin running no debe disparar stop");
});

test("begin after stop sends READY not BUSY", () => {
  const m = new ProgramManagerMirror();
  m.running = true;
  m.request_stop();
  m.finishStopped();
  m._stop = true;
  m._collecting = true;
  m.pending = true;
  m.begin();
  assert.deepEqual(m.frames.slice(-1), ["RUN:READY"]);
  assert.equal(m._stop, false);
  assert.equal(m.pending, false);
  assert.equal(m._collecting, true);
});

test("pybot_run.py documents should_stop requiring running", () => {
  const src = fs.readFileSync(RUN_PY, "utf8");
  assert.match(src, /return self\._stop and self\.running/);
  assert.match(src, /def reset_idle/);
  assert.match(src, /_on_cooperative_stop/);
});

/**
 * Modelo firmware: STOP cooperativo cancela FORCE pendiente; un nuevo RUN:BEGIN
 * tambien cancela. Sin esto, un Timer FORCE huerfano hace machine.reset() en RUN#2.
 */
test("cooperative stop + RUN:BEGIN cancel pending FORCE timer (model)", () => {
  const ble = fs.readFileSync(BLE_PY, "utf8");
  const run = fs.readFileSync(RUN_PY, "utf8");
  assert.match(ble, /def _cancel_force_reset/);
  assert.match(run, /_on_cooperative_stop/);

  const ctx = {
    force_reset: false,
    force_timer_armed: false,
    force_timer: null,
    resetCount: 0,
    manager: { running: true },
  };
  const cancel = () => {
    ctx.force_reset = false;
    ctx.force_timer_armed = false;
    if (ctx.force_timer) {
      ctx.force_timer.cancelled = true;
      ctx.force_timer = null;
    }
  };
  const schedule = () => {
    // 3.2.7: no agendar si no hay exec.
    if (!ctx.manager || !ctx.manager.running) {
      ctx.force_reset = false;
      return;
    }
    ctx.force_reset = true;
    if (ctx.force_timer_armed) return;
    ctx.force_timer_armed = true;
    const t = { cancelled: false };
    ctx.force_timer = t;
    // Simula Timer ONE_SHOT: si no se cancela / running=False, no resetea.
    setTimeout(() => {
      if (t.cancelled) return;
      if (!ctx.manager || !ctx.manager.running) {
        ctx.force_reset = false;
        return;
      }
      ctx.resetCount += 1;
    }, 5);
  };

  // FORCE huerfano tras Stop cooperativo:
  schedule();
  cancel(); // equivalente a _on_cooperative_stop en RUN:STOPPED
  ctx.manager.running = false;
  // Nuevo RUN:BEGIN tambien cancela (idempotente):
  cancel();
  // FORCE tardio con running=False: no agenda.
  schedule();
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(ctx.resetCount, 0, "FORCE cancelado / idle no debe resetear");
      assert.equal(ctx.force_reset, false);
      assert.equal(ctx.force_timer_armed, false);
      resolve();
    }, 30);
  });
});

test("FORCE while running=False does not schedule reset (3.2.7)", () => {
  const bleSrc = fs.readFileSync(BLE_PY, "utf8");
  assert.match(bleSrc, /PYBOT_RUNTIME_VERSION = "4\.0\.5"/);
  // Callback del Timer y _schedule_force_reset exigen running.
  assert.match(bleSrc, /if not m2 or not m2\.running:/);
  assert.match(bleSrc, /huerfano post-STOPPED/);
});
