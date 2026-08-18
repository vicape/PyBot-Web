import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPL_RX_UUID,
  REPL_TX_UUID,
  RX_UUID,
  TX_UUID,
  runtimeSupportsNativeRepl,
  PYBOT_CAPABILITIES,
} from "../src/bleProtocol.js";
import { isNativeBleEnabled } from "../src/micropython/featureFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FW = join(__dirname, "..", "firmware", "pybot-ble-runtime");
const SRC = join(__dirname, "..", "src");

function readFw(name) {
  return readFileSync(join(FW, name), "utf8");
}

test("REPL UUIDs are distinct from ADMIN RX/TX", () => {
  assert.equal(REPL_RX_UUID, "8fbc0004-4d5a-4b8c-9a1f-123456789004");
  assert.equal(REPL_TX_UUID, "8fbc0005-4d5a-4b8c-9a1f-123456789005");
  assert.notEqual(REPL_RX_UUID, RX_UUID);
  assert.notEqual(REPL_TX_UUID, TX_UUID);
});

test("capability native-repl is declared", () => {
  assert.ok(PYBOT_CAPABILITIES.includes("native-repl"));
  assert.equal(runtimeSupportsNativeRepl({ capabilities: ["native-repl"] }), true);
  assert.equal(runtimeSupportsNativeRepl({ capabilities: ["run"] }), false);
});

test("firmware BLE service registers REPL characteristics", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /8fbc0004-4d5a-4b8c-9a1f-123456789004/);
  assert.match(ble, /8fbc0005-4d5a-4b8c-9a1f-123456789005/);
  assert.match(ble, /attach_repl/);
  assert.match(ble, /inject_ctrl_c/);
  assert.match(ble, /_handle_repl_rx/);
});

test("pybot_repl IRQ path has no filesystem/import/sleep/json", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /def irq_put\(/);
  assert.match(src, /dupterm_notify/);
  assert.match(src, /class BleReplStream/);
  const irq = src.slice(src.indexOf("def irq_put"), src.indexOf("def inject_ctrl_c"));
  assert.doesNotMatch(irq, /open\(/);
  assert.doesNotMatch(irq, /json/);
  assert.doesNotMatch(irq, /sleep/);
  assert.doesNotMatch(irq, /import /);
});

/** Replica del ring RX + cola TX (write encola; drain consume tras notify OK). */
function makeReplStream(opts = {}) {
  const RING = 512;
  const TX_CHUNK = 20;
  const rx = new Uint8Array(RING);
  let h = 0;
  let t = 0;
  let n = 0;
  let overflow = 0;
  let notifyFail = 0;
  let notifyRetries = 0;
  let notifyUnexpected = 0;
  let ble = opts.ble ?? {};
  let conn = opts.conn !== undefined ? opts.conn : 1;
  const getConn = opts.getConn ?? (() => conn);
  const sent = [];
  const txQueue = [];
  let notifyFn = () => {};
  let scheduleBusy = false;
  let draining = false;

  function ringPut(data) {
    for (const c of data) {
      if (n >= RING) {
        overflow += 1;
        return;
      }
      rx[t] = c;
      t = (t + 1) % RING;
      n += 1;
    }
  }
  function ringGetInto(buf) {
    let take = buf.length > n ? n : buf.length;
    for (let i = 0; i < take; i++) {
      buf[i] = rx[h];
      h = (h + 1) % RING;
      n -= 1;
    }
    return take;
  }
  function classifyNotifyError(err) {
    if (getConn() == null || err?.disconnect || err?.errno === 107 || err?.errno === 19) {
      return "disconnect";
    }
    if (err?.unexpected || err?.errno === 22) return "unexpected";
    return "temporal";
  }
  function drainUntilBackpressure() {
    if (draining) return;
    draining = true;
    try {
      if (ble == null || getConn() == null) {
        if (txQueue.length > 0) notifyFail += 1;
        txQueue.length = 0;
        return;
      }
      while (txQueue.length > 0) {
        if (getConn() == null) {
          notifyFail += 1;
          txQueue.length = 0;
          return;
        }
        const pieceLen = Math.min(TX_CHUNK, txQueue.length);
        const piece = txQueue.slice(0, pieceLen);
        try {
          notifyFn(new Uint8Array(piece));
          sent.push(...piece);
          txQueue.splice(0, pieceLen);
        } catch (err) {
          const kind = classifyNotifyError(err);
          if (kind === "disconnect") {
            notifyFail += 1;
            txQueue.length = 0;
            return;
          }
          if (kind === "unexpected") {
            notifyUnexpected += 1;
            return;
          }
          notifyRetries += 1;
          return;
        }
      }
    } finally {
      draining = false;
    }
  }
  function scheduleDrain() {
    if (scheduleBusy) return;
    drainUntilBackpressure();
  }
  return {
    irqPut(data) {
      ringPut(data);
    },
    readinto(buf) {
      if (n <= 0) return null;
      return ringGetInto(buf);
    },
    write(data, notify) {
      notifyFn = notify ?? (() => {});
      if (ble == null || getConn() == null) return 0;
      for (const b of data) txQueue.push(b);
      scheduleDrain();
      return data.length;
    },
    flushDrain() {
      drainUntilBackpressure();
    },
    setConn(value) {
      conn = value;
    },
    setBle(value) {
      ble = value;
    },
    setScheduleBusy(value) {
      scheduleBusy = value;
    },
    stats() {
      return {
        overflow,
        notifyFail,
        notifyRetries,
        notifyUnexpected,
        txPending: txQueue.length,
      };
    },
    sentBytes: () => [...sent],
    clearSent() {
      sent.length = 0;
    },
    txPending: () => txQueue.length,
  };
}

