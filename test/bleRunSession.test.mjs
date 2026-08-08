import { test } from "node:test";
import assert from "node:assert/strict";

import { BleRunSession } from "../src/bleRunSession.js";
import {
  RUN,
  parseRunBegin,
  reassembleProgram,
  utf8ToBase64,
  MAX_PROGRAM_LENGTH,
} from "../src/bleProtocol.js";

/**
 * Transporte mock que simula el runtime BLE del firmware:
 *   - responde RUN:READY al RUN:BEGIN,
 *   - reensambla los RUN:CHUNK,
 *   - al RUN:END: emite RUN:STARTED, "ejecuta" y emite OUT + RUN:DONE.
 * Un programa que contiene "LOOP" no termina hasta recibir STOP (simula while True).
 */
function makeFirmwareMock() {
  const listeners = new Set();
  const stateListeners = new Set();
  const state = {
    connected: true,
    begin: null,
    chunks: [],
    program: null,
    endedNaturally: false,
    stopReceived: false,
    sent: [],
  };

  const emit = (text) => {
    queueMicrotask(() => listeners.forEach((cb) => cb(text)));
  };

  const finishRun = (stopped) => {
    if (stopped) emit(RUN.OUT + ":" + utf8ToBase64("[stopped]"));
    emit(RUN.DONE);
  };

  const transport = {
    isConnected: () => state.connected,
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
      state.sent.push(line);
      if (line.startsWith(RUN.BEGIN + ":")) {
        state.begin = parseRunBegin(line);
        state.chunks = [];
        state.program = null;
        state.stopReceived = false;
        emit(RUN.READY);
      } else if (line.startsWith(RUN.CHUNK + ":")) {
        state.chunks.push(line.slice((RUN.CHUNK + ":").length));
      } else if (line === RUN.END) {
        state.program = reassembleProgram(state.chunks);
        emit(RUN.STARTED);
        if (state.program.includes("LOOP")) {
          // espera un STOP para terminar (simula un while True detenible)
          return;
        }
        // "salida" del programa: eco del codigo recibido
        emit(RUN.OUT + ":" + utf8ToBase64(state.program));
        state.endedNaturally = true;
        finishRun(false);
      } else if (line === RUN.STOP) {
        state.stopReceived = true;
        finishRun(true);
      }
    },
    // helpers de test
    _disconnect() {
      state.connected = false;
      stateListeners.forEach((cb) => cb("disconnected"));
    },
    _state: state,
  };

  return transport;
}

test("runProgram sends BEGIN with mode/profile, streams OUT and resolves on DONE", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);

  const out = [];
  const program = "print('hola')\nfor i in range(3):\n    print(i)\n";
  let started = false;

  await session.runProgram(program, {
    mode: "eda6",
    profile: "ESP32",
    onOut: (s) => out.push(s),
    onStarted: () => (started = true),
  });

  assert.deepEqual(tr._state.begin, { mode: "eda6", profile: "ESP32" });
  assert.equal(started, true);
  // El firmware reensambló EXACTAMENTE el programa enviado (chunking correcto).
  assert.equal(tr._state.program, program);
  assert.equal(out.join(""), program);
  assert.equal(session.isRunning(), false);
});

test("BLE run sends ONLY the student code (never the EDA6 library over Bluetooth)", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);

  // Programa EDA6 tipico de bloques (el mismo que falló en hardware real).
  const program =
    "while True:\n    salidaDigital(1, 1)\n    wait(0.5)\n    salidaDigital(1, 0)\n    wait(0.5)\n";

  const runP = session.runProgram(program, { mode: "eda6", profile: "WEMOS" });
  await new Promise((r) => setTimeout(r, 30));
  await session.stop();
  await runP;

  // El firmware reensambló EXACTAMENTE el código del alumno: nada de librería.
  assert.equal(tr._state.program, program);

  // Ningún frame RUN:CHUNK debe contener la definición de la librería EDA6/mpy
  // (esas viven en la placa, instaladas por USB). Verificamos sobre el texto
  // decodificado de todos los chunks enviados.
  const sentChunks = tr._state.sent
    .filter((l) => l.startsWith(RUN.CHUNK + ":"))
    .map((l) => l.slice((RUN.CHUNK + ":").length));
  const reassembled = reassembleProgram(sentChunks);
  assert.equal(reassembled, program);
  assert.ok(!/def\s+salidaDigital/.test(reassembled), "no debe viajar la librería EDA6");
  assert.ok(!/PLACA_ACTUAL/.test(reassembled), "no debe viajar estado del perfil EDA6");
});

test("runProgram defaults to mpy/WEMOS when mode/profile are omitted", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);
  await session.runProgram("print(1)\n", {});
  assert.deepEqual(tr._state.begin, { mode: "mpy", profile: "WEMOS" });
});

test("stop() aborts a long-running program and resolves the run", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);

  const out = [];
  const runP = session.runProgram("while True:\n    pass  # LOOP\n", {
    onOut: (s) => out.push(s),
  });

  // Esperar a que el firmware confirme STARTED antes de detener.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(session.isRunning(), true);
  await session.stop();
  await runP;

  assert.equal(tr._state.stopReceived, true);
  assert.ok(out.join("").includes("[stopped]"));
  assert.equal(session.isRunning(), false);
});

test("shouldStop() polling sends STOP automatically", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);
  let stop = false;

  const runP = session.runProgram("while True:\n    pass  # LOOP\n", {
    shouldStop: () => stop,
  });
  await new Promise((r) => setTimeout(r, 30));
  stop = true; // el poller debe enviar STOP solo
  await runP;

  assert.equal(tr._state.stopReceived, true);
});

test("runProgram rejects programs larger than MAX_PROGRAM_LENGTH", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);
  const huge = "x = 1\n".repeat(Math.ceil(MAX_PROGRAM_LENGTH / 3));
  await assert.rejects(() => session.runProgram(huge, {}), /BLE_PROGRAM_TOO_LONG/);
});

test("runProgram fails cleanly when not connected", async () => {
  const tr = makeFirmwareMock();
  tr._state.connected = false;
  const session = new BleRunSession(tr);
  await assert.rejects(() => session.runProgram("print(1)", {}), /BLE_NOT_CONNECTED/);
});

test("disconnect before STARTED surfaces a disconnection error", async () => {
  const tr = makeFirmwareMock();
  const session = new BleRunSession(tr);

  // Interceptar READY para desconectar antes de que empiece la ejecución.
  const original = tr.sendChunked;
  tr.sendChunked = async (text) => {
    const line = String(text).replace(/\n+$/, "");
    if (line === RUN.END) {
      tr._disconnect();
      return;
    }
    return original(text);
  };

  await assert.rejects(
    () => session.runProgram("print(1)\n", {}),
    /BLE_RUN_DISCONNECTED/,
  );
});
