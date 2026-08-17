import { test } from "node:test";
import assert from "node:assert/strict";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";
import { BYTE_CTRL_C } from "../src/micropython/constants.js";
import { FakeMicroPythonTransport } from "./helpers/fakeMicroPython.mjs";

function sessionOf(opts) {
  return new MicroPythonSession(new FakeMicroPythonTransport(opts), 115200);
}

function countCtrlC(writes) {
  let n = 0;
  for (const w of writes) {
    for (const b of w) if (b === BYTE_CTRL_C) n += 1;
  }
  return n;
}

test("detect() finds a MicroPython raw REPL banner", async () => {
  const s = sessionOf();
  assert.equal(await s.detect(), true);
  await s.close();
});

test("B: print HOLA in the same OK chunk", async () => {
  const s = sessionOf({ sameChunk: true });
  await s.detect();
  let out = "";
  await s.runProgram('print("HOLA")', {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  assert.match(out, /HOLA/);
  await s.close();
});

test("runProgram streams stdout after exact OK bytes", async () => {
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

test("M: while True pass → Stop → un Ctrl+C durante exec → interrupted", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  let out = "";
  const p = s.runProgram("while True:\n    pass\n", {
    prelude: "",
    onOut: (c) => {
      out += c;
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const before = board.ctrlCDuringExec;
  await s.interrupt();
  const result = await p;
  assert.equal(board.ctrlCDuringExec, before + 1);
  assert.equal(result.interrupted, true);
  assert.match(out, /Detenido/);
  await s.close();
});

test("N: CPU-bound loop Stop is interrupted, not an error", async () => {
  const s = sessionOf();
  await s.detect();
  let err = "";
  const p = s.runProgram("i = 0\nwhile True:\n    i += 1\n", {
    prelude: "",
    onErr: (c) => {
      err += c;
    },
    onOut: () => {},
  });
  await new Promise((r) => setTimeout(r, 20));
  await s.interrupt();
  const result = await p;
  assert.equal(result.interrupted, true);
  assert.equal(err.includes("Traceback"), false);
  await s.close();
});

test("O: print loop Stop without STOP:FORCE", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  const p = s.runProgram("i = 0\nwhile True:\n    print(i)\n    i += 1\n", {
    prelude: "",
    onOut: () => {},
  });
  await new Promise((r) => setTimeout(r, 20));
  await s.interrupt();
  await p;
  assert.equal(board.forceStopSeen, false);
  await s.close();
});

test("P: Run → Stop → Run", async () => {
  const s = sessionOf();
  await s.detect();
  const p1 = s.runProgram("while True:\n    pass\n", { prelude: "", onOut: () => {} });
  await new Promise((r) => setTimeout(r, 15));
  await s.interrupt();
  await p1;
  let out2 = "";
  await s.runProgram('print("second")\n', {
    prelude: "",
    onOut: (c) => {
      out2 += c;
    },
  });
  assert.match(out2, /second/);
  await s.close();
});

test("Q: 20 real while True pass Run/Stop cycles", { timeout: 30000 }, async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  for (let i = 0; i < 20; i++) {
    let out = "";
    const p = s.runProgram("while True:\n    pass\n", {
      prelude: "",
      onOut: (c) => {
        out += c;
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    await s.interrupt();
    const result = await p;
    assert.equal(result.interrupted, true, "cycle " + i);
    assert.match(out, /Detenido/, "cycle " + i);
  }
  await s.close();
});

test("fileExists uses raw REPL markers", async () => {
  const s = sessionOf();
  assert.equal(await s.fileExists("main.py"), true);
  await s.close();
});

test("wrap includes _pybot_cleanup in the program sent to the board", async () => {
  const board = new FakeMicroPythonTransport();
  const s = new MicroPythonSession(board, 115200);
  await s.detect();
  await s.runProgram('print("x")', { prelude: "", onOut: () => {} });
  const sent = board.writes.map((w) => new TextDecoder().decode(w)).join("");
  assert.match(sent, /_pybot_cleanup/);
  await s.close();
});