test("readinto empty ring returns None, not 0 (dupterm EAGAIN vs EOF)", () => {
  const src = readFw("pybot_repl.py");
  const fn = src.slice(src.indexOf("def readinto"), src.indexOf("def write"));
  assert.match(fn, /if _rx_n <= 0:\s*\n\s*return None/);
  assert.doesNotMatch(fn, /if _rx_n <= 0:\s*\n\s*return 0/);
  const s = makeReplStream();
  assert.equal(s.readinto(new Uint8Array(8)), null);
});

test("readinto with data returns the correct count", () => {
  const s = makeReplStream();
  s.irqPut(new Uint8Array([0x03, 0x03, 0x01]));
  const buf = new Uint8Array(8);
  assert.equal(s.readinto(buf), 3);
  assert.deepEqual(Array.from(buf.subarray(0, 3)), [0x03, 0x03, 0x01]);
  assert.equal(s.readinto(new Uint8Array(8)), null);
});

test("S: RX overflow is counted, not silenced", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /_rx_overflow \+= 1/);
  const s = makeReplStream();
  const big = new Uint8Array(600);
  big.fill(1);
  s.irqPut(big);
  assert.ok(s.stats().overflow > 0);
});

test("T: write() buffers only; no sleep or gatts_notify in write()", () => {
  const src = readFw("pybot_repl.py");
  const writeFn = src.slice(src.indexOf("def write"), src.indexOf("def ioctl"));
  assert.doesNotMatch(writeFn, /sleep/);
  assert.doesNotMatch(writeFn, /gatts_notify/);
  assert.match(writeFn, /_tx_put\(/);
  assert.match(writeFn, /_schedule_drain\(/);
  assert.doesNotMatch(writeFn, /raise OSError/);
  assert.doesNotMatch(writeFn, /except OSError:/);
  assert.match(src, /def _drain_tx\(/);
  assert.match(src, /gatts_notify/);
});

test("T: consecutive writes beyond 2048 bytes are not dropped or claimed lost", () => {
  const src = readFw("pybot_repl.py");
  assert.doesNotMatch(src, /_TX_RING = const\(2048\)/);
  assert.doesNotMatch(src, /BLE TX queue full/);
  assert.doesNotMatch(src, /return 0\n        _schedule_drain/);
  const s = makeReplStream();
  const block = new Uint8Array(400);
  block.fill(0x41);
  let hold = true;
  const notify = () => {
    if (hold) {
      const e = new Error("hold drain");
      e.errno = 11;
      throw e;
    }
  };
  for (let i = 0; i < 6; i++) {
    assert.equal(s.write(block, notify), 400);
  }
  assert.equal(s.txPending(), 2400);
  assert.equal(s.sentBytes().length, 0);
  hold = false;
  s.flushDrain();
  assert.equal(s.sentBytes().length, 2400);
  assert.equal(s.txPending(), 0);
});

test("T: 45-byte TX sends all bytes in order and returns 45", () => {
  const s = makeReplStream();
  const payload = new Uint8Array(45);
  payload.fill(0x41);
  const chunks = [];
  const ret = s.write(payload, (piece) => {
    chunks.push([...piece]);
  });
  assert.equal(ret, 45);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 20);
  assert.equal(chunks[1].length, 20);
  assert.equal(chunks[2].length, 5);
  assert.deepEqual(s.sentBytes(), [...payload]);
  assert.equal(s.txPending(), 0);
});

test("T: >160-byte TX sends full payload (no burst cap)", () => {
  const s = makeReplStream();
  const payload = new Uint8Array(400);
  for (let i = 0; i < 100; i++) payload[i] = 0x41;
  for (let i = 100; i < 200; i++) payload[i] = 0x42;
  for (let i = 200; i < 300; i++) payload[i] = 0x43;
  for (let i = 300; i < 400; i++) payload[i] = 0x44;
  const ret = s.write(payload, () => {});
  assert.equal(ret, 400);
  assert.deepEqual(s.sentBytes(), [...payload]);
});

test("T: >1000-byte TX completes in order via async drain", () => {
  const s = makeReplStream();
  const payload = new Uint8Array(1200);
  for (let i = 0; i < payload.length; i++) payload[i] = 0x30 + (i % 10);
  const ret = s.write(payload, () => {});
  assert.equal(ret, payload.length);
  assert.deepEqual(s.sentBytes(), [...payload]);
  assert.equal(s.txPending(), 0);
});

test("T: drain sends while BLE accepts, keeps chunk on backpressure, no sleep", () => {
  const src = readFw("pybot_repl.py");
  const drainFn = src.slice(src.indexOf("def _drain_tx"), src.indexOf("def irq_put"));
  assert.doesNotMatch(drainFn, /sleep/);
  assert.doesNotMatch(drainFn, /_TX_RETRY_MAX/);
  assert.doesNotMatch(drainFn, /_TX_BURST/);
  assert.doesNotMatch(drainFn, /except Exception:/);
  assert.match(src, /_KIND_TEMPORAL/);
  assert.match(src, /_KIND_DISCONNECT/);
  assert.match(src, /_KIND_UNEXPECTED/);
  assert.match(drainFn, /except OSError as e:/);
  assert.match(drainFn, /_KIND_TEMPORAL/);
  assert.match(drainFn, /_KIND_DISCONNECT/);
  assert.match(drainFn, /_notify_unexpected/);
  assert.match(drainFn, /_tx_consume\(/);
  assert.match(drainFn, /_schedule_drain\(\)/);
});

test("T: transient gatts_notify fail then recover sends all bytes", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /_notify_retries \+= 1/);
  const s = makeReplStream();
  const payload = new Uint8Array(45);
  payload.fill(0x41);
  let calls = 0;
  const ret = s.write(payload, () => {
    calls += 1;
    if (calls === 2) throw new Error("notify saturated");
  });
  assert.equal(ret, 45);
  assert.equal(calls, 2);
  assert.equal(s.stats().notifyRetries, 1);
  assert.equal(s.stats().notifyFail, 0);
  assert.equal(s.txPending(), 25);
  s.flushDrain();
  assert.equal(calls, 4);
  assert.deepEqual(s.sentBytes(), [...payload]);
});

test("T: drain retries on persistent backpressure without losing queued bytes", () => {
  const s = makeReplStream();
  const payload = new Uint8Array(45);
  payload.fill(0x41);
  let fail = true;
  let calls = 0;
  s.write(payload, () => {
    calls += 1;
    if (fail) throw new Error("notify dead");
  });
  assert.equal(calls, 1);
  assert.equal(s.stats().notifyRetries, 1);
  assert.equal(s.stats().notifyFail, 0);
  assert.equal(s.sentBytes().length, 0);
  assert.equal(s.txPending(), 45);
  fail = false;
  s.flushDrain();
  assert.deepEqual(s.sentBytes(), [...payload]);
  assert.equal(s.txPending(), 0);
});

test("T: no connection returns 0, not false success", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /if _ble is None or _get_conn is None:\s*\n\s*return 0/);
  const s = makeReplStream({ conn: null });
  const payload = new Uint8Array(10);
  assert.equal(s.write(payload, () => {}), 0);
  assert.equal(s.sentBytes().length, 0);
  const s2 = makeReplStream();
  const queued = new Uint8Array(45);
  queued.fill(0x41);
  let hold = true;
  s2.write(queued, () => {
    if (hold) throw new Error("hold drain");
  });
  assert.equal(s2.txPending(), 45);
  s2.setConn(null);
  s2.flushDrain();
  assert.equal(s2.stats().notifyFail, 1);
  assert.equal(s2.txPending(), 0);
  assert.equal(s2.sentBytes().length, 0);
});

