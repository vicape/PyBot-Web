import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BleDeploySession,
  appInfo,
  appStop,
  appDelete,
  appAutostart,
  runSavedApp,
} from "../src/bleDeploySession.js";
import {
  DEPLOY,
  APP,
  RUN,
  reassembleProgram,
  sha256Hex,
  sha256HexUtf8,
  utf8ToBase64,
  base64ToBytes,
  MAX_DEPLOY_PROGRAM_SIZE,
} from "../src/bleProtocol.js";

/**
 * Mock del firmware DEPLOY/APP. Reensambla los chunks, verifica size+hash como el
 * runtime real, y responde READY/ACK/VERIFY o los errores configurados. Conserva
 * la app anterior (`saved`) si la transferencia falla.
 */
function makeMock(opts = {}) {
  const listeners = new Set();
  const stateListeners = new Set();
  const st = {
    connected: true,
    begin: null,
    chunks: [],
    written: 0,
    acked: 0,
    tmpOpen: false,
    saved: opts.saved ?? null,
    meta: opts.savedMeta ?? null,
    sent: [],
  };

  const emit = (text) => queueMicrotask(() => listeners.forEach((cb) => cb(text)));

  function handle(line) {
    if (line.startsWith(DEPLOY.BEGIN + ":")) {
      const parts = line.slice((DEPLOY.BEGIN + ":").length).split(":");
      st.begin = {
        mode: parts[0],
        profile: parts[1],
        size: parseInt(parts[2], 10),
        hash: parts[3],
      };
      st.chunks = [];
      st.written = 0;
      st.acked = 0;
      if (opts.failBegin) {
        emit(DEPLOY.ERROR + ":" + opts.failBegin);
        return;
      }
      if (st.begin.size > MAX_DEPLOY_PROGRAM_SIZE) {
        emit(DEPLOY.ERROR + ":TOO_LONG");
        return;
      }
      st.tmpOpen = true;
      emit(DEPLOY.READY);
      return;
    }
    if (line.startsWith(DEPLOY.CHUNK + ":")) {
      if (!st.tmpOpen) {
        emit(DEPLOY.ERROR + ":BAD_FRAME");
        return;
      }
      const b64 = line.slice((DEPLOY.CHUNK + ":").length);
      if (opts.disconnectAtChunk === st.acked) {
        mock._disconnect();
        return;
      }
      if (opts.failChunkAt === st.acked) {
        st.tmpOpen = false;
        emit(DEPLOY.ERROR + ":" + (opts.failChunkCode || "WRITE_FAILED"));
        return;
      }
      let bytes;
      try {
        bytes = base64ToBytes(b64);
      } catch {
        st.tmpOpen = false;
        emit(DEPLOY.ERROR + ":BAD_ENCODING");
        return;
      }
      st.chunks.push(b64);
      st.written += bytes.length;
      if (st.written > st.begin.size) {
        st.tmpOpen = false;
        emit(DEPLOY.ERROR + ":TOO_LONG");
        return;
      }
      const idx = st.acked;
      st.acked += 1;
      emit(DEPLOY.ACK + ":" + idx);
      return;
    }
    if (line === DEPLOY.END) {
      if (!st.tmpOpen) {
        emit(DEPLOY.ERROR + ":BAD_FRAME");
        return;
      }
      st.tmpOpen = false;
      const reassembled = reassembleProgram(st.chunks);
      let bytes = new TextEncoder().encode(reassembled);
      if (bytes.length !== st.begin.size) {
        emit(DEPLOY.ERROR + ":VERIFY_FAILED"); // app anterior intacta
        return;
      }
      if (opts.corrupt) {
        bytes = Uint8Array.from(bytes);
        bytes[0] ^= 1; // misma longitud, distinto contenido -> hash no coincide
      }
      const digest = sha256Hex(bytes);
      if (st.begin.hash && digest !== st.begin.hash) {
        emit(DEPLOY.ERROR + ":BAD_HASH"); // NO reemplaza la app anterior
        return;
      }
      // commit atomico
      st.saved = reassembled;
      st.meta = {
        version: 3,
        mode: st.begin.mode,
        profile: st.begin.profile,
        autostart: true,
        size: st.begin.size,
        hash: digest,
      };
      emit(DEPLOY.VERIFY_OK);
      return;
    }
    if (line === DEPLOY.ABORT) {
      st.tmpOpen = false;
      st.chunks = [];
      return;
    }
    // --- APP ---
    if (line === APP.INFO) {
      const m = st.meta;
      const obj = {
        installed: !!m,
        running: false,
        autostart: !!(m && m.autostart),
        mode: m ? m.mode : "",
        profile: m ? m.profile : "",
        size: m ? m.size : 0,
        hash: m ? m.hash : "",
        safe: false,
        fail: 0,
        error: "",
      };
      emit(APP.INFO_PREFIX + JSON.stringify(obj));
      return;
    }
    if (line === APP.STOP) {
      emit(APP.OK_PREFIX + "STOP");
      return;
    }
    if (line === APP.DELETE) {
      st.saved = null;
      st.meta = null;
      emit(APP.OK_PREFIX + "DELETE");
      return;
    }
    if (line.startsWith(APP.AUTOSTART + ":")) {
      const v = line.slice((APP.AUTOSTART + ":").length);
      if (!st.meta) {
        emit(APP.ERROR_PREFIX + "NO_APP");
        return;
      }
      st.meta.autostart = v === "1";
      emit(APP.OK_PREFIX + "AUTOSTART");
      return;
    }
    if (line === APP.START) {
      if (!st.meta) {
        emit(APP.ERROR_PREFIX + "NO_APP");
        return;
      }
      emit(APP.OK_PREFIX + "START");
      emit(RUN.STARTED);
      if (opts.appRunError) {
        // Error de protocolo TERMINAL durante la app: RUN:ERROR:<code> SIN DONE.
        emit(RUN.ERROR + ":BAD_FRAME");
        return;
      }
      emit(RUN.OUT + ":" + utf8ToBase64("saved-app-output\n"));
      emit(RUN.DONE);
      return;
    }
  }

  const mock = {
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
      handle(line);
    },
    async send(text) {
      return mock.sendChunked(text);
    },
    sendAndWait(command, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        let done = false;
        const off = mock.onData((m) => {
          if (done) return;
          done = true;
          off();
          resolve(m);
        });
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          off();
          reject(new Error("BLE_TIMEOUT"));
        }, timeoutMs);
        mock.sendChunked(command).catch((e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          off();
          reject(e);
        });
      });
    },
    _disconnect() {
      st.connected = false;
      stateListeners.forEach((cb) => cb("disconnected"));
    },
  };
  return mock;
}

