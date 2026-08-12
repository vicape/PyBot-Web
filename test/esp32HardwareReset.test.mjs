/**
 * Tests del reset USB ESP32 (DTR/RTS) en MicroPythonSession.
 * DevKit típica: RTS→EN (reset), DTR→GPIO0 (BOOT).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MicroPythonSession } from "../src/micropythonEsp32Session.js";

function makeSession(port) {
  const writer = {
    write: async () => {},
    releaseLock() {},
  };
  const reader = {
    read: async () => ({ done: true, value: undefined }),
    cancel: async () => {},
    releaseLock() {},
  };
  return new MicroPythonSession(port, writer, reader, 115200);
}

test("hardwareReset pulsa RTS (EN) con DTR inactivo y libera ambas señales", async () => {
  const calls = [];
  const port = {
    async setSignals(signals) {
      calls.push({ ...signals });
    },
  };
  const session = makeSession(port);
  const ok = await session.hardwareReset();
  assert.equal(ok, true);
  assert.ok(calls.length >= 2, "debe haber al menos assert + release de RTS");

  const assertReset = calls[0];
  assert.equal(assertReset.dataTerminalReady, false, "DTR inactivo (GPIO0 alto)");
  assert.equal(assertReset.requestToSend, true, "RTS activo (EN bajo)");

  const release = calls[1];
  assert.equal(release.dataTerminalReady, false);
  assert.equal(release.requestToSend, false, "RTS liberado (EN alto → boot run)");

  const last = calls[calls.length - 1];
  assert.equal(last.dataTerminalReady, false);
  assert.equal(last.requestToSend, false);

  for (const c of calls) {
    assert.notEqual(
      c.dataTerminalReady,
      true,
      "nunca afirmar DTR: evita entrar en download/bootloader",
    );
  }
});

test("hardwareReset no entra en secuencia de bootloader (DTR alto + RTS)", async () => {
  const calls = [];
  const port = {
    async setSignals(signals) {
      calls.push({ ...signals });
    },
  };
  const session = makeSession(port);
  await session.hardwareReset();

  // Bootloader clásico: EN bajo, luego GPIO0 bajo al liberar EN.
  // Nuestra secuencia nunca pone DTR=true en ningún paso.
  assert.ok(calls.every((c) => c.dataTerminalReady === false));
  assert.ok(
    !calls.some(
      (c, i) =>
        c.dataTerminalReady === true &&
        i > 0 &&
        calls[i - 1].requestToSend === true &&
        c.requestToSend === false,
    ),
    "no debe liberar EN con GPIO0/DTR afirmado",
  );
});

test("hardwareReset hace fallback (false) si setSignals no existe", async () => {
  const session = makeSession({});
  assert.equal(await session.hardwareReset(), false);
});

test("hardwareReset hace fallback (false) si setSignals falla y libera señales", async () => {
  const calls = [];
  let n = 0;
  const port = {
    async setSignals(signals) {
      calls.push({ ...signals });
      n += 1;
      if (n === 1) throw new Error("setSignals failed");
    },
  };
  const session = makeSession(port);
  assert.equal(await session.hardwareReset(), false);
  assert.ok(calls.length >= 2, "debe intentar liberar tras el error");
  const last = calls[calls.length - 1];
  assert.equal(last.dataTerminalReady, false);
  assert.equal(last.requestToSend, false);
});

test("softReset usa machine.reset cuando hardwareReset no está disponible", async () => {
  const writes = [];
  const session = makeSession({});
  session.syncFilesystem = async () => {};
  session._enterRawRepl = async () => {};
  session._write = async (s) => {
    writes.push(s);
  };

  await session.softReset();
  assert.ok(
    writes.some((w) => String(w).includes("machine.reset()")),
    "debe enviar machine.reset() como fallback",
  );
  assert.equal(session._running, false);
});

test("softReset no declara éxito si ningún mecanismo de reset se ejecutó", async () => {
  const session = makeSession({});
  session.syncFilesystem = async () => {};
  session._enterRawRepl = async () => {
    throw new Error("REPL_FAIL");
  };

  await assert.rejects(() => session.softReset(), /RESET_FAIL/);
  assert.equal(session._running, false);
});

test("softReset no llama machine.reset si hardwareReset tuvo éxito", async () => {
  const writes = [];
  const port = {
    async setSignals() {},
  };
  const session = makeSession(port);
  session.syncFilesystem = async () => {};
  session._enterRawRepl = async () => {
    throw new Error("should not enter raw REPL");
  };
  session._write = async (s) => {
    writes.push(s);
  };

  await session.softReset();
  assert.equal(writes.length, 0);
  assert.equal(session._running, false);
});