test("T: raw REPL byte sequence preserves order including both Ctrl+D", () => {
  const s = makeReplStream();
  const tb = new TextEncoder().encode("Traceback...KeyboardInterrupt...");
  const seq = new Uint8Array(1 + 1 + tb.length + 1);
  seq[0] = 0x6f;
  seq[1] = 0x04;
  seq.set(tb, 2);
  seq[seq.length - 1] = 0x04;
  const sent = [];
  const ret = s.write(seq, (piece) => {
    sent.push(...piece);
  });
  assert.equal(ret, seq.length);
  assert.deepEqual(sent, [...seq]);
});

test("T: pending Ctrl+C during TX does not raise from write()", () => {
  const src = readFw("pybot_repl.py");
  const writeFn = src.slice(src.indexOf("def write"), src.indexOf("def ioctl"));
  assert.doesNotMatch(writeFn, /raise KeyboardInterrupt/);
  assert.doesNotMatch(writeFn, /0x03/);
  const s = makeReplStream();
  s.irqPut(new Uint8Array([0x03]));
  const payload = new Uint8Array(45);
  payload.fill(0x41);
  const ret = s.write(payload, () => {});
  assert.equal(ret, 45);
  assert.deepEqual(s.sentBytes(), [...payload]);
  const buf = new Uint8Array(1);
  assert.equal(s.readinto(buf), 1);
  assert.equal(buf[0], 0x03);
});

