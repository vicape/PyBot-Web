import { test } from "node:test";
import assert from "node:assert/strict";

import { BleRuntimeUpdateSession } from "../src/bleRuntimeUpdateSession.js";
import {
  UPDATE,
  MAX_RUNTIME_UPDATE_SIZE,
  reassembleProgram,
  sha256Hex,
  base64ToBytes,
  compareRuntimeVersions,
} from "../src/bleProtocol.js";

/**
 * Mock FIEL del firmware UPDATE (RuntimeUpdateReceiver + boot.py apply). El
 * runtime NUNCA se escribe sobre `mainRuntime` durante la transferencia: se
 * acumula en `newTmp` y SOLO en APPLY (tras VERIFY:OK) se hace el swap (simulando
 * el reset + boot.py). Asi se valida que una transferencia interrumpida deja el
 * runtime anterior INTACTO.
 */
function makeMock(opts = {}) {
  const listeners = new Set();
  const stateListeners = new Set();
  const current = opts.current ?? "3.1.0";
  const st = {
    connected: true,
    begin: null,
    chunks: [],
    written: 0,
    acked: 0,
    tmpOpen: false,
    verified: false,
    mainRuntime: opts.mainRuntime ?? "# OLD RUNTIME 3.1.0\n",
    installed: current,
    applied: false,
    newTmp: null,
    sent: [],
    progress: [],
  };

  const emit = (text) => queueMicrotask(() => listeners.forEach((cb) => cb(text)));

  function handle(line) {
    if (line.startsWith(UPDATE.BEGIN + ":")) {
      const rest = line.slice((UPDATE.BEGIN + ":").length);
      const parts = rest.split(":");
      st.begin = { version: parts[0], size: parseInt(parts[1], 10), hash: parts[2] };
      st.chunks = [];
      st.written = 0;
      st.acked = 0;
      st.verified = false;
      if (opts.busy) return emit(UPDATE.ERROR + ":BUSY");
      if (!st.begin.version || compareRuntimeVersions(st.begin.version, current) <= 0) {
        return emit(UPDATE.ERROR + ":BAD_VERSION");
      }
      if (st.begin.size <= 0 || st.begin.size > MAX_RUNTIME_UPDATE_SIZE) {
        return emit(UPDATE.ERROR + ":TOO_LONG");
      }
      if (opts.noSpace) return emit(UPDATE.ERROR + ":NO_SPACE");
      if (opts.failBeginWrite) return emit(UPDATE.ERROR + ":WRITE_FAILED");
      st.tmpOpen = true;
      st.newTmp = "";
      return emit(UPDATE.READY);
    }
    if (line.startsWith(UPDATE.CHUNK + ":")) {
      if (!st.tmpOpen) return emit(UPDATE.ERROR + ":BAD_FRAME");
      const b64 = line.slice((UPDATE.CHUNK + ":").length);
      if (opts.disconnectAtChunk === st.acked) {
        mock._disconnect();
        return;
      }
      if (opts.failChunkAt === st.acked) {
        st.tmpOpen = false;
        return emit(UPDATE.ERROR + ":" + (opts.failChunkCode || "WRITE_FAILED"));
      }
      let bytes;
      try {
        bytes = base64ToBytes(b64);
      } catch {
        st.tmpOpen = false;
        return emit(UPDATE.ERROR + ":BAD_ENCODING");
      }
      st.chunks.push(b64);
      st.written += bytes.length;
      if (st.written > st.begin.size) {
        st.tmpOpen = false;
        return emit(UPDATE.ERROR + ":TOO_LONG");
      }
      const idx = st.acked;
      st.acked += 1;
      return emit(UPDATE.ACK + ":" + idx);
    }
    if (line === UPDATE.END) {
      if (!st.tmpOpen) return emit(UPDATE.ERROR + ":BAD_FRAME");
      st.tmpOpen = false;
      const reassembled = reassembleProgram(st.chunks);
      let bytes = new TextEncoder().encode(reassembled);
      if (bytes.length !== st.begin.size) {
        st.newTmp = null;
        return emit(UPDATE.ERROR + ":VERIFY_FAILED"); // runtime anterior intacto
      }
      if (opts.corrupt) {
        bytes = Uint8Array.from(bytes);
        bytes[0] ^= 1;
      }
      if (st.begin.hash) {
        if (opts.noHashlib) {
          st.newTmp = null;
          return emit(UPDATE.ERROR + ":HASH_UNAVAILABLE"); // nunca VERIFY:OK
        }
        const digest = sha256Hex(bytes);
        if (digest !== st.begin.hash) {
          st.newTmp = null;
          return emit(UPDATE.ERROR + ":BAD_HASH");
        }
      }
      st.newTmp = reassembled; // .new verificado; main.py TODAVIA intacto
      st.verified = true;
      return emit(UPDATE.VERIFY_OK);
    }
    if (line === UPDATE.APPLY) {
      if (!st.verified || st.newTmp == null) return emit(UPDATE.ERROR + ":BAD_FRAME");
      // Simula: escribir pybot_update.json pending + reset + boot.py swap.
      emit(UPDATE.APPLYING);
      st.mainRuntime = st.newTmp; // boot.py: .new -> main.py (con backup/rollback)
      st.installed = st.begin.version;
      st.applied = true;
      st.newTmp = null;
      queueMicrotask(() => mock._disconnect()); // la placa se reinicia
      return;
    }
    if (line === UPDATE.ABORT) {
      st.tmpOpen = false;
      st.chunks = [];
      st.newTmp = null;
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
    _disconnect() {
      if (!st.connected) return;
      st.connected = false;
      stateListeners.forEach((cb) => cb("disconnected"));
    },
  };
  return mock;
}

const RUNTIME = "# PyBot runtime v-next\n" + "def f():\n    return 42\n".repeat(120);

// ---------------------------------------------------------------------------
// Camino feliz: transferencia + verificación + apply
// ---------------------------------------------------------------------------

test("update transfers, verifies (size+hash) and applies (board swaps main.py)", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const res = await session.update(RUNTIME, { version: "3.2.0" });

  assert.equal(res.ok, true);
  assert.equal(res.version, "3.2.0");
  assert.equal(res.size, new TextEncoder().encode(RUNTIME).length);
  // El firmware recibió EXACTAMENTE el runtime (chunking + reensamblado correcto)
  // y boot.py lo instaló como main.py; la versión instalada pasó a la nueva.
  assert.equal(mock._state.mainRuntime, RUNTIME);
  assert.equal(mock._state.installed, "3.2.0");
  assert.equal(mock._state.applied, true);
  assert.equal(session.isBusy(), false);
});

