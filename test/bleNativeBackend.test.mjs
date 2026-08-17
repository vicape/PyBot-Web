import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";
import { BleReplTransport } from "../src/micropython/bleReplTransport.js";
import { CTRL_A, CTRL_B, CTRL_C, CTRL_D } from "../src/micropython/constants.js";
import {
  BLE_BACKEND,
  planBleExecutionBackend,
  formatBleBackendDiagnosis,
} from "../src/micropython/bleBackend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

function readSrc(name) {
  return readFileSync(join(SRC, name), "utf8");
}

/**
 * Placa REPL falsa: USB y BLE son el mismo raw REPL.
 * Cualquier `while True` queda busy hasta Ctrl+C → KeyboardInterrupt.
 */
class FakeReplBoard {
  constructor() {
    this._cbs = new Set();
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this.writes = [];
    this._busy = false;
    this._raw = false;
    this._lastProgram = "";
    this.open = true;
    this.forceStopSeen = false;
  }

  isOpen() {
    return this.open;
  }

  onData(cb) {
    this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  emit(text) {
    const bytes = this._enc.encode(text);
    this._cbs.forEach((cb) => cb(bytes));
  }

  _isInfinite(body) {
    return /while\s+True\s*:/.test(body) || /for\s+\w+\s+in\s+range\s*\(\s*10\s*\*\*\s*9/.test(body);
  }

  async write(data) {
    const s = typeof data === "string" ? data : this._dec.decode(data);
    this.writes.push(s);
    if (s.includes("STOP:FORCE")) this.forceStopSeen = true;
    if (s.includes("\x05A\x01")) {
      this.emit("R\x00");
      return;
    }
    if (s.includes(CTRL_C) && this._busy) {
      this._busy = false;
      this.emit(CTRL_D + "Traceback (most recent call last):\nKeyboardInterrupt\n" + CTRL_D);
      return;
    }
    if (s.includes(CTRL_A)) {
      this._raw = true;
      this.emit("raw REPL; CTRL-B to exit\r\n>");
      return;
    }
    if (s.includes(CTRL_B)) {
      this._raw = false;
      this.emit("\r\n>>> ");
      return;
    }
    if (this._raw && s.includes(CTRL_D)) {
      const body = (this._lastProgram || "") + s.replaceAll(CTRL_D, "");
      this._lastProgram = "";
      if (this._isInfinite(body)) {
        this._busy = true;
        this.emit("OK\n");
        if (/print\s*\(/.test(body)) {
          this.emit("1\n");
        }
        return;
      }
      this.emit("OK\n");
      const m = body.match(/print\((['"])(.*?)\1\)/);
      if (m) this.emit(m[2] + "\n");
      else this.emit("ok\n");
      this.emit(CTRL_D + CTRL_D);
      return;
    }
    if (this._raw && s.length > 2 && !s.includes(CTRL_A) && !s.includes(CTRL_C)) {
      this._lastProgram = (this._lastProgram || "") + s;
    }
  }

  async close() {
    this.open = false;
  }
}

function bluetoothFromBoard(board) {
  const replCbs = new Set();
  const origEmit = board.emit.bind(board);
  board.emit = (text) => {
    origEmit(text);
    const bytes = new TextEncoder().encode(typeof text === "string" ? text : "");
    replCbs.forEach((cb) => {
      try {
        cb(bytes);
      } catch {
        /* ignore */
      }
    });
  };
  return {
    isConnected: () => board.isOpen(),
    hasRepl: () => true,
    onReplData(cb) {
      if (typeof cb === "function") replCbs.add(cb);
      return () => replCbs.delete(cb);
    },
    async writeRepl(data) {
      await board.write(data);
    },
  };
}

function nativeSession() {
  const board = new FakeReplBoard();
  const bt = bluetoothFromBoard(board);
  const transport = new BleReplTransport(bt);
  const session = new MicroPythonSession(transport, 115200);
  return { board, session };
}

const NATIVE_INFO = {
  firmware: "4.0.0",
  protocol: "3.2",
  capabilities: ["native-repl", "run", "stop"],
  dupterm: true,
};

test("handshake OK uses only NATIVE_REPL (never BleRunSession)", () => {
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: NATIVE_INFO,
    hasReplChars: true,
    notifications: true,
    handshakeOk: true,
  });
  assert.equal(plan.diag.backend, BLE_BACKEND.NATIVE_REPL);
  assert.equal(plan.createMicroPythonSession, true);
  assert.equal(plan.createBleRunSession, false);
});

test("plan: 4.0.0 + native-repl + handshake → MicroPythonSession, never BleRunSession", () => {
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: NATIVE_INFO,
    hasReplChars: true,
    notifications: true,
    handshakeOk: true,
  });
  assert.equal(plan.createMicroPythonSession, true);
  assert.equal(plan.createBleRunSession, false);
  assert.equal(plan.diag.backend, BLE_BACKEND.NATIVE_REPL);
});

test("F: native REPL handshake fail does not create BleRunSession", () => {
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: NATIVE_INFO,
    hasReplChars: true,
    notifications: true,
    handshakeOk: false,
    handshakeError: "BLE_REPL_HANDSHAKE_FAIL",
  });
  assert.equal(plan.createBleRunSession, false);
  assert.equal(plan.createMicroPythonSession, false);
  assert.equal(plan.diag.backend, null);
  assert.equal(plan.diag.error, "BLE_REPL_HANDSHAKE_FAIL");
});

test("F: native-repl without REPL chars does not create BleRunSession", () => {
  const plan = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: NATIVE_INFO,
    hasReplChars: false,
    handshakeOk: false,
  });
  assert.equal(plan.createBleRunSession, false);
  assert.equal(plan.diag.error, "BLE_REPL_CHARS_MISSING");
});

