import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RBLE_VERSION,
  RBLE_TYPE_DATA,
  RBLE_TYPE_ACK,
  RBLE_TYPE_NACK,
  RBLE_TYPE_RESET,
  RBLE_WINDOW,
  RBLE_MAX_PAYLOAD,
  RBLE_ACK_TIMEOUT_MS,
  RBLE_RETRY_MAX,
  RBLE_CAPABILITY,
  crc16,
  encodeFrame,
  decodeFrame,
  seqLte,
  seqLt,
  ReliableBleTransport,
} from "../src/reliableBleTransport.js";
import { BleReplTransport } from "../src/micropython/bleReplTransport.js";
import {
  PYBOT_CAPABILITIES,
  PYBOT_CAPABILITY_RELIABLE_REPL,
  runtimeSupportsReliableRepl,
  PYBOT_RUNTIME_VERSION,
} from "../src/bleProtocol.js";
import { BYTE_CTRL_C, BYTE_CTRL_D } from "../src/micropython/constants.js";
import {
  classifyBleRuntime,
  planBleExecutionBackend,
  BLE_BACKEND,
} from "../src/micropython/bleBackend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const FW = join(root, "firmware/pybot-ble-runtime");

function readFw(name) {
  return readFileSync(join(FW, name), "utf8");
}

function u8(...bytes) {
  return new Uint8Array(bytes);
}

function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = { fn, at: t + ms, alive: true };
      timers.push(id);
      return id;
    },
    clearTimeout(id) {
      if (id) id.alive = false;
    },
    advance(ms) {
      t += ms;
      for (const id of timers) {
        if (id.alive && id.at <= t) {
          id.alive = false;
          id.fn();
        }
      }
    },
  };
}

function makeLink(opts = {}) {
  const dropDataOnce = new Set(opts.dropDataOnce ?? []);
  const dropAckOnce = new Set(opts.dropAckOnce ?? []);
  const corruptOnce = new Set(opts.corruptOnce ?? []);
  let aHandler = null;
  let bHandler = null;
  const stats = { aToB: 0, bToA: 0, dropped: 0, corrupted: 0 };

  function deliver(handler, bytes, parsed) {
    if (!handler) return;
    if (parsed?.type === RBLE_TYPE_DATA && dropDataOnce.has(parsed.seq)) {
      dropDataOnce.delete(parsed.seq);
      stats.dropped += 1;
      return;
    }
    if (parsed?.type === RBLE_TYPE_ACK && dropAckOnce.has(parsed.seq)) {
      dropAckOnce.delete(parsed.seq);
      stats.dropped += 1;
      return;
    }
    if (parsed?.type === RBLE_TYPE_DATA && corruptOnce.has(parsed.seq)) {
      corruptOnce.delete(parsed.seq);
      stats.corrupted += 1;
      const bad = new Uint8Array(bytes);
      bad[bad.length - 1] ^= 0xff;
      handler(bad);
      return;
    }
    handler(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  function side(getHandler, setHandler, toOther, dir) {
    return {
      isConnected: () => true,
      hasRepl: () => true,
      onReplData(cb) {
        setHandler(cb);
        return () => setHandler(null);
      },
      async writeRepl(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const parsed = decodeFrame(bytes);
        dir();
        deliver(getHandler(), bytes, parsed);
      },
    };
  }

  return {
    stats,
    sideA: side(
      () => bHandler,
      (cb) => {
        aHandler = cb;
      },
      null,
      () => {
        stats.aToB += 1;
      },
    ),
    sideB: side(
      () => aHandler,
      (cb) => {
        bHandler = cb;
      },
      null,
      () => {
        stats.bToA += 1;
      },
    ),
    // fix handlers: sideA writes go to bHandler (browser), sideB writes go to aHandler (esp)
    wire() {
      this.sideA = side(
        () => bHandler,
        (cb) => {
          aHandler = cb;
        },
        null,
        () => {
          stats.aToB += 1;
        },
      );
      this.sideB = side(
        () => aHandler,
        (cb) => {
          bHandler = cb;
        },
        null,
        () => {
          stats.bToA += 1;
        },
      );
      return this;
    },
  };
}

// makeLink as written: sideA.writeRepl delivers to bHandler, but onReplData of sideA sets aHandler.
// ReliableBleTransport(sideA) listens on sideA.onReplData → aHandler.
// ReliableBleTransport(sideB) listens on sideB.onReplData → bHandler.
// sideA.writeRepl should deliver to bHandler. First version of side() uses getHandler for the PEER.
// sideA: getHandler = () => bHandler, setHandler sets aHandler. Correct.

async function pair(opts = {}) {
  const link = makeLink(opts);
  const clock = opts.clock;
  const deps = {
    autoStart: false,
    ackTimeoutMs: opts.ackTimeoutMs ?? RBLE_ACK_TIMEOUT_MS,
  };
  if (clock) {
    deps.now = clock.now;
    deps.setTimeout = clock.setTimeout.bind(clock);
    deps.clearTimeout = clock.clearTimeout.bind(clock);
  }
  const esp = new ReliableBleTransport(link.sideA, deps);
  const browser = new ReliableBleTransport(link.sideB, deps);
  await esp.start();
  await browser.start();
  const received = [];
  browser.onReplData((chunk) => received.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)));
  return { esp, browser, received, link, clock, got: () => concat(received) };
}