test("update sends APPLY only after VERIFY:OK; ACKs are per block and ordered", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(RUNTIME, { version: "3.2.0" });

  const idxVerify = mock._state.sent.indexOf(UPDATE.END);
  const idxApply = mock._state.sent.indexOf(UPDATE.APPLY);
  assert.ok(idxVerify >= 0 && idxApply > idxVerify);
  const chunks = mock._state.sent.filter((l) => l.startsWith(UPDATE.CHUNK + ":")).length;
  assert.equal(mock._state.acked, chunks);
  assert.ok(chunks > 1);
});

test("onProgress is based on CONFIRMED bytes and reaches 100% before applying", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const seen = [];
  await session.update(RUNTIME, {
    version: "3.2.0",
    onProgress: (p) => seen.push(p),
  });
  const total = new TextEncoder().encode(RUNTIME).length;
  const transfer = seen.filter((p) => p.phase === "transfer");
  // Monotónico y nunca supera el total (bytes confirmados por ACK, no enviados).
  let last = -1;
  for (const p of transfer) {
    assert.ok(p.sent >= last, "progreso no monotónico");
    assert.ok(p.sent <= total);
    last = p.sent;
  }
  assert.equal(transfer[transfer.length - 1].sent, total);
  assert.ok(seen.some((p) => p.phase === "verified" && p.pct === 100));
  assert.ok(seen.some((p) => p.phase === "applying"));
});