test("deploy transfers, verifies (size+hash) and saves the app", async () => {
  const mock = makeMock();
  const session = new BleDeploySession(mock);
  const program = "salidaDigital(1, 1)\nwait(0.5)\nsalidaDigital(1, 0)\n";

  const res = await session.deploy(program, { mode: "eda6", profile: "WEMOS" });

  assert.equal(res.ok, true);
  assert.equal(res.size, new TextEncoder().encode(program).length);
  assert.equal(res.hash, sha256HexUtf8(program));
  // El firmware guardo EXACTAMENTE el programa (chunking + reensamblado correcto).
  assert.equal(mock._state.saved, program);
  assert.equal(mock._state.meta.mode, "eda6");
  assert.equal(mock._state.meta.autostart, true);
  assert.equal(session.isBusy(), false);
});

test("deploy ACKs are per block and strictly ordered", async () => {
  const mock = makeMock();
  const session = new BleDeploySession(mock);
  await session.deploy("x = 1\n".repeat(200), { mode: "mpy", profile: "ESP32" });
  const acks = mock._state.sent.filter((l) => l === DEPLOY.END).length;
  assert.equal(acks, 1);
  // Un ACK por cada CHUNK enviado.
  const chunks = mock._state.sent.filter((l) => l.startsWith(DEPLOY.CHUNK + ":")).length;
  assert.equal(mock._state.acked, chunks);
  assert.ok(chunks > 1);
});

for (const kb of [1, 2, 4, 8]) {
  test(`deploy handles ~${kb}KB program losslessly`, async () => {
    const mock = makeMock();
    const session = new BleDeploySession(mock);
    const program = ("print('línea áéíóú ñ')\n").repeat(Math.ceil((kb * 1024) / 22));
    const res = await session.deploy(program, { mode: "eda6", profile: "WEMOS" });
    assert.equal(res.ok, true);
    assert.equal(mock._state.saved, program);
    assert.equal(res.hash, sha256HexUtf8(program));
  });
}

test("deploy near MAX_DEPLOY_PROGRAM_SIZE still succeeds", async () => {
  const mock = makeMock();
  const session = new BleDeploySession(mock);
  const unit = "a = 1\n"; // 6 bytes
  const program = unit.repeat(Math.floor((MAX_DEPLOY_PROGRAM_SIZE - 10) / unit.length));
  assert.ok(new TextEncoder().encode(program).length <= MAX_DEPLOY_PROGRAM_SIZE);
  const res = await session.deploy(program, { mode: "mpy", profile: "WEMOS" });
  assert.equal(res.ok, true);
  assert.equal(mock._state.saved, program);
});

test("deploy rejects programs larger than MAX_DEPLOY_PROGRAM_SIZE (before sending)", async () => {
  const mock = makeMock();
  const session = new BleDeploySession(mock);
  const huge = "a".repeat(MAX_DEPLOY_PROGRAM_SIZE + 100);
  await assert.rejects(() => session.deploy(huge, {}), /BLE_DEPLOY_TOO_LONG/);
  // No debe haber empezado la transferencia.
  assert.equal(mock._state.begin, null);
});