test("T: ABCD 100x100 payload completes without truncation", () => {
  const s = makeReplStream();
  const text = "A".repeat(100) + "B".repeat(100) + "C".repeat(100) + "D".repeat(100);
  const payload = new TextEncoder().encode(text);
  const ret = s.write(payload, () => {});
  assert.equal(ret, payload.length);
  assert.deepEqual(s.sentBytes(), [...payload]);
  assert.equal(payload[payload.length - 1], "D".charCodeAt(0));
});

test("T: ABCD as four consecutive 100-byte writes preserves order", () => {
  const s = makeReplStream();
  const blocks = [
    new TextEncoder().encode("A".repeat(100)),
    new TextEncoder().encode("B".repeat(100)),
    new TextEncoder().encode("C".repeat(100)),
    new TextEncoder().encode("D".repeat(100)),
  ];
  const expected = [];
  for (const block of blocks) {
    assert.equal(s.write(block, () => {}), block.length);
    expected.push(...block);
  }
  assert.deepEqual(s.sentBytes(), expected);
  assert.equal(s.txPending(), 0);
});

test("T: backpressure resends pending chunk exactly once (no dup, no loss)", () => {
  const s = makeReplStream();
  const payload = new Uint8Array(20);
  payload.fill(0x42);
  let attempts = 0;
  s.write(payload, () => {
    attempts += 1;
    if (attempts === 1) throw new Error("EAGAIN");
  });
  assert.equal(s.txPending(), 20);
  assert.equal(s.sentBytes().length, 0);
  s.flushDrain();
  assert.equal(attempts, 2);
  assert.deepEqual(s.sentBytes(), [...payload]);
});

test("T: 20 consecutive blocks complete in order without loss or dup", () => {
  const s = makeReplStream();
  const expected = [];
  for (let i = 0; i < 20; i++) {
    const block = new Uint8Array(400);
    block.fill(0x41 + (i % 26));
    assert.equal(s.write(block, () => {}), 400);
    expected.push(...block);
  }
  assert.deepEqual(s.sentBytes(), expected);
  assert.equal(s.txPending(), 0);
});

test("T: 20 consecutive blocks survive held drain then flush", () => {
  const s = makeReplStream();
  let hold = true;
  const notify = () => {
    if (hold) {
      const e = new Error("EAGAIN");
      e.errno = 11;
      throw e;
    }
  };
  const expected = [];
  for (let i = 0; i < 20; i++) {
    const block = new Uint8Array(400);
    block.fill(0x30 + (i % 10));
    assert.equal(s.write(block, notify), 400);
    expected.push(...block);
  }
  assert.equal(s.txPending(), 8000);
  assert.equal(s.sentBytes().length, 0);
  hold = false;
  s.flushDrain();
  assert.deepEqual(s.sentBytes(), expected);
  assert.equal(s.txPending(), 0);
});

test("T: unexpected gatts_notify error keeps pending bytes (no false success)", () => {
  const src = readFw("pybot_repl.py");
  assert.match(src, /_notify_unexpected/);
  const s = makeReplStream();
  const payload = new Uint8Array(45);
  payload.fill(0x41);
  const ret = s.write(payload, () => {
    const e = new Error("EINVAL");
    e.errno = 22;
    e.unexpected = true;
    throw e;
  });
  assert.equal(ret, 45);
  assert.equal(s.stats().notifyUnexpected, 1);
  assert.equal(s.stats().notifyFail, 0);
  assert.equal(s.sentBytes().length, 0);
  assert.equal(s.txPending(), 45);
});

