import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BleRuntimeUpdateSession } from "../src/bleRuntimeUpdateSession.js";
import {
  UPDATE,
  MAX_RUNTIME_UPDATE_SIZE,
  UPDATE_SOURCE_CHUNK,
  reassembleProgramBytes,
  sha256Hex,
  sha256HexUtf8,
  base64ToBytes,
  compareRuntimeVersions,
  buildUpdateBegin,
} from "../src/bleProtocol.js";
import { PYBOT_RUNTIME_MODULE_FILES } from "../src/esp32/pybotInstallManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const FW = join(root, "firmware/pybot-ble-runtime");
const ENC = new TextEncoder();
const PACK_MAGIC = "PYBOTRT1\n";

/** Mismo algoritmo que buildBleRuntimePackBytes (sin import Vite ?raw). */
function buildBleRuntimePackBytesFromDisk() {
  const modules = PYBOT_RUNTIME_MODULE_FILES.map((name) => ({
    name,
    source: readFileSync(join(FW, name), "utf8"),
  }));
  const chunks = [ENC.encode(PACK_MAGIC)];
  for (const { name, source } of modules) {
    const data = ENC.encode(String(source ?? ""));
    chunks.push(ENC.encode(name + "\n"));
    chunks.push(ENC.encode(String(data.length) + "\n"));
    chunks.push(data);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function getBleRuntimeModulesFromDisk() {
  return PYBOT_RUNTIME_MODULE_FILES.map((name) => ({
    name,
    source: readFileSync(join(FW, name), "utf8"),
  }));
}

/**
 * Mock FIEL del firmware UPDATE (RuntimeUpdateReceiver + boot.py apply).
 * Reensambla CHUNKs como BYTES (base64ToBytes), nunca TextDecoder.
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
      st.newTmp = null;
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
      let bytes = reassembleProgramBytes(st.chunks);
      if (bytes.length !== st.begin.size) {
        st.newTmp = null;
        return emit(UPDATE.ERROR + ":VERIFY_FAILED");
      }
      if (opts.corrupt) {
        bytes = Uint8Array.from(bytes);
        bytes[0] ^= 1;
      }
      if (st.begin.hash) {
        if (opts.noHashlib) {
          st.newTmp = null;
          return emit(UPDATE.ERROR + ":HASH_UNAVAILABLE");
        }
        const digest = sha256Hex(bytes);
        if (digest !== st.begin.hash) {
          st.newTmp = null;
          return emit(UPDATE.ERROR + ":BAD_HASH");
        }
      }
      st.newTmp = bytes; // Uint8Array verificado; main aún intacto
      st.verified = true;
      return emit(UPDATE.VERIFY_OK);
    }
    if (line === UPDATE.APPLY) {
      if (!st.verified || st.newTmp == null) return emit(UPDATE.ERROR + ":BAD_FRAME");
      emit(UPDATE.APPLYING);
      st.mainRuntime = st.newTmp; // Uint8Array instalado
      st.installed = st.begin.version;
      st.applied = true;
      st.newTmp = null;
      queueMicrotask(() => mock._disconnect());
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

function asBytes(value) {
  return value instanceof Uint8Array ? value : ENC.encode(String(value ?? ""));
}

const RUNTIME = "# PyBot runtime v-next\n" + "def f():\n    return 42\n".repeat(120);
const RUNTIME_BYTES = ENC.encode(RUNTIME);

// ---------------------------------------------------------------------------
// Camino feliz: transferencia + verificación + apply
// ---------------------------------------------------------------------------

test("update transfers, verifies (size+hash) and applies (board swaps main.py)", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const res = await session.update(RUNTIME, { version: "3.2.0" });

  assert.equal(res.ok, true);
  assert.equal(res.version, "3.2.0");
  assert.equal(res.size, RUNTIME_BYTES.length);
  assert.deepEqual(asBytes(mock._state.mainRuntime), RUNTIME_BYTES);
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
  const total = RUNTIME_BYTES.length;
  const transfer = seen.filter((p) => p.phase === "transfer");
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

test("disconnect mid-update leaves the old runtime intact (never bricked)", async () => {
  const mock = makeMock({ disconnectAtChunk: 2 });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(
    () => session.update(RUNTIME, { version: "3.2.0" }),
    /BLE_UPDATE_DISCONNECTED/,
  );
  assert.equal(mock._state.mainRuntime, "# OLD RUNTIME 3.1.0\n");
  assert.equal(mock._state.applied, false);
  assert.equal(mock._state.newTmp, null);
  assert.equal(session.isBusy(), false);
});

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

// ---------------------------------------------------------------------------
// Punto 16 — transporte binario
// ---------------------------------------------------------------------------

test("TEST1: arbitrary bytes survive UPDATE chunks byte-for-byte", async () => {
  const input = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0x94, 0xe2, 0xff]);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(input, { version: "3.2.0" });
  assert.deepEqual(asBytes(mock._state.mainRuntime), input);
});

test("TEST2: em dash UTF-8 E2 80 94 is not corrupted to C3 A2 C2 80 C2 94", async () => {
  const input = new Uint8Array([0xe2, 0x80, 0x94]);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(input, { version: "3.2.0" });
  const got = asBytes(mock._state.mainRuntime);
  assert.deepEqual(got, input);
  assert.notDeepEqual(got, new Uint8Array([0xc3, 0xa2, 0xc2, 0x80, 0xc2, 0x94]));
});

test("TEST3: accented á (C3 A1) preserved", async () => {
  const input = ENC.encode("á");
  assert.deepEqual(input, new Uint8Array([0xc3, 0xa1]));
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(input, { version: "3.2.0" });
  assert.deepEqual(asBytes(mock._state.mainRuntime), input);
});

test("TEST4: BEGIN size is exact Uint8Array length", async () => {
  const input = new Uint8Array([0x80, 0x81, 0x82, 0xff]);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(input, { version: "3.2.0" });
  assert.equal(mock._state.begin.size, input.length);
  assert.match(mock._state.sent[0], new RegExp(`^UPDATE:BEGIN:3\\.2\\.0:${input.length}:`));
});

test("TEST5: BEGIN hash is sha256Hex of exact bytes", async () => {
  const input = new Uint8Array([0x00, 0xe2, 0x80, 0x94, 0xff]);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const res = await session.update(input, { version: "3.2.0" });
  assert.equal(res.hash, sha256Hex(input));
  assert.equal(res.hash, createHash("sha256").update(Buffer.from(input)).digest("hex"));
  assert.equal(mock._state.begin.hash, res.hash);
});

test("TEST6: chunks are <= 192 bytes and reassemble to payload", async () => {
  const input = new Uint8Array(UPDATE_SOURCE_CHUNK * 2 + 17);
  for (let i = 0; i < input.length; i++) input[i] = (i * 17 + 0x80) & 0xff;
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(input, { version: "3.2.0" });
  const chunkLines = mock._state.sent.filter((l) => l.startsWith(UPDATE.CHUNK + ":"));
  assert.equal(chunkLines.length, 3);
  for (let i = 0; i < chunkLines.length; i++) {
    const raw = base64ToBytes(chunkLines[i].slice((UPDATE.CHUNK + ":").length));
    if (i < chunkLines.length - 1) assert.equal(raw.length, UPDATE_SOURCE_CHUNK);
    else assert.ok(raw.length <= UPDATE_SOURCE_CHUNK);
  }
  assert.deepEqual(reassembleProgramBytes(mock._state.chunks), input);
});

test("TEST7: binary progress counts confirmed bytes", async () => {
  const input = new Uint8Array(UPDATE_SOURCE_CHUNK + 40);
  input.fill(0xaa);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const seen = [];
  await session.update(input, { version: "3.2.0", onProgress: (p) => seen.push(p) });
  const transfer = seen.filter((p) => p.phase === "transfer");
  assert.equal(transfer[0].total, input.length);
  assert.equal(transfer[transfer.length - 1].sent, input.length);
  assert.equal(transfer[transfer.length - 1].pct, 100);
  for (const p of transfer) assert.ok(p.sent <= p.total);
});

test("TEST8: string compatibility encodes via TextEncoder", async () => {
  const text = "hola á —";
  const expected = ENC.encode(text);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(text, { version: "3.2.0" });
  assert.deepEqual(asBytes(mock._state.mainRuntime), expected);
});

test("TEST9: sha256Hex(TextEncoder(string)) matches sha256HexUtf8(string)", () => {
  const s = "hola á — ESP32";
  assert.equal(sha256Hex(ENC.encode(s)), sha256HexUtf8(s));
});

test("TEST10: real buildBleRuntimePackBytes survives OTA session", async () => {
  const pack = buildBleRuntimePackBytesFromDisk();
  assert.ok(pack.length > UPDATE_SOURCE_CHUNK);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const res = await session.update(pack, { version: "9.9.9" });
  assert.equal(res.size, pack.length);
  assert.equal(res.hash, sha256Hex(pack));
  assert.deepEqual(asBytes(mock._state.mainRuntime), pack);
});

test("TEST11: real runtime non-ASCII (pybot_net em dash) survives pack OTA", async () => {
  const net = readFileSync(join(FW, "pybot_net.py"));
  assert.ok(net.includes(Buffer.from([0xe2, 0x80, 0x94])), "pybot_net.py must contain em dash UTF-8");
  const pack = buildBleRuntimePackBytesFromDisk();
  let found = false;
  for (let i = 0; i < pack.length - 2; i++) {
    if (pack[i] === 0xe2 && pack[i + 1] === 0x80 && pack[i + 2] === 0x94) {
      found = true;
      break;
    }
  }
  assert.ok(found, "pack must contain E2 80 94 from pybot_net.py");
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(pack, { version: "9.9.9" });
  const got = asBytes(mock._state.mainRuntime);
  assert.deepEqual(got, pack);
  let bad = false;
  for (let i = 0; i < got.length - 5; i++) {
    if (
      got[i] === 0xc3 &&
      got[i + 1] === 0xa2 &&
      got[i + 2] === 0xc2 &&
      got[i + 3] === 0x80 &&
      got[i + 4] === 0xc2 &&
      got[i + 5] === 0x94
    ) {
      bad = true;
      break;
    }
  }
  assert.equal(bad, false);
});

test("TEST12: PYBOTRT1 internal sizes match file UTF-8 bytes", () => {
  const pack = buildBleRuntimePackBytesFromDisk();
  const modules = getBleRuntimeModulesFromDisk();
  const magic = ENC.encode(PACK_MAGIC);
  assert.deepEqual(pack.subarray(0, magic.length), magic);
  let off = magic.length;
  for (const { name, source } of modules) {
    const nameBytes = ENC.encode(name + "\n");
    assert.deepEqual(pack.subarray(off, off + nameBytes.length), nameBytes);
    off += nameBytes.length;
    let nl = pack.indexOf(0x0a, off);
    const size = parseInt(new TextDecoder().decode(pack.subarray(off, nl)), 10);
    off = nl + 1;
    const data = pack.subarray(off, off + size);
    assert.equal(data.length, size);
    assert.deepEqual(data, ENC.encode(String(source ?? "")));
    off += size;
  }
  assert.equal(off, pack.length);
});

test("TEST13: hardwareBridge uses buildBleRuntimePackBytes, not Text", () => {
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  assert.match(bridge, /buildBleRuntimePackBytes\(\)/);
  assert.doesNotMatch(bridge, /buildBleRuntimePackText/);
});

test("TEST14: pybot_update.py receiver still a2b_base64 + write", () => {
  const src = readFileSync(join(root, "firmware/pybot-ble-runtime/pybot_update.py"), "utf8");
  assert.match(src, /ubinascii\.a2b_base64/);
  assert.match(src, /\.write\(data\)/);
});

test("TEST15: UPDATE protocol tokens and chunk size unchanged", () => {
  assert.equal(UPDATE_SOURCE_CHUNK, 192);
  assert.equal(UPDATE.BEGIN, "UPDATE:BEGIN");
  assert.equal(UPDATE.CHUNK, "UPDATE:CHUNK");
  assert.equal(UPDATE.END, "UPDATE:END");
  assert.equal(UPDATE.APPLY, "UPDATE:APPLY");
  assert.match(buildUpdateBegin("9.9.9", 3, "abc"), /^UPDATE:BEGIN:9\.9\.9:3:abc$/);
});

test("TEST16: Uint8Array over MAX_RUNTIME_UPDATE_SIZE rejected before BEGIN", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  const huge = new Uint8Array(MAX_RUNTIME_UPDATE_SIZE + 1);
  await assert.rejects(() => session.update(huge, { version: "3.2.0" }), /BLE_UPDATE_TOO_LONG/);
  assert.equal(mock._state.begin, null);
});

test("TEST17: empty Uint8Array → BLE_UPDATE_EMPTY", async () => {
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(() => session.update(new Uint8Array(0), { version: "3.2.0" }), /BLE_UPDATE_EMPTY/);
});

test("TEST18: transfer error still attempts UPDATE:ABORT", async () => {
  const mock = makeMock({ failChunkAt: 0 });
  const session = new BleRuntimeUpdateSession(mock);
  await assert.rejects(() => session.update(RUNTIME, { version: "3.2.0" }));
  assert.ok(mock._state.sent.includes(UPDATE.ABORT));
});

test("TEST19: ASCII string path still works", async () => {
  const ascii = "print(1)\n" + "x = 2\n".repeat(100);
  const mock = makeMock();
  const session = new BleRuntimeUpdateSession(mock);
  await session.update(ascii, { version: "3.2.0" });
  assert.deepEqual(asBytes(mock._state.mainRuntime), ENC.encode(ascii));
});

test("TEST20: pybot_boot_update.py streams pack bodies (#17)", () => {
  // #16 dejó el boot updater intacto; #17 lo convierte a 2 pasadas + chunks.
  const boot = readFileSync(join(root, "firmware/pybot-ble-runtime/pybot_boot_update.py"), "utf8");
  assert.match(boot, /_COPY_CHUNK\s*=\s*256/);
  assert.match(boot, /def _validate_pack/);
  assert.match(boot, /def _install_pack_files/);
  assert.doesNotMatch(boot, /def _parse_pack/);
  assert.doesNotMatch(boot, /f\.read\(sz\)/);
});

test("buildBleRuntimePackText removed from production", () => {
  const runtime = readFileSync(join(root, "src/pybotBleRuntime.js"), "utf8");
  assert.doesNotMatch(runtime, /buildBleRuntimePackText/);
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  assert.doesNotMatch(bridge, /buildBleRuntimePackText/);
});
