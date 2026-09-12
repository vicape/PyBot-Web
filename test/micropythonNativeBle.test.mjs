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

/** Mirror of native autostart profile selection (same rule as ProgramManager). */
function nativeAutostartProfileFromMeta(meta) {
  return meta && meta.profile === "ESP32" ? "ESP32" : "WEMOS";
}

test("native _exec_student_app applies app meta profile to EDA6 before student code", () => {
  const ble = readFw("pybot_ble.py");
  const fn = ble.slice(
    ble.indexOf("def _prepare_student_ns"),
    ble.indexOf("\ndef main("),
  );
  assert.match(fn, /meta = _load_app_meta\(\)/);
  assert.match(
    fn,
    /profile = "ESP32" if meta and meta\.get\("profile"\) == "ESP32" else "WEMOS"/,
  );
  const placaIdx = fn.indexOf("mod_eda6.PLACA_ACTUAL = profile");
  const execIdx = fn.indexOf("exec(code, ns)");
  assert.ok(placaIdx >= 0, "sets EDA6.PLACA_ACTUAL");
  assert.ok(execIdx >= 0, "executes student code");
  assert.ok(placaIdx < execIdx, "profile applied before student exec");
  const importIdx = fn.indexOf('mod_eda6 = __import__(_EDA6_LIB)');
  const copyIdx = fn.indexOf("for k in dir(mod_eda6)");
  assert.ok(importIdx >= 0 && placaIdx > importIdx && placaIdx < copyIdx);
});

test("native autostart profile mirror: ESP32 / WEMOS / fallback", () => {
  assert.equal(nativeAutostartProfileFromMeta({ profile: "ESP32" }), "ESP32");
  assert.equal(nativeAutostartProfileFromMeta({ profile: "WEMOS" }), "WEMOS");
  assert.equal(nativeAutostartProfileFromMeta({}), "WEMOS");
  assert.equal(nativeAutostartProfileFromMeta(null), "WEMOS");
  assert.equal(nativeAutostartProfileFromMeta({ profile: "OTHER" }), "WEMOS");
});