test("T: schedule busy does not orphan the TX queue", () => {
  const src = readFw("pybot_repl.py");
  const sched = src.slice(src.indexOf("def _schedule_drain"), src.indexOf("def _drain_tx"));
  assert.match(sched, /except RuntimeError:/);
  assert.doesNotMatch(sched, /except Exception:/);
  const s = makeReplStream();
  const payload = new Uint8Array(40);
  payload.fill(0x42);
  s.setScheduleBusy(true);
  assert.equal(s.write(payload, () => {}), 40);
  assert.equal(s.txPending(), 40);
  assert.equal(s.sentBytes().length, 0);
  s.setScheduleBusy(false);
  s.flushDrain();
  assert.deepEqual(s.sentBytes(), [...payload]);
  assert.equal(s.txPending(), 0);
});

test("native main returns to REPL; legacy loop is opt-in", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /pybot_legacy\.on/);
  assert.match(ble, /REPL nativo/);
  assert.match(ble, /micropython\.schedule/);
  assert.match(ble, /def _exec_student_app/);
});

test("pybot_repl.attach reports real dupterm success or raises", () => {
  const src = readFw("pybot_repl.py");
  const attach = src.slice(src.indexOf("def attach("), src.indexOf("\ndef detach("));
  assert.match(attach, /return True/);
  assert.match(attach, /dupterm\(_stream, 0\)/);
  assert.doesNotMatch(attach, /dupterm\(_stream, 1\)/);
  assert.match(attach, /raise /);
  assert.match(attach, /_tx_clear\(\)/);
});

test("STOP injects Ctrl+C into the REPL stream", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /inject_ctrl_c/);
  const repl = readFw("pybot_repl.py");
  assert.match(repl, /inject_ctrl_c/);
  assert.match(repl, /kbd_intr/);
});

test("native firmware does not monkeypatch time.sleep", () => {
  const repl = readFw("pybot_repl.py");
  assert.doesNotMatch(repl, /time\.sleep\s*=/);
  const writeFn = repl.slice(repl.indexOf("def write"), repl.indexOf("def ioctl"));
  assert.doesNotMatch(writeFn, /sleep/);
  const ble = readFw("pybot_ble.py");
  assert.doesNotMatch(ble, /time\.sleep\s*=/);
  const net = readFw("pybot_net.py");
  assert.doesNotMatch(net, /time\.sleep\s*=/);
});

test("ProgramManager monkeypatch remains LEGACY only (pybot_run.py)", () => {
  const run = readFw("pybot_run.py");
  assert.match(run, /LEGACY/);
  assert.match(run, /time\.sleep = _checked_sleep/);
});

test("web BluetoothTransport binds REPL chars separately from ADMIN", () => {
  const src = readFileSync(join(SRC, "bluetoothTransport.js"), "utf8");
  assert.match(src, /onReplData/);
  assert.match(src, /writeRepl/);
  assert.match(src, /_bindReplCharacteristics/);
  assert.match(src, /hasRepl/);
});

test("hardwareBridge native path sits between USB and legacy BLE", () => {
  const src = readFileSync(join(SRC, "hardwareBridge.js"), "utf8");
  const start = src.indexOf("export async function runOnBoard(");
  const after = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, after >= 0 ? after : undefined);
  const iUsb = body.indexOf("_mpSession");
  const iNative = body.indexOf("_bleMpSession");
  const iLegacy = body.indexOf("_bleRun");
  assert.ok(iUsb >= 0 && iNative >= 0 && iLegacy >= 0);
  assert.ok(iUsb < iNative, "USB before native BLE");
  assert.ok(iNative < iLegacy, "native BLE before legacy RUN");
  assert.equal(typeof isNativeBleEnabled, "function");
});

test("hardwareBridge Stop native uses Ctrl+C, not STOP:FORCE", () => {
  const src = readFileSync(join(SRC, "hardwareBridge.js"), "utf8");
  const start = src.indexOf("export async function stopBoardExecution(");
  const after = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, after >= 0 ? after : undefined);
  const nativeIdx = body.indexOf("ble-native");
  const forceIdx = body.indexOf("STOP_FORCE");
  assert.ok(nativeIdx >= 0);
  assert.ok(nativeIdx < forceIdx || forceIdx < 0 || body.indexOf("_bleMpSession") < forceIdx);
  assert.match(body, /kind: "no-session"/);
});