// ---------------------------------------------------------------------------
// Errores del protocolo: el runtime anterior queda INTACTO
// ---------------------------------------------------------------------------

for (const [label, opts, rx] of [
  ["BUSY", { busy: true }, /BLE_UPDATE_ERROR:BUSY/],
  ["BAD_VERSION (same/older)", {}, /BLE_UPDATE_ERROR:BAD_VERSION/],
  ["NO_SPACE", { noSpace: true }, /BLE_UPDATE_ERROR:NO_SPACE/],
  ["WRITE_FAILED (begin)", { failBeginWrite: true }, /BLE_UPDATE_ERROR:WRITE_FAILED/],
]) {
  test(`update error ${label} keeps the old runtime intact`, async () => {
    const mock = makeMock(opts);
    const session = new BleRuntimeUpdateSession(mock);
    // BAD_VERSION: pedimos la MISMA versión que la instalada.
    const version = label.startsWith("BAD_VERSION") ? "3.1.0" : "3.2.0";
    await assert.rejects(() => session.update(RUNTIME, { version }), rx);
    assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
    assert.equal(mock._state.applied, false);
    assert.equal(session.isBusy(), false);
  });
}

test("update WRITE_FAILED mid-transfer keeps the old runtime intact", async () => {
  const mock = makeMock({ failChunkAt: 1, failChunkCode: "WRITE_FAILED" });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(
    () => session.update(RUNTIME, { version: "3.2.0" }),
    /BLE_UPDATE_ERROR:WRITE_FAILED/,
  );
  assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
  assert.equal(mock._state.applied, false);
});

test("update BAD_HASH (corrupt transfer) never applies; old runtime intact", async () => {
  const mock = makeMock({ corrupt: true });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(
    () => session.update(RUNTIME, { version: "3.2.0" }),
    /BLE_UPDATE_ERROR:BAD_HASH/,
  );
  assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
  assert.equal(mock._state.applied, false);
});

test("update HASH_UNAVAILABLE never claims VERIFY; old runtime intact", async () => {
  const mock = makeMock({ noHashlib: true });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(
    () => session.update(RUNTIME, { version: "3.2.0" }),
    /BLE_UPDATE_ERROR:HASH_UNAVAILABLE/,
  );
  assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
});

// ---------------------------------------------------------------------------
// Transferencia interrumpida (disconnect) -> runtime viejo intacto
// ---------------------------------------------------------------------------

test("disconnect mid-update leaves the old runtime intact (never bricked)", async () => {
  const mock = makeMock({ disconnectAtChunk: 2 });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(
    () => session.update(RUNTIME, { version: "3.2.0" }),
    /BLE_UPDATE_DISCONNECTED/,
  );
  assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
  assert.equal(mock._state.applied, false);
  assert.equal(mock._state.newTmp, null); // .new descartado
  assert.equal(session.isBusy(), false);
});

// ---------------------------------------------------------------------------
// Guardas de tamaño / conexión / versión (antes de tocar la placa)
// ---------------------------------------------------------------------------

test("update rejects runtime larger than MAX_RUNTIME_UPDATE_SIZE before sending", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const huge = "a".repeat(MAX_RUNTIME_UPDATE_SIZE + 100);
  await assert.rejects(() => session.update(huge, { version: "3.2.0" }), /BLE_UPDATE_TOO_LONG/);
  assert.equal(mock._state.begin, null);
});

test("update rejects when not connected", async () => {
  const mock = makeMock();
  mock._state.connected = false;
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(() => session.update(RUNTIME, { version: "3.2.0" }), /BLE_NOT_CONNECTED/);
});

test("update requires a target version", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(() => session.update(RUNTIME, {}), /BLE_UPDATE_NO_VERSION/);
});