test("legacy only when flag is explicit or runtime has no native-repl", () => {
  const explicit = planBleExecutionBackend({
    nativeFlagEnabled: false,
    info: NATIVE_INFO,
    hasReplChars: true,
    handshakeOk: true,
  });
  assert.equal(explicit.createBleRunSession, true);
  assert.equal(explicit.diag.reason, "explicit-legacy-flag");

  const old = planBleExecutionBackend({
    nativeFlagEnabled: true,
    info: { firmware: "3.2.7", protocol: "3.1", capabilities: ["run", "stop"] },
    hasReplChars: false,
    handshakeOk: false,
  });
  assert.equal(old.createBleRunSession, true);
  assert.equal(old.diag.reason, "runtime-without-native-repl");
});

test("diagnosis line includes runtime, protocol, native-repl, chars, dupterm, handshake, backend", () => {
  const line = formatBleBackendDiagnosis({
    backend: BLE_BACKEND.NATIVE_REPL,
    runtime: "4.0.0",
    protocol: "3.2",
    nativeReplCap: true,
    replRx: true,
    replTx: true,
    notifications: true,
    dupterm: true,
    handshake: true,
    reason: "runtime-native-repl",
  });
  assert.match(line, /backend=NATIVE_REPL/);
  assert.match(line, /runtime=4\.0\.0/);
  assert.match(line, /protocol=3\.2/);
  assert.match(line, /native-repl=true/);
  assert.match(line, /REPL_RX/);
  assert.match(line, /REPL_TX/);
  assert.match(line, /dupterm=true/);
  assert.match(line, /handshake=ok/);
});

test("A: while True: pass → Stop → Ctrl+C → KeyboardInterrupt → stopped", async () => {
  const { board, session } = nativeSession();
  assert.equal(await session.detect(), true);
  let out = "";
  const p = session.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  await session.interrupt();
  await p;
  assert.match(out, /Detenido/);
  assert.equal(board.forceStopSeen, false);
  assert.ok(board.writes.some((w) => w.includes(CTRL_C)));
  await session.close();
});

test("B: CPU-bound loop without wait → Stop → interrupted", async () => {
  const { board, session } = nativeSession();
  await session.detect();
  let out = "";
  const p = session.runProgram("i = 0\nwhile True:\n    i += 1\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  await session.interrupt();
  await p;
  assert.match(out, /Detenido/);
  assert.equal(board.forceStopSeen, false);
  await session.close();
});

test("C: continuous print → Stop without STOP:FORCE", async () => {
  const { board, session } = nativeSession();
  await session.detect();
  let out = "";
  const p = session.runProgram("i = 0\nwhile True:\n    print(i)\n    i += 1\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  await session.interrupt();
  await p;
  assert.match(out, /Detenido|1/);
  assert.equal(board.forceStopSeen, false);
  assert.ok(!board.writes.join("").includes("STOP:FORCE"));
  await session.close();
});

test("D: Run → Stop → Run on native BLE REPL", async () => {
  const { session } = nativeSession();
  await session.detect();
  let out1 = "";
  const p1 = session.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: (c) => {
      out1 += c;
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  await session.interrupt();
  await p1;
  assert.match(out1, /Detenido/);
  let out2 = "";
  await session.runProgram('print("second")\n', {
    prelude: "",
    onOut: (c) => {
      out2 += c;
    },
  });
  assert.match(out2, /second/);
  await session.close();
});

test("E: 20 cycles Run infinite → Stop → Run → Stop", { timeout: 30000 }, async () => {
  const { board, session } = nativeSession();
  await session.detect();
  for (let i = 0; i < 20; i++) {
    let out = "";
    const p = session.runProgram("while True:\n    pass\n", {
      prelude: "",
      onOut: (c) => {
        out += c;
      },
    });
    await new Promise((r) => setTimeout(r, 15));
    await session.interrupt();
    await p;
    assert.match(out, /Detenido/, "cycle " + i);
  }
  assert.equal(board.forceStopSeen, false);
  await session.close();
});

test("hardwareBridge never constructs BleRunSession inside native failure", () => {
  const src = readSrc("hardwareBridge.js");
  const start = src.indexOf("async function activateBleExecutionBackend");
  assert.ok(start >= 0);
  const end = src.indexOf("export async function bleRunConnect", start);
  const body = src.slice(start, end >= 0 ? end : undefined);
  assert.match(body, /intent === "legacy"/);
  assert.match(body, /new BleRunSession/);
  const catchIdx = body.lastIndexOf("} catch (e)");
  assert.ok(catchIdx > 0);
  const catchBody = body.slice(catchIdx);
  assert.match(catchBody, /_bleRun = null/);
  assert.doesNotMatch(catchBody, /new BleRunSession/);
  assert.match(src, /BLE_NATIVE_REPL_FAIL/);
});

test("runOnBoard native fail does not fall through to runOnBoardBle automatically", () => {
  const src = readSrc("hardwareBridge.js");
  const start = src.indexOf("export async function runOnBoard(");
  const after = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, after >= 0 ? after : undefined);
  const iNative = body.indexOf("_bleMpSession");
  const iLegacy = body.indexOf("runOnBoardBle");
  const iFail = body.indexOf("BLE_NATIVE_REPL_FAIL");
  assert.ok(iNative >= 0 && iLegacy >= 0 && iFail >= 0);
  assert.ok(iNative < iLegacy);
  assert.ok(iLegacy < iFail);
});
