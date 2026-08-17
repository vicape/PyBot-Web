import { test } from "node:test";
import assert from "node:assert/strict";
import { MicroPythonReplProtocol } from "../src/micropython/replProtocol.js";
import { PROTOCOL_ERROR } from "../src/micropython/errors.js";
import { BYTE_CTRL_A, BYTE_CTRL_C, BYTE_CTRL_D } from "../src/micropython/constants.js";

const ENC = new TextEncoder();
const BANNER = "raw REPL; CTRL-B to exit\r\n>";

class ScriptedTransport {
  constructor() {
    this.writes = [];
    this._cbs = new Set();
    this.onWrite = null;
  }
  onData(cb) {
    this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }
  emit(u8) {
    const bytes = u8 instanceof Uint8Array ? u8 : ENC.encode(u8);
    this._cbs.forEach((cb) => cb(bytes));
  }
  async write(data) {
    const u8 = data instanceof Uint8Array ? data : ENC.encode(data);
    this.writes.push(u8);
    if (this.onWrite) await this.onWrite(u8, this);
  }
}

function lastByte(writes) {
  const w = writes[writes.length - 1];
  return w[w.length - 1];
}

test("enterRawRepl waits for the complete banner, not just 'raw REPL'", async () => {
  const tr = new ScriptedTransport();
  const p = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit("raw REPL");
  };
  await assert.rejects(
    () => p.enterRawRepl({ timeout: 40 }),
    (e) => e.code === PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT,
  );
});

test("A: classic program + Ctrl+D + OK + stdout + EOFs", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) {
      tr.emit(new Uint8Array([0x4f, 0x4b]));
      tr.emit("hola\n\x04\x04");
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  await proto.executeRawClassic("print('hola')\n");
  const { stdout, stderr } = await proto.followExecution({
    stdoutTimeout: 200,
    stderrTimeout: 200,
  });
  assert.equal(stdout, "hola\n");
  assert.equal(stderr, "");
});

test("B: OKHOLA in the same chunk keeps HOLA for follow", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) {
      tr.emit("OKHOLA\r\n\x04\x04>");
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  await proto.executeRawClassic("print('HOLA')\n");
  const { stdout } = await proto.followExecution({ stdoutTimeout: 200, stderrTimeout: 200 });
  assert.equal(stdout, "HOLA\r\n");
});

test("C: raw-paste supported has no OK", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  const wrote = [];
  tr.onWrite = async (u8) => {
    wrote.push(u8);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) {
      tr.emit(new Uint8Array([0x52, 0x01, 64, 0]));
    }
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D && wrote.length > 3) {
      tr.emit(new Uint8Array([0x04]));
      tr.emit("out\n\x04err\x04");
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  const pasted = await proto.executeRawPaste("print(1)\n");
  assert.equal(pasted.supported, true);
  const { stdout, stderr } = await proto.followExecution({
    stdoutTimeout: 200,
    stderrTimeout: 200,
  });
  assert.equal(stdout, "out\n");
  assert.equal(stderr, "err");
  const joined = wrote.map((w) => new TextDecoder().decode(w)).join("");
  assert.equal(joined.includes("OK"), false);
});

test("D: R\\x00 falls back to classic", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) tr.emit(new Uint8Array([0x52, 0x00]));
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) {
      tr.emit(new Uint8Array([0x4f, 0x4b, 0x7a, 0x04, 0x04]));
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  const pasted = await proto.executeRawPaste("x\n");
  assert.equal(pasted.supported, false);
  await proto.executeRawClassic("x\n");
  const { stdout } = await proto.followExecution({ stdoutTimeout: 200, stderrTimeout: 200 });
  assert.equal(stdout, "z");
});

test("E: paste header split across notifications", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) {
      tr.emit(new Uint8Array([0x52]));
      tr.emit(new Uint8Array([0x01]));
      tr.emit(new Uint8Array([8]));
      tr.emit(new Uint8Array([0]));
    }
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) tr.emit(new Uint8Array([0x04]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  const pasted = await proto.executeRawPaste("ab");
  assert.equal(pasted.supported, true);
});