test("bad hash keeps the previous app intact and reports BAD_HASH", async () => {
  const mock = makeMock({ corrupt: true, saved: "OLD_APP\n", savedMeta: { mode: "eda6", profile: "WEMOS", autostart: true, size: 8, hash: "old" } });
  const session = new BleDeploySession(mock);
  await assert.rejects(
    () => session.deploy("nueva = 1\n", { mode: "mpy", profile: "WEMOS" }),
    /BLE_DEPLOY_ERROR:BAD_HASH/,
  );
  // La app anterior sigue intacta (no se reemplazo).
  assert.equal(mock._state.saved, "OLD_APP\n");
});

test("BAD_ENCODING / WRITE_FAILED / TOO_LONG errors reject cleanly and keep previous app", async () => {
  for (const code of ["BAD_ENCODING", "WRITE_FAILED", "NO_SPACE"]) {
    const mock = makeMock({ failChunkAt: 0, failChunkCode: code, saved: "OLD\n" });
    const session = new BleDeploySession(mock);
    await assert.rejects(
      () => session.deploy("x = 1\n".repeat(50), {}),
      new RegExp("BLE_DEPLOY_ERROR:" + code),
    );
    assert.equal(mock._state.saved, "OLD\n");
    assert.equal(session.isBusy(), false);
  }
});

test("BAD_FRAME on begin rejects", async () => {
  const mock = makeMock({ failBegin: "BAD_FRAME" });
  const session = new BleDeploySession(mock);
  await assert.rejects(() => session.deploy("x = 1\n", {}), /BLE_DEPLOY_ERROR:BAD_FRAME/);
});

test("disconnect mid-transfer aborts and keeps previous app", async () => {
  const mock = makeMock({ disconnectAtChunk: 1, saved: "OLD\n" });
  const session = new BleDeploySession(mock);
  await assert.rejects(
    () => session.deploy("x = 1\n".repeat(80), {}),
    /BLE_DEPLOY_DISCONNECTED/,
  );
  assert.equal(mock._state.saved, "OLD\n");
  assert.equal(session.isBusy(), false);
});

test("deploy fails cleanly when not connected", async () => {
  const mock = makeMock();
  mock._state.connected = false;
  const session = new BleDeploySession(mock);
  await assert.rejects(() => session.deploy("x = 1\n", {}), /BLE_NOT_CONNECTED/);
});

test("APP:INFO reports installed/autostart/mode after a deploy", async () => {
  const mock = makeMock();
  const session = new BleDeploySession(mock);
  await session.deploy("salidaDigital(1,1)\n", { mode: "eda6", profile: "ESP32" });
  const info = await appInfo(mock);
  assert.equal(info.installed, true);
  assert.equal(info.autostart, true);
  assert.equal(info.mode, "eda6");
  assert.equal(info.profile, "ESP32");
});

test("APP:AUTOSTART toggles metadata; APP:DELETE removes the app", async () => {
  const mock = makeMock();
  await new BleDeploySession(mock).deploy("x=1\n", { mode: "mpy", profile: "WEMOS" });

  await appAutostart(mock, false);
  assert.equal((await appInfo(mock)).autostart, false);
  await appAutostart(mock, true);
  assert.equal((await appInfo(mock)).autostart, true);

  await appStop(mock); // no-op logico, responde OK
  await appDelete(mock);
  const info = await appInfo(mock);
  assert.equal(info.installed, false);
});

test("APP:AUTOSTART on a board with no app returns an APP error", async () => {
  const mock = makeMock();
  await assert.rejects(() => appAutostart(mock, true), /BLE_APP_ERROR:NO_APP/);
});

test("runSavedApp streams output and resolves with outcome done", async () => {
  const mock = makeMock();
  await new BleDeploySession(mock).deploy("x=1\n", { mode: "mpy", profile: "WEMOS" });

  const out = [];
  const { outcome } = await runSavedApp(mock, { onOut: (s) => out.push(s) });
  assert.equal(outcome, "done");
  assert.equal(out.join(""), "saved-app-output\n");
});

test("runSavedApp treats RUN:ERROR as terminal (outcome 'error', no hanging promise)", async () => {
  const mock = makeMock({ appRunError: true });
  await new BleDeploySession(mock).deploy("x=1\n", { mode: "mpy", profile: "WEMOS" });
  const errs = [];
  // Sin RUN:DONE posterior: si RUN:ERROR no cerrara la sesion, colgaria.
  const { outcome } = await runSavedApp(mock, { onErr: (s) => errs.push(s) });
  assert.equal(outcome, "error");
  assert.ok(errs.join("").includes("BAD_FRAME"));
});

test("runSavedApp on empty board surfaces an app error and resolves", async () => {
  const mock = makeMock();
  const errs = [];
  const { outcome } = await runSavedApp(mock, { onErr: (s) => errs.push(s) });
  assert.equal(outcome, "error");
  assert.ok(errs.join("").includes("NO_APP"));
});