test("ProgramManager still sets EDA6.PLACA_ACTUAL from its profile", () => {
  const run = readFw("pybot_run.py");
  assert.match(run, /mod_eda6\.PLACA_ACTUAL = self\._profile/);
  assert.match(
    run,
    /self\._profile = "ESP32" if meta\.get\("profile"\) == "ESP32" else "WEMOS"/,
  );
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

/* ------------------------------------------------------------------ */
/* Punto 6: lifecycle liviano de app nativa persistente (sin pybot_run) */
/* ------------------------------------------------------------------ */

const MAX_AUTOSTART_FAILS = 3;

/** Mirror de _update_native_app_run_state / ProgramManager finish semantics. */
function updateNativeAppRunState(st, outcome, errText) {
  if (outcome === "error") {
    st.fail_count = (st.fail_count | 0) + 1;
    st.last_error = String(errText || "error").slice(0, 200);
    st.last_outcome = "error";
  } else {
    st.fail_count = 0;
    st.last_error = "";
    st.last_outcome = outcome;
  }
  return st;
}

function appInfoRunning(manager, runningOverride) {
  if (runningOverride !== null && runningOverride !== undefined) {
    return Boolean(runningOverride);
  }
  return Boolean(manager && manager.running && manager._persistent);
}

/** Mirror del override nativo: True solo si corre; None si no. */
function nativeRunningOverride(nativeRunning) {
  return nativeRunning ? true : null;
}

/**
 * Mirror del bloque nativo: running / action / Ctrl+C / ACK diferido / state.
 * No importa ProgramManager.
 */
function createNativeLifecycleMirror() {
  const native_app = { running: false, action: null };
  const sent = [];
  let deleted = false;
  let ctrlC = 0;
  let execCalls = 0;
  let secondStart = 0;
  const st = { fail_count: 0, last_error: "", last_outcome: "", safe_boot: false };

  function inject_ctrl_c() {
    ctrlC += 1;
  }

  function on_urgent(upper) {
    if (upper === "APP:STOP") {
      if (native_app.running) {
        native_app.action = "stop";
        inject_ctrl_c();
        return true; // no ACK inmediato
      }
      return false;
    }
    if (upper === "APP:DELETE") {
      if (native_app.running) {
        native_app.action = "delete";
        inject_ctrl_c();
        return true;
      }
      return false;
    }
    if (upper === "STOP:FORCE") {
      if (native_app.running) {
        // agenda Timer; no reset en IRQ
        return { scheduled: true, resetInIrq: false };
      }
      return { scheduled: false, resetInIrq: false };
    }
    return false;
  }

  function finish(outcome, errorText) {
    native_app.running = false;
    const action = native_app.action;
    native_app.action = null;
    updateNativeAppRunState(st, outcome, errorText);
    if (action === "delete") {
      deleted = true;
      sent.push("APP:OK:DELETE");
    } else if (action === "stop") {
      sent.push("APP:OK:STOP");
    }
  }

  function runAutostart(execFn) {
    native_app.running = true;
    native_app.action = null;
    let outcome = "done";
    let errorText = null;
    try {
      execCalls += 1;
      execFn();
    } catch (e) {
      if (e && e.name === "KeyboardInterrupt") {
        outcome = "stopped";
      } else {
        outcome = "error";
        errorText = e && e.message ? e.message : String(e);
      }
    } finally {
      finish(outcome, errorText);
    }
  }

  function handleApp(cmd, manager = null) {
    const runningOv = nativeRunningOverride(native_app.running);
    if (cmd === "APP:INFO") {
      return { running: appInfoRunning(manager, runningOv) };
    }
    if (cmd === "APP:START") {
      if (runningOv) {
        sent.push("APP:ERROR:BUSY");
        return "APP:ERROR:BUSY";
      }
      secondStart += 1;
      sent.push("APP:OK:START");
      return "APP:OK:START";
    }
    return null;
  }

  function shouldAutostart() {
    if (st.safe_boot) return false;
    if ((st.fail_count | 0) >= MAX_AUTOSTART_FAILS) return false;
    return true;
  }

  return {
    native_app,
    sent,
    st,
    get deleted() {
      return deleted;
    },
    get ctrlC() {
      return ctrlC;
    },
    get execCalls() {
      return execCalls;
    },
    get secondStart() {
      return secondStart;
    },
    on_urgent,
    runAutostart,
    handleApp,
    shouldAutostart,
  };
}

test("native lifecycle: source has native_app state and finish helper", () => {
  const ble = readFw("pybot_ble.py");
  const deploy = readFw("pybot_deploy.py");
  assert.match(ble, /"native_app":\s*\{\s*"running":\s*False,\s*"action":\s*None\s*\}/);
  assert.match(ble, /def _program_running/);
  assert.match(ble, /def _native_irq_stop/);
  assert.match(deploy, /def finish_native_app/);
  assert.match(deploy, /def update_native_run_state/);
  // Precarga de ProgramManager solo bajo `if not native`.
  assert.match(ble, /if not native:\s*\n\s*try:\s*\n\s*_ensure_manager\(\)/m);
});

test("TEST1 native autostart marks running=true before exec", () => {
  const ble = readFw("pybot_ble.py");
  const block = ble.slice(ble.indexOf("if native:"), ble.indexOf("else:\n                    _maybe_autostart"));
  const runIdx = block.indexOf('na["running"] = True');
  const execIdx = block.indexOf("_exec_student_app(ns)");
  assert.ok(runIdx >= 0 && execIdx > runIdx);

  const m = createNativeLifecycleMirror();
  let sawRunning = false;
  m.runAutostart(() => {
    sawRunning = m.native_app.running === true;
  });
  assert.equal(sawRunning, true);
});

test("TEST2 native autostart always returns running=false after finish", () => {
  const m1 = createNativeLifecycleMirror();
  m1.runAutostart(() => {});
  assert.equal(m1.native_app.running, false);

  const m2 = createNativeLifecycleMirror();
  m2.runAutostart(() => {
    const err = new Error("boom");
    err.name = "KeyboardInterrupt";
    throw err;
  });
  assert.equal(m2.native_app.running, false);

  const m3 = createNativeLifecycleMirror();
  m3.runAutostart(() => {
    throw new Error("fail");
  });
  assert.equal(m3.native_app.running, false);
});

test("TEST3 APP:INFO during native autostart reports running=true", () => {
  const m = createNativeLifecycleMirror();
  let info = null;
  m.runAutostart(() => {
    info = m.handleApp("APP:INFO");
  });
  assert.deepEqual(info, { running: true });
});

test("TEST4 APP:INFO after finish reports running=false", () => {
  const m = createNativeLifecycleMirror();
  m.runAutostart(() => {});
  assert.deepEqual(m.handleApp("APP:INFO"), { running: false });
});

test("APP:INFO: manager persistent running wins when native_app is idle", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(
    ble,
    /ov = True if \(native and ctx\["native_app"\]\.get\("running"\)\) else None/,
  );
  const manager = { running: true, _persistent: true };
  assert.equal(
    appInfoRunning(manager, nativeRunningOverride(false)),
    true,
  );
  assert.equal(appInfoRunning(null, nativeRunningOverride(false)), false);
  assert.equal(appInfoRunning(null, nativeRunningOverride(true)), true);
});

test("TEST5 APP:STOP during native autostart: flag + Ctrl+C, ACK after exec", () => {
  const m = createNativeLifecycleMirror();
  let midAck = null;
  m.runAutostart(() => {
    assert.equal(m.on_urgent("APP:STOP"), true);
    assert.equal(m.native_app.action, "stop");
    assert.equal(m.ctrlC, 1);
    midAck = m.sent.includes("APP:OK:STOP");
    const err = new Error("stop");
    err.name = "KeyboardInterrupt";
    throw err;
  });
  assert.equal(midAck, false);
  assert.ok(m.sent.includes("APP:OK:STOP"));
  assert.equal(m.native_app.running, false);
  assert.equal(m.st.last_outcome, "stopped");
});

test("TEST6 APP:DELETE during native autostart: stop first, delete after, ACK after", () => {
  const m = createNativeLifecycleMirror();
  let deletedDuring = false;
  m.runAutostart(() => {
    assert.equal(m.on_urgent("APP:DELETE"), true);
    assert.equal(m.native_app.action, "delete");
    deletedDuring = m.deleted;
    const err = new Error("stop");
    err.name = "KeyboardInterrupt";
    throw err;
  });
  assert.equal(deletedDuring, false);
  assert.equal(m.deleted, true);
  assert.ok(m.sent.includes("APP:OK:DELETE"));
});

test("TEST7 APP:START while native running returns BUSY and does not start second", () => {
  const m = createNativeLifecycleMirror();
  let mid = null;
  m.runAutostart(() => {
    mid = m.handleApp("APP:START");
  });
  assert.equal(mid, "APP:ERROR:BUSY");
  assert.equal(m.execCalls, 1);
  assert.equal(m.secondStart, 0);
});

test("TEST8 normal finish: fail_count=0, last_error='', last_outcome=done", () => {
  const m = createNativeLifecycleMirror();
  m.st.fail_count = 2;
  m.st.last_error = "old";
  m.runAutostart(() => {});
  assert.equal(m.st.fail_count, 0);
  assert.equal(m.st.last_error, "");
  assert.equal(m.st.last_outcome, "done");
});

test("TEST9 KeyboardInterrupt: fail_count=0, last_error='', last_outcome=stopped", () => {
  const m = createNativeLifecycleMirror();
  m.st.fail_count = 1;
  m.runAutostart(() => {
    const err = new Error("ki");
    err.name = "KeyboardInterrupt";
    throw err;
  });
  assert.equal(m.st.fail_count, 0);
  assert.equal(m.st.last_error, "");
  assert.equal(m.st.last_outcome, "stopped");
});

test("TEST10 Exception: fail_count+=1, last_error set, last_outcome=error", () => {
  const m = createNativeLifecycleMirror();
  m.st.fail_count = 1;
  m.runAutostart(() => {
    throw new Error("sensor fail");
  });
  assert.equal(m.st.fail_count, 2);
  assert.match(m.st.last_error, /sensor fail/);
  assert.equal(m.st.last_outcome, "error");
});

test("TEST11 fail_count >= _MAX_AUTOSTART_FAILS still blocks autostart", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /_MAX_AUTOSTART_FAILS = const\(3\)/);
  assert.match(
    ble,
    /elif int\(st\.get\("fail_count", 0\)\) < _MAX_AUTOSTART_FAILS:/,
  );
  const m = createNativeLifecycleMirror();
  m.st.fail_count = MAX_AUTOSTART_FAILS;
  assert.equal(m.shouldAutostart(), false);
  m.st.fail_count = MAX_AUTOSTART_FAILS - 1;
  assert.equal(m.shouldAutostart(), true);
});