test("capability reliable-repl-v1 is declared and not inferred by version", () => {
  assert.equal(RBLE_CAPABILITY, "reliable-repl-v1");
  assert.ok(PYBOT_CAPABILITIES.includes(PYBOT_CAPABILITY_RELIABLE_REPL));
  assert.equal(runtimeSupportsReliableRepl({ capabilities: ["native-repl", "reliable-repl-v1"] }), true);
  assert.equal(runtimeSupportsReliableRepl({ capabilities: ["native-repl"], firmware: "9.9.9" }), false);
  assert.equal(runtimeSupportsReliableRepl(null), false);
});

test("INFO/firmware declare reliable-repl-v1 and pybot_rble module", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /reliable-repl-v1/);
  assert.match(ble, /pybot_rble\.py/);
  const boot = readFw("pybot_boot_update.py");
  assert.match(boot, /pybot_rble\.py/);
  const rble = readFw("pybot_rble.py");
  assert.match(rble, /RBLE_VERSION = const\(1\)/);
  assert.match(rble, /TYPE_DATA = const\(1\)/);
  assert.match(rble, /TYPE_ACK = const\(2\)/);
  assert.match(rble, /TYPE_NACK = const\(3\)/);
  assert.match(rble, /TYPE_RESET = const\(4\)/);
  assert.match(rble, /_WINDOW = const\(2\)/);
  assert.doesNotMatch(rble, /sleep_ms/);
  assert.doesNotMatch(rble, /time\.sleep/);
  const repl = readFw("pybot_repl.py");
  assert.match(repl, /import pybot_rble/);
  assert.match(repl, /mark_sent/);
  assert.doesNotMatch(repl, /sleep_ms/);
});

test("frame format: type, seq, len, payload, CRC16-CCITT", () => {
  const payload = u8(0x61, 0x62, 0x04);
  const frame = encodeFrame(RBLE_TYPE_DATA, 7, payload);
  assert.equal(frame[0] >> 4, RBLE_VERSION);
  assert.equal(frame[0] & 0x0f, RBLE_TYPE_DATA);
  assert.equal((frame[1] << 8) | frame[2], 7);
  assert.equal(frame[3], 3);
  assert.deepEqual([...frame.subarray(4, 7)], [0x61, 0x62, 0x04]);
  const parsed = decodeFrame(frame);
  assert.equal(parsed.type, RBLE_TYPE_DATA);
  assert.equal(parsed.seq, 7);
  assert.deepEqual([...parsed.payload], [0x61, 0x62, 0x04]);
  const ack = encodeFrame(RBLE_TYPE_ACK, 7, u8());
  assert.equal(ack.length, 6);
  assert.equal(decodeFrame(ack).type, RBLE_TYPE_ACK);
  assert.equal(decodeFrame(encodeFrame(RBLE_TYPE_NACK, 3, u8())).type, RBLE_TYPE_NACK);
  assert.equal(decodeFrame(encodeFrame(RBLE_TYPE_RESET, 0, u8(2, 9))).payload[0], 2);
});

test("corrupted frame fails CRC and is not decoded", () => {
  const frame = encodeFrame(RBLE_TYPE_DATA, 1, u8(1, 2, 3));
  const bad = new Uint8Array(frame);
  bad[4] ^= 0xff;
  assert.equal(decodeFrame(bad), null);
  const truncated = frame.subarray(0, 5);
  assert.equal(decodeFrame(truncated), null);
});