test("F: OK split as O then K...", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) {
      tr.emit(new Uint8Array([0x4f]));
      tr.emit(new Uint8Array([0x4b, 0x78, 0x04, 0x04]));
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  await proto.executeRawClassic("x");
  const { stdout } = await proto.followExecution({ stdoutTimeout: 200, stderrTimeout: 200 });
  assert.equal(stdout, "x");
});

test("G/H: stdout and EOF split arbitrarily", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) {
      tr.emit(new Uint8Array([0x4f, 0x4b]));
      tr.emit(new Uint8Array([0x41]));
      tr.emit(new Uint8Array([0x42]));
      tr.emit(new Uint8Array([0x04]));
      tr.emit(new Uint8Array([0x43]));
      tr.emit(new Uint8Array([0x04]));
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  await proto.executeRawClassic("x");
  const { stdout, stderr } = await proto.followExecution({
    stdoutTimeout: 200,
    stderrTimeout: 200,
  });
  assert.equal(stdout, "AB");
  assert.equal(stderr, "C");
});

test("I: window grant \\x01 lets paste continue", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  const payload = new Uint8Array(6).fill(0x61);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) tr.emit(new Uint8Array([0x52, 0x01, 4, 0]));
    if (u8.length === 4 && u8[0] === 0x61) tr.emit(new Uint8Array([0x01]));
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) tr.emit(new Uint8Array([0x04]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  const pasted = await proto.executeRawPaste(payload);
  assert.equal(pasted.supported, true);
});

test("J: missing window grant is RAW_PASTE_WINDOW_TIMEOUT", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) tr.emit(new Uint8Array([0x52, 0x01, 2, 0]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  await assert.rejects(
    () => proto.executeRawPaste(new Uint8Array(8).fill(1), { windowTimeout: 40 }),
    (e) => e.code === PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT,
  );
});

test("K: raw-paste abort \\x04 is RAW_PASTE_ABORTED", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) {
      tr.emit(new Uint8Array([0x52, 0x01, 32, 0, 0x04]));
    }
  };
  await proto.enterRawRepl({ timeout: 200 });
  await assert.rejects(
    () => proto.executeRawPaste("hello"),
    (e) => e.code === PROTOCOL_ERROR.RAW_PASTE_ABORTED,
  );
});

test("L: missing paste ACK is RAW_PASTE_EOF_TIMEOUT", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) tr.emit(new Uint8Array([0x52, 0x01, 64, 0]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  await assert.rejects(
    () => proto.executeRawPaste("x", { eofTimeout: 40 }),
    (e) => e.code === PROTOCOL_ERROR.RAW_PASTE_EOF_TIMEOUT,
  );
});

test("bad paste header is RAW_PASTE_HEADER_BAD", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 3 && u8[0] === 0x05) tr.emit(new Uint8Array([0x58, 0x00]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  await assert.rejects(
    () => proto.executeRawPaste("x"),
    (e) => e.code === PROTOCOL_ERROR.RAW_PASTE_HEADER_BAD,
  );
});

test("classic ACK that is not OK is RAW_REPL_EXEC_ACK_BAD", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  tr.onWrite = async (u8) => {
    if (u8.length === 1 && u8[0] === BYTE_CTRL_A) tr.emit(BANNER);
    if (u8.length === 1 && u8[0] === BYTE_CTRL_D) tr.emit(new Uint8Array([0x4e, 0x4f]));
  };
  await proto.enterRawRepl({ timeout: 200 });
  await assert.rejects(
    () => proto.executeRawClassic("x"),
    (e) => e.code === PROTOCOL_ERROR.RAW_REPL_EXEC_ACK_BAD,
  );
});

test("interruptExecution sends a single Ctrl+C", async () => {
  const tr = new ScriptedTransport();
  const proto = new MicroPythonReplProtocol(tr);
  await proto.interruptExecution();
  assert.equal(tr.writes.length, 1);
  assert.deepEqual([...tr.writes[0]], [BYTE_CTRL_C]);
});
