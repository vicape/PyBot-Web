import test from "node:test";
import assert from "node:assert/strict";

import { ReliableBleTransport } from "../src/reliableBleTransport.js";
import { BleReplTransport } from "../src/micropython/bleReplTransport.js";
import { MicroPythonSession } from "../src/micropython/micropythonSession.js";

function physicalBle() {
  const sent = [];
  return {
    sent,
    isConnected: () => true,
    hasRepl: () => true,
    getReplStatus: () => ({ rx: true, tx: true, notifications: true, bindError: null }),
    onReplData: () => () => {},
    onStateChange: () => () => {},
    writeRepl: async () => {},
    send: async (msg) => sent.push(msg),
  };
}

test("ReliableBleTransport sends urgent Stop over ADMIN, not reliable REPL DATA", async () => {
  const phy = physicalBle();
  const rble = new ReliableBleTransport(phy, { autoStart: false });

  await rble.interruptUrgent();

  assert.deepEqual(phy.sent, ["STOP"]);
  assert.equal(rble._window.length, 0);
  assert.equal(rble._txQueue.length, 0);
});

test("BleReplTransport urgent Stop bypasses a blocked normal write queue", async () => {
  let releaseWrite;
  let urgent = 0;
  const reliable = {
    isConnected: () => true,
    hasRepl: () => true,
    onReplData: () => () => {},
    writeRepl: () => new Promise((resolve) => { releaseWrite = resolve; }),
    interruptUrgent: async () => { urgent += 1; },
  };
  const tr = new BleReplTransport(reliable);

  const blockedWrite = tr.write(new Uint8Array([0x41]));
  await Promise.resolve();
  await tr.interruptUrgent();

  assert.equal(urgent, 1);
  releaseWrite();
  await blockedWrite;
});

test("MicroPythonSession prefers urgent transport interrupt and sends no queued Ctrl+C", async () => {
  let urgent = 0;
  const normalWrites = [];
  const transport = {
    port: null,
    onData: () => () => {},
    write: async (bytes) => normalWrites.push(Array.from(bytes)),
    interruptUrgent: async () => { urgent += 1; },
  };
  const session = new MicroPythonSession(transport);

  await session.interrupt();

  assert.equal(urgent, 1);
  assert.deepEqual(normalWrites, []);
});

test("Stop arriving while program bytes are being sent never reports started", async () => {
  let urgent = 0;
  let releaseUpload;
  let started = 0;
  const output = [];
  const transport = {
    port: null,
    onData: () => () => {},
    write: async () => {},
    interruptUrgent: async () => { urgent += 1; },
  };
  const session = new MicroPythonSession(transport);

  session.protocol.enterRawRepl = async () => {};
  session._execProgramBytes = () => new Promise((resolve) => { releaseUpload = resolve; });
  session.protocol.followExecution = async () => ({ stdout: "", stderr: "KeyboardInterrupt\r\n" });
  session.protocol.exitRawRepl = async () => {};

  const running = session.runProgram("while True: pass", {
    onStarted: () => { started += 1; },
    onOut: (s) => output.push(s),
    shouldStop: () => session._interrupted,
  });

  await Promise.resolve();
  await Promise.resolve();
  await session.interrupt();
  releaseUpload();
  const result = await running;

  assert.equal(urgent, 1);
  assert.equal(started, 0);
  assert.equal(result.interrupted, true);
  assert.match(output.join(""), /Detenido/);
});