test("JS crc16 matches firmware pybot_rble.crc16", () => {
  const sample = "0123456789abcdef";
  const js = crc16(new TextEncoder().encode(sample));
  const py = execSync(
    `python -c "import sys; sys.path.insert(0, r'${FW.replace(/\\/g, "\\\\")}'); import pybot_rble; print(pybot_rble.crc16(b'${sample}'))"`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(String(js), py);
});

test("window is 2; seqLte handles wrap", () => {
  assert.equal(RBLE_WINDOW, 2);
  assert.equal(RBLE_MAX_PAYLOAD, 14);
  assert.equal(seqLte(0, 0), true);
  assert.equal(seqLt(0, 1), true);
  assert.equal(seqLt(1, 0), false);
  assert.equal(seqLte(0xfffe, 1), true);
});

test("DATA+ACK round trip delivers original bytes once", async () => {
  const { esp, got } = await pair();
  const original = new TextEncoder().encode("hello-repl");
  await esp.writeRepl(original);
  assert.deepEqual([...got()], [...original]);
});

test("drop DATA seq 7: reconstructed stream equals original", async () => {
  const original = new Uint8Array(14 * 12);
  for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 3) & 0xff;
  const { esp, got, link } = await pair({ dropDataOnce: [7] });
  await esp.writeRepl(original);
  assert.equal(link.stats.dropped, 1);
  assert.deepEqual([...got()], [...original]);
});

test("drop ACK does not duplicate delivered payload", async () => {
  const original = new Uint8Array(14 * 4);
  original.fill(0x42);
  const { esp, got, link } = await pair({ dropAckOnce: [0] });
  await esp.writeRepl(original);
  assert.ok(link.stats.dropped >= 1);
  assert.deepEqual([...got()], [...original]);
});

test("duplicate DATA is discarded without duplicating bytes", async () => {
  const { browser, received } = await pair();
  const payload = u8(0x41, 0x42, 0x43);
  const frame = encodeFrame(RBLE_TYPE_DATA, 0, payload);
  browser._synced = true;
  browser._rxExpected = 0;
  browser._onRaw(frame);
  browser._onRaw(frame);
  browser._onRaw(frame);
  assert.equal(received.length, 1);
  assert.deepEqual([...received[0]], [0x41, 0x42, 0x43]);
});

test("gap (seq 2 before 0) sends NACK and does not reorder", async () => {
  const writes = [];
  const bt = {
    isConnected: () => true,
    hasRepl: () => true,
    onReplData() {
      return () => {};
    },
    async writeRepl(data) {
      writes.push(decodeFrame(data));
    },
  };
  const t = new ReliableBleTransport(bt, { autoStart: false });
  t._synced = true;
  t._rxExpected = 0;
  const got = [];
  t.onReplData((c) => got.push(c));
  t._onRaw(encodeFrame(RBLE_TYPE_DATA, 2, u8(0x22)));
  assert.equal(got.length, 0);
  const nack = writes.filter((w) => w && w.type === RBLE_TYPE_NACK);
  assert.ok(nack.length >= 1);
  assert.equal(nack[0].seq, 0);
  t._onRaw(encodeFrame(RBLE_TYPE_DATA, 0, u8(0x00)));
  t._onRaw(encodeFrame(RBLE_TYPE_DATA, 1, u8(0x11)));
  t._onRaw(encodeFrame(RBLE_TYPE_DATA, 2, u8(0x22)));
  assert.deepEqual([...concat(got)], [0x00, 0x11, 0x22]);
});

test("corrupted DATA is NACKed and later good frame delivers", async () => {
  const original = new Uint8Array(14 * 3);
  for (let i = 0; i < original.length; i++) original[i] = i & 0xff;
  const { esp, got } = await pair({ corruptOnce: [1] });
  await esp.writeRepl(original);
  assert.deepEqual([...got()], [...original]);
});

test("window full applies backpressure until ACK", async () => {
  const pending = [];
  const bt = {
    isConnected: () => true,
    hasRepl: () => true,
    onReplData() {
      return () => {};
    },
    async writeRepl(data) {
      pending.push(new Uint8Array(data));
    },
  };
  const t = new ReliableBleTransport(bt, { autoStart: false, ackTimeoutMs: 30_000 });
  t._synced = true;
  const chunk = new Uint8Array(RBLE_MAX_PAYLOAD * 3);
  chunk.fill(0x55);
  let settled = false;
  const p = t.writeRepl(chunk);
  p.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  let dataFrames = [];
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    dataFrames = pending.map(decodeFrame).filter((f) => f && f.type === RBLE_TYPE_DATA);
    if (dataFrames.length >= RBLE_WINDOW) break;
  }
  assert.ok(dataFrames.length <= RBLE_WINDOW, "outstanding DATA <= window");
  assert.equal(dataFrames.length, RBLE_WINDOW);
  assert.equal(t._window.length, RBLE_WINDOW);
  assert.equal(settled, false, "write waits for ACK when the window is full");
  t.reset("test-done");
});