test("TEST12 STOP:FORCE recognizes native_app running without reset in IRQ", () => {
  const ble = readFw("pybot_ble.py");
  const urgent = ble.slice(ble.indexOf("def on_urgent"), ble.indexOf("def on_command"));
  assert.match(urgent, /STOP:FORCE/);
  assert.match(urgent, /_program_running\(\)/);
  assert.match(urgent, /_schedule_force_reset\(\)/);
  assert.doesNotMatch(urgent, /machine\.reset\(\)/);

  const m = createNativeLifecycleMirror();
  m.native_app.running = true;
  const r = m.on_urgent("STOP:FORCE");
  assert.equal(r.scheduled, true);
  assert.equal(r.resetInIrq, false);
});

test("TEST13 native boot still does not import pybot_run", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /LEGACY ONLY: precargar ProgramManager/);
  assert.match(ble, /4\.0 NO importa\s*\r?\n\s*# pybot_run al boot/m);
  const main = ble.slice(ble.indexOf("def main("));
  const marker = 'na["running"] = True';
  const nativeStart = main.indexOf(marker);
  assert.ok(nativeStart >= 0);
  const finishCall = "finish_native_app(";
  const nativeEnd = main.indexOf(finishCall, nativeStart);
  assert.ok(nativeEnd > nativeStart);
  const nativeBranch = main.slice(nativeStart, nativeEnd + 80);
  assert.match(nativeBranch, /_exec_student_app\(ns\)/);
  assert.match(nativeBranch, /_cleanup_native_student\(/);
  assert.match(nativeBranch, /finish_native_app\(/);
  assert.doesNotMatch(nativeBranch, /_ensure_manager|_load_run|import pybot_run|from pybot_run/);
  assert.match(main, /if not native:\s*\r?\n\s*try:\s*\r?\n\s*_ensure_manager\(\)/m);
});

test("TEST14 EDA6 profile fix still present before exec(code, ns)", () => {
  const ble = readFw("pybot_ble.py");
  const fn = ble.slice(
    ble.indexOf("def _prepare_student_ns"),
    ble.indexOf("\ndef main("),
  );
  const placaIdx = fn.indexOf("mod_eda6.PLACA_ACTUAL = profile");
  const execIdx = fn.indexOf("exec(code, ns)");
  assert.ok(placaIdx >= 0 && execIdx > placaIdx);
});

test("deploy APP:INFO accepts running_override without manager", () => {
  const deploy = readFw("pybot_deploy.py");
  assert.match(deploy, /def _app_info_json\(manager, running_override=None\)/);
  assert.match(deploy, /def handle_app\(send, manager, cmd, running_override=None\)/);
  assert.match(deploy, /if running_override is not None:/);
  assert.match(deploy, /APP:ERROR:BUSY/);
  assert.equal(appInfoRunning(null, true), true);
  assert.equal(appInfoRunning(null, null), false);
  assert.equal(appInfoRunning({ running: true, _persistent: true }, null), true);
  assert.equal(appInfoRunning({ running: true, _persistent: true }, false), false);
});

// ---------------------------------------------------------------------------
// #18 — native autostart cleanup (paridad con ProgramManager._cleanup)
// ---------------------------------------------------------------------------

test("#18 firmware: _cleanup_native_student before finish_native_app", () => {
  const ble = readFw("pybot_ble.py");
  assert.match(ble, /def _cleanup_native_student\(/);
  assert.match(ble, /keep_servos = outcome == "done"/);
  assert.match(ble, /_pybot_cleanup_normal/);
  assert.match(ble, /mod_mpy.*_pybot_cleanup|_pybot_cleanup/);
  const main = ble.slice(ble.indexOf("def main("));
  const marker = 'na["running"] = True';
  const start = main.indexOf(marker);
  const finish = main.indexOf("finish_native_app(", start);
  const block = main.slice(start, finish + 40);
  const cleanIdx = block.indexOf("_cleanup_native_student(");
  const finIdx = block.indexOf("finish_native_app(");
  assert.ok(cleanIdx >= 0 && finIdx > cleanIdx);
});

test("#18 done → cleanup_normal; stop/error → detenerTodo + mpy cleanup", () => {
  /** Mirror mínimo de _cleanup_native_student. */
  function cleanupNative(ns, outcome, hooks) {
    const keep = outcome === "done";
    try {
      if (keep) {
        hooks.normal();
      } else {
        if (typeof ns.detenerTodo === "function") ns.detenerTodo();
      }
    } catch {
      /* ignore */
    }
    try {
      hooks.mpy();
    } catch {
      /* ignore */
    }
  }

  const calls = [];
  const ns = { detenerTodo: () => calls.push("detenerTodo") };
  cleanupNative(ns, "done", {
    normal: () => calls.push("normal"),
    mpy: () => calls.push("mpy"),
  });
  assert.deepEqual(calls, ["normal", "mpy"]);

  calls.length = 0;
  cleanupNative(ns, "stopped", {
    normal: () => calls.push("normal"),
    mpy: () => calls.push("mpy"),
  });
  assert.deepEqual(calls, ["detenerTodo", "mpy"]);

  calls.length = 0;
  cleanupNative(ns, "error", {
    normal: () => calls.push("normal"),
    mpy: () => calls.push("mpy"),
  });
  assert.deepEqual(calls, ["detenerTodo", "mpy"]);
});

test("#18 cleanup que falla no tapa outcome ni ACK", () => {
  const m = createNativeLifecycleMirror();
  const outcomes = [];
  function runWithCleanup(execFn, cleanupFn) {
    m.native_app.running = true;
    m.native_app.action = "stop";
    let outcome = "done";
    let errorText = null;
    try {
      execFn();
    } catch (e) {
      if (e && e.name === "KeyboardInterrupt") outcome = "stopped";
      else {
        outcome = "error";
        errorText = e.message;
      }
    } finally {
      try {
        cleanupFn();
      } catch {
        /* must not alter outcome */
      }
      m.native_app.running = false;
      const action = m.native_app.action;
      m.native_app.action = null;
      updateNativeAppRunState(m.st, outcome, errorText);
      if (action === "stop") m.sent.push("APP:OK:STOP");
      outcomes.push(outcome);
    }
  }
  runWithCleanup(
    () => {
      throw Object.assign(new Error("x"), { name: "KeyboardInterrupt" });
    },
    () => {
      throw new Error("cleanup boom");
    },
  );
  assert.equal(outcomes[0], "stopped");
  assert.ok(m.sent.includes("APP:OK:STOP"));
  assert.equal(m.st.last_outcome, "stopped");
});

test("#18 ProgramManager keep_servos parity still present", () => {
  const run = readFw("pybot_run.py");
  assert.match(run, /keep_servos=\(outcome == "done"\)/);
  assert.match(run, /_pybot_cleanup_normal/);
});

// ---------------------------------------------------------------------------
// #20 — DEPLOY/UPDATE BUSY mientras native_app.running
// ---------------------------------------------------------------------------

test("#20 DeployReceiver/UpdateReceiver aceptan is_busy opcional", () => {
  const deploy = readFw("pybot_deploy.py");
  const update = readFw("pybot_update.py");
  const ble = readFw("pybot_ble.py");
  assert.match(deploy, /def __init__\(self, send, manager, is_busy=None\)/);
  assert.match(deploy, /self\._manager\.running or \(self\._is_busy and self\._is_busy\(\)\)/);
  assert.match(update, /def __init__\(self, send, manager, deploy, is_busy=None\)/);
  assert.match(update, /if self\._is_busy and self\._is_busy\(\):/);
  assert.match(ble, /def _native_busy\(\):/);
  assert.match(ble, /DeployReceiver\(\s*_send, _ensure_manager\(\), _native_busy\s*\)/);
  assert.match(
    ble,
    /RuntimeUpdateReceiver\(\s*_send, _ensure_manager\(\), _ensure_deploy\(\), _native_busy\s*\)/,
  );
});

test("#20 mirror: native running → DEPLOY/UPDATE BUSY; idle → ok", () => {
  function deployBegin(managerRunning, nativeRunning) {
    const sent = [];
    const isBusy = () => nativeRunning;
    if (managerRunning || isBusy()) {
      sent.push("DEPLOY:ERROR:BUSY");
      return sent;
    }
    sent.push("DEPLOY:READY");
    return sent;
  }
  function updateBusy(managerRunning, deployActive, nativeRunning) {
    if (managerRunning) return true;
    if (deployActive) return true;
    if (nativeRunning) return true;
    return false;
  }
  assert.deepEqual(deployBegin(false, true), ["DEPLOY:ERROR:BUSY"]);
  assert.deepEqual(deployBegin(true, false), ["DEPLOY:ERROR:BUSY"]);
  assert.deepEqual(deployBegin(false, false), ["DEPLOY:READY"]);
  assert.equal(updateBusy(false, false, true), true);
  assert.equal(updateBusy(false, true, false), true);
  assert.equal(updateBusy(true, false, false), true);
  assert.equal(updateBusy(false, false, false), false);
});

// ---------------------------------------------------------------------------
// #19 — native autostart respeta meta.mode
// ---------------------------------------------------------------------------

test("#19 prepare importa EDA6 solo si mode=eda6", () => {
  const ble = readFw("pybot_ble.py");
  const prep = ble.slice(
    ble.indexOf("def _prepare_student_ns"),
    ble.indexOf("def _exec_student_app"),
  );
  assert.match(prep, /mode = "eda6" if meta and meta\.get\("mode"\) == "eda6" else "mpy"/);
  assert.match(prep, /if mode == "eda6":/);
  const eda6Import = prep.indexOf('mod_eda6 = __import__(_EDA6_LIB)');
  const modeGate = prep.indexOf('if mode == "eda6":');
  assert.ok(modeGate >= 0 && eda6Import > modeGate);
  // mpy / net siguen fuera del gate eda6
  const mpyImport = prep.indexOf('mod_mpy = __import__(_MPY_LIB)');
  assert.ok(mpyImport > eda6Import);
  assert.match(prep, /import pybot_net/);
});

test("#19 cleanup EDA6 solo en mode eda6; mpy siempre limpia pybot_mpy", () => {
  const ble = readFw("pybot_ble.py");
  const clean = ble.slice(
    ble.indexOf("def _cleanup_native_student"),
    ble.indexOf("\ndef main("),
  );
  assert.match(clean, /mode = "eda6" if meta and meta\.get\("mode"\) == "eda6" else "mpy"/);
  assert.match(clean, /if mode == "eda6":/);
  assert.match(clean, /_pybot_cleanup_normal/);
  assert.match(clean, /_pybot_cleanup/);
});

test("#19 mirror: mpy ns sin símbolos EDA6; eda6 los incluye", () => {
  function prepareNs(meta, libs) {
    const mode = meta && meta.mode === "eda6" ? "eda6" : "mpy";
    const ns = {};
    if (mode === "eda6") {
      for (const [k, v] of Object.entries(libs.eda6)) ns[k] = v;
    }
    for (const [k, v] of Object.entries(libs.mpy)) ns[k] = v;
    for (const [k, v] of Object.entries(libs.net)) ns[k] = v;
    return ns;
  }
  const libs = {
    eda6: { servomotor: 1, detenerTodo: 2 },
    mpy: { pin: 3 },
    net: { wifi_conectar: 4 },
  };
  const mpyNs = prepareNs({ mode: "mpy" }, libs);
  assert.equal(mpyNs.servomotor, undefined);
  assert.equal(mpyNs.detenerTodo, undefined);
  assert.equal(mpyNs.pin, 3);
  assert.equal(mpyNs.wifi_conectar, 4);
  const edaNs = prepareNs({ mode: "eda6", profile: "WEMOS" }, libs);
  assert.equal(edaNs.servomotor, 1);
  assert.equal(edaNs.pin, 3);
});
