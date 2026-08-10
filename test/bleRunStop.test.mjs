import { test } from "node:test";
import assert from "node:assert/strict";

import { BleRunSession } from "../src/bleRunSession.js";
import {
  RUN,
  parseRunBegin,
  reassembleProgram,
  utf8ToBase64,
} from "../src/bleProtocol.js";

/**
 * Mock del firmware con soporte de STOP confiable (protocolo 3.0):
 *   - "LOOP"  : no termina hasta recibir STOP (bucle detenible cooperativamente).
 *   - "TIGHT" : ignora STOP (bucle que no cede); solo STOP:FORCE lo corta (reset).
 *   - "ERR"   : emite RUN:ERR + RUN:DONE (excepcion del programa).
 *   - resto   : emite salida y RUN:DONE.
 * STOP -> RUN:STOPPED (confirmacion). STOP:FORCE -> reset (desconexion).
 */
function makeMock(opts = {}) {
  const listeners = new Set();
  const stateListeners = new Set();
  const st = { connected: true, program: null, chunks: [], sent: [], stopped: false };
  const emit = (text) => queueMicrotask(() => listeners.forEach((cb) => cb(text)));

  const tr = {
    _state: st,
    isConnected: () => st.connected,
    onData(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onStateChange(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    async sendChunked(text) {
      const line = String(text).replace(/\n+$/, "");
      st.sent.push(line);
      if (line.startsWith(RUN.BEGIN + ":")) {
        parseRunBegin(line);
        st.chunks = [];
        emit(RUN.READY);
      } else if (line.startsWith(RUN.CHUNK + ":")) {
        st.chunks.push(line.slice((RUN.CHUNK + ":").length));
      } else if (line === RUN.END) {
        st.program = reassembleProgram(st.chunks);
        emit(RUN.STARTED);
        if (st.program.includes("LOOP") || st.program.includes("TIGHT")) return;
        if (st.program.includes("PROTOERR")) {
          // Error de protocolo TERMINAL: RUN:ERROR:<code> SIN un RUN:DONE posterior.
          emit(RUN.ERROR + ":BAD_FRAME");
          return;
        }
        if (st.program.includes("ERR")) {
          emit(RUN.ERR + ":" + utf8ToBase64("Traceback: boom\n"));
          emit(RUN.DONE);
          return;
        }
        emit(RUN.OUT + ":" + utf8ToBase64("done\n"));
        emit(RUN.DONE);
      } else if (line === RUN.STOP) {
        if (st.program && st.program.includes("TIGHT")) return; // no cede a STOP
        st.stopped = true;
        emit(RUN.OUT + ":" + utf8ToBase64("[Detenido]\n"));
        emit(RUN.STOPPED);
      } else if (line === RUN.STOP_FORCE) {
        // Simula el reset con safe boot: la conexion se cae.
        st.forced = true;
        tr._disconnect();
      }
    },
    _disconnect() {
      st.connected = false;
      stateListeners.forEach((cb) => cb("disconnected"));
    },
  };
  return tr;
}

test("RUN:STOPPED is a terminal state that resolves with outcome 'stopped'", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const out = [];
  let stoppedCb = false;

  const runP = session.runProgram("while True:\n    wait(1)  # LOOP\n", {
    onOut: (s) => out.push(s),
    onStopped: () => (stoppedCb = true),
  });
  await new Promise((r) => setTimeout(r, 30));
  await session.stop();
  const { outcome } = await runP;

  assert.equal(outcome, "stopped");
  assert.equal(stoppedCb, true);
  assert.equal(mock._state.stopped, true);
  assert.ok(out.join("").includes("[Detenido]"));
  assert.equal(session.isRunning(), false);
});

test("STOP during a wait() stops cooperatively (RUN:STOPPED)", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const runP = session.runProgram(
    "while True:\n    salidaDigital(1,1)\n    wait(0.5)  # LOOP\n",
    {},
  );
  await new Promise((r) => setTimeout(r, 30));
  await session.stop();
  const { outcome } = await runP;
  assert.equal(outcome, "stopped");
  assert.ok(mock._state.sent.includes(RUN.STOP));
});

test("shouldStop polling sends STOP and resolves as stopped", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  let stop = false;
  const runP = session.runProgram("while True:\n    pass  # LOOP\n", {
    shouldStop: () => stop,
  });
  await new Promise((r) => setTimeout(r, 30));
  stop = true;
  const { outcome } = await runP;
  assert.equal(outcome, "stopped");
  assert.ok(mock._state.sent.includes(RUN.STOP));
});

test("normal completion resolves with outcome 'done'", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const out = [];
  const { outcome } = await session.runProgram("print('hola')\n", {
    onOut: (s) => out.push(s),
  });
  assert.equal(outcome, "done");
  assert.equal(out.join(""), "done\n");
});

test("program exception is streamed on ERR and run resolves on DONE", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const errs = [];
  const { outcome } = await session.runProgram("raise ValueError()  # ERR\n", {
    onErr: (s) => errs.push(s),
  });
  assert.equal(outcome, "done");
  assert.ok(errs.join("").includes("Traceback"));
});

test("forceStop() sends STOP:FORCE and the reset is treated as a stop", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const runP = session.runProgram("while True:\n    pass  # TIGHT\n", {});
  await new Promise((r) => setTimeout(r, 30));
  await session.forceStop();
  const { outcome } = await runP;
  assert.equal(outcome, "stopped");
  assert.ok(mock._state.sent.includes(RUN.STOP_FORCE));
  assert.equal(mock._state.forced, true);
});

test("STOP escalates to STOP:FORCE when the program does not yield", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const runP = session.runProgram("while True:\n    pass  # TIGHT\n", {});
  await new Promise((r) => setTimeout(r, 30));
  await session.stop(); // cooperativo; el mock TIGHT lo ignora
  const { outcome } = await runP; // debe escalar a STOP:FORCE (reset) y resolver
  assert.equal(outcome, "stopped");
  assert.ok(mock._state.sent.includes(RUN.STOP));
  assert.ok(mock._state.sent.includes(RUN.STOP_FORCE));
});

test("RUN:ERROR is terminal: resolves with outcome 'error' and cleans up (no hanging promise)", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const errs = [];
  // Sin RUN:DONE posterior: si RUN:ERROR no cerrara la sesion, la promesa colgaria
  // (y este test agotaria el timeout). Debe resolver como "error".
  const { outcome } = await session.runProgram("x = 1  # PROTOERR\n", {
    onErr: (s) => errs.push(s),
  });
  assert.equal(outcome, "error");
  assert.equal(session.isRunning(), false);
  assert.ok(errs.join("").includes("BAD_FRAME"));
});

test("disconnect before STARTED still rejects with BLE_RUN_DISCONNECTED", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const original = mock.sendChunked;
  mock.sendChunked = async (text) => {
    const line = String(text).replace(/\n+$/, "");
    if (line === RUN.END) {
      mock._disconnect();
      return;
    }
    return original(text);
  };
  await assert.rejects(
    () => session.runProgram("print(1)\n", {}),
    /BLE_RUN_DISCONNECTED/,
  );
});

test("unexpected disconnect while running (no stop requested) resolves as disconnected", async () => {
  const mock = makeMock();
  const session = new BleRunSession(mock);
  const runP = session.runProgram("while True:\n    wait(1)  # LOOP\n", {});
  await new Promise((r) => setTimeout(r, 40));
  mock._disconnect();
  const { outcome } = await runP;
  assert.equal(outcome, "disconnected");
  assert.equal(session.isRunning(), false);
});