test("RESET/RESYNC after reconnect does not deliver old session bytes", async () => {
  const { esp, browser, received } = await pair();
  await esp.writeRepl(u8(1, 2, 3));
  assert.ok(concat(received).length >= 3);
  received.length = 0;
  browser.reset("disconnect");
  await browser.start();
  assert.equal(concat(received).length, 0);
  await esp.start();
  await esp.writeRepl(u8(9, 9));
  assert.deepEqual([...concat(received)], [9, 9]);
});

test("lost frame then consecutive writes keep order", async () => {
  const a = new TextEncoder().encode("A".repeat(40));
  const b = new TextEncoder().encode("B".repeat(40));
  const c = new TextEncoder().encode("C".repeat(40));
  const { esp, got } = await pair({ dropDataOnce: [2] });
  await esp.writeRepl(a);
  await esp.writeRepl(b);
  await esp.writeRepl(c);
  assert.deepEqual([...got()], [...a, ...b, ...c]);
});

test("stdout + 0x04 + stderr + 0x04 preserved exactly", async () => {
  const stdout = new TextEncoder().encode("line1\nline2\n");
  const stderr = new TextEncoder().encode("Traceback (most recent call last):\n  File \"<stdin>\"\n");
  const stream = concat([stdout, u8(BYTE_CTRL_D), stderr, u8(BYTE_CTRL_D)]);
  const { esp, got } = await pair({ dropDataOnce: [1] });
  await esp.writeRepl(stream);
  assert.deepEqual([...got()], [...stream]);
});

test("Ctrl+C 0x03 is a DATA payload, not a control type collision", async () => {
  const { esp, got } = await pair();
  await esp.writeRepl(u8(BYTE_CTRL_C));
  assert.deepEqual([...got()], [BYTE_CTRL_C]);
  const framed = encodeFrame(RBLE_TYPE_DATA, 0, u8(BYTE_CTRL_C));
  assert.notEqual(framed[0] & 0x0f, BYTE_CTRL_C);
});

test("timeout retransmits unacked DATA without duplicating delivery", async () => {
  const original = u8(0x10, 0x11, 0x12);
  const { esp, got, link } = await pair({ dropAckOnce: [0], ackTimeoutMs: 40 });
  await esp.writeRepl(original);
  assert.ok(link.stats.dropped >= 1);
  assert.deepEqual([...got()], [...original]);
});

test("BleReplTransport over ReliableBleTransport is still a byte stream", async () => {
  const { esp, browser, received } = await pair();
  const ble = new BleReplTransport(browser);
  const chunks = [];
  ble.onData((c) => chunks.push(c));
  const payload = new TextEncoder().encode("raw-repl-bytes\n");
  await esp.writeRepl(payload);
  assert.deepEqual([...concat(chunks.length ? chunks : received)], [...payload]);
  await ble.close();
});

test("4.0.4 native-repl without reliable-repl-v1 needs update, never legacy", () => {
  const info = {
    firmware: "4.0.4",
    protocol: "3.2",
    capabilities: ["native-repl", "run", "stop"],
  };
  const classified = classifyBleRuntime({
    nativeFlagEnabled: true,
    info,
    hasReplChars: true,
  });
  assert.equal(classified.intent, "fail");
  assert.equal(classified.error, "BLE_REPL_NEEDS_UPDATE");
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info,
    hasReplChars: true,
    handshakeOk: true,
  });
  assert.equal(plan.createBleRunSession, false);
  assert.equal(plan.createMicroPythonSession, false);
  assert.equal(plan.diag.error, "BLE_REPL_NEEDS_UPDATE");
});

test("4.0.5 + reliable-repl-v1 plans native MicroPythonSession", () => {
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: {
      firmware: PYBOT_RUNTIME_VERSION,
      protocol: "3.2",
      capabilities: ["native-repl", "reliable-repl-v1", "run"],
    },
    hasReplChars: true,
    notifications: true,
    handshakeOk: true,
  });
  assert.equal(plan.diag.backend, BLE_BACKEND.NATIVE_REPL);
  assert.equal(plan.createMicroPythonSession, true);
  assert.equal(plan.createBleRunSession, false);
});

test("firmware pybot_repl drain does not treat gatts_notify as delivery", () => {
  const src = readFw("pybot_repl.py");
  const drainFn = src.slice(src.indexOf("def _drain_tx"), src.indexOf("def irq_put"));
  assert.match(drainFn, /mark_sent/);
  assert.match(drainFn, /gatts_notify/);
  assert.doesNotMatch(drainFn, /sleep/);
  assert.doesNotMatch(src, /STOP:FORCE/);
});
