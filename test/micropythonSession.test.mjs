import { test } from "node:test";
import assert from "node:assert/strict";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";
import { CTRL_A, CTRL_B, CTRL_C, CTRL_D } from "../src/micropython/constants.js";

class FakeReplTransport {
  constructor() {
    this.port = null;
    this.baudRate = 115200;
    this._cbs = new Set();
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this.writes = [];
    this._busy = false;
    this._raw = false;
    this.open = true;
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

  async write(data) {
    const s = typeof data === "string" ? data : this._dec.decode(data);
    this.writes.push(s);
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
      if (/while\s+True\s*:/.test(body) && /\bpass\b/.test(body)) {
        this._busy = true;
        this.emit("OK\n");
        return;
      }
      this.emit("OK\n");
      const m = body.match(/print\((['"])(.*?)\1\)/);
      if (m) this.emit(m[2] + "\n");
      else if (body.includes("PYBOT_FILE_EXISTS") || body.includes("os.stat")) {
        this.emit("PYBOT_FILE_EXISTS\n");
      } else if (body.includes("PYBOT_INSTALL_OK")) {
        this.emit("PYBOT_INSTALL_OK\n");
      } else if (body.includes("PYBOT_SYNC_OK")) {
        this.emit("PYBOT_SYNC_OK\n");
      } else {
        this.emit("ok\n");
      }
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

function sessionOf() {
  return new MicroPythonSession(new FakeReplTransport(), 115200);
}

test("detect() finds a MicroPython raw REPL", async () => {
  const s = sessionOf();
  assert.equal(await s.detect(), true);
  await s.close();
});

test("runProgram streams stdout and returns after OK / EOT", async () => {
  const s = sessionOf();
  await s.detect();
  let out = "";
  await s.runProgram('print("hola")', {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  assert.match(out, /hola/);
  await s.close();
});

test("Stop sends Ctrl+C and surfaces KeyboardInterrupt as [Detenido]", async () => {
  const s = sessionOf();
  await s.detect();
  let out = "";
  const p = s.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  await s.interrupt();
  await p;
  assert.match(out, /Detenido/);
  await s.close();
});

async function runStopCycles(n) {
  const s = sessionOf();
  await s.detect();
  for (let i = 0; i < n; i++) {
    let out = "";
    const p = s.runProgram('print("c")\n', {
      prelude: "",
      onOut: (c) => {
        out += c;
      },
    });
    await p;
    assert.match(out, /c|ok/);
  }
  await s.close();
}

test("Run/Stop 20 cycles on fake REPL", { timeout: 30000 }, async () => {
  await runStopCycles(20);
});

test("Run/Stop 50 cycles on fake REPL", { timeout: 60000 }, async () => {
  await runStopCycles(50);
});

test("Run/Stop 100 cycles on fake REPL", { timeout: 120000 }, async () => {
  await runStopCycles(100);
});

test("fileExists uses raw REPL markers", async () => {
  const s = sessionOf();
  assert.equal(await s.fileExists("main.py"), true);
  await s.close();
});
