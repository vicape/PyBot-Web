/**
 * Punto 13: port.open() ya no convierte todo error en BUSY.
 * BUSY solo si Web Serial reporta InvalidStateError (puerto ya abierto).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connectMicroPythonEsp32Session } from "../src/micropython/micropythonSession.js";
import { RAW_REPL_BANNER_TEXT } from "../src/micropython/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sessionSrc = readFileSync(join(root, "src/micropython/micropythonSession.js"), "utf8");
const ENC = new TextEncoder();

function domError(name, message, code) {
  const err = new Error(message);
  err.name = name;
  if (code != null) err.code = code;
  return err;
}

/**
 * @param {{
 *   openImpl?: (opts: object) => Promise<void>|void,
 *   detectOk?: boolean,
 * }} [opts]
 */
function makePort(opts = {}) {
  const detectOk = opts.detectOk !== false;
  let controller = null;
  const readable = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  const writable = new WritableStream({
    write(chunk) {
      if (!detectOk) throw new Error("detect_fail");
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      // Ctrl+A → banner raw REPL
      if (u8.includes(0x01) && controller) {
        queueMicrotask(() => controller.enqueue(ENC.encode(RAW_REPL_BANNER_TEXT)));
      }
    },
  });
  const port = {
    readable: null,
    writable: null,
    openCalls: [],
    async open(openOpts) {
      port.openCalls.push(openOpts);
      if (typeof opts.openImpl === "function") {
        await opts.openImpl(openOpts);
      }
      port.readable = readable;
      port.writable = writable;
    },
    async close() {
      port.readable = null;
      port.writable = null;
    },
  };
  return port;
}

test("TEST1: open correcto continúa (detect OK)", async () => {
  const port = makePort({ detectOk: true });
  const result = await connectMicroPythonEsp32Session(port);
  assert.ok(result.session);
  assert.equal(result.baudRate, 115200);
  await result.session.close();
});

test("TEST2: InvalidStateError → BUSY con cause", async () => {
  const original = domError("InvalidStateError", "The port is already open.");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err.message, "BUSY");
      assert.equal(err.code, "BUSY");
      assert.equal(err.cause, original);
      return true;
    },
  );
});

test("TEST3: error genérico no es BUSY (misma instancia)", async () => {
  const original = new Error("driver failed");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err, original);
      assert.notEqual(err.message, "BUSY");
      return true;
    },
  );
});

test("TEST4: SecurityError no es BUSY", async () => {
  const original = domError("SecurityError", "Permission denied");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err, original);
      assert.equal(err.name, "SecurityError");
      return true;
    },
  );
});

test("TEST5: NotFoundError no es BUSY", async () => {
  const original = domError("NotFoundError", "No port");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err, original);
      assert.equal(err.name, "NotFoundError");
      return true;
    },
  );
});

test("TEST6: NetworkError genérico no es BUSY", async () => {
  const original = domError("NetworkError", "Failed to open serial port.");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err, original);
      assert.equal(err.name, "NetworkError");
      assert.notEqual(err.message, "BUSY");
      return true;
    },
  );
});

test("TEST7: InvalidStateError es el único BUSY inequívoco de open()", async () => {
  // Spec Web Serial open(): InvalidStateError <=> state !== closed (ya abierto).
  const original = domError("InvalidStateError", "Failed to execute 'open' on 'SerialPort': The port is already open.");
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => err.message === "BUSY" && err.cause === original,
  );
});

test("TEST8: code original se conserva si no es BUSY", async () => {
  const original = new Error("os fail");
  original.code = "SOME_CODE";
  const port = makePort({
    openImpl: async () => {
      throw original;
    },
  });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err, original);
      assert.equal(err.code, "SOME_CODE");
      return true;
    },
  );
});

test("TEST9: hardwareBridge sigue reconociendo BUSY sin cambios", () => {
  const bridge = readFileSync(join(root, "src/hardwareBridge.js"), "utf8");
  assert.match(bridge, /msg === "BUSY"/);
  assert.match(bridge, /PROVISION_ERROR\.BUSY/);
});

test("TEST10: open OK + detect fail → NEEDS_PREP", async () => {
  const port = makePort({ detectOk: false });
  await assert.rejects(
    () => connectMicroPythonEsp32Session(port),
    (err) => {
      assert.equal(err.message, "NEEDS_PREP");
      return true;
    },
  );
});

test("TEST11: port.open recibe exactamente { baudRate }", async () => {
  const port = makePort({ detectOk: true });
  const result = await connectMicroPythonEsp32Session(port, { baudRate: 115200 });
  assert.deepEqual(port.openCalls, [{ baudRate: 115200 }]);
  await result.session.close();
});

test("TEST12: no retry / no segunda llamada a open", async () => {
  const port = makePort({
    openImpl: async () => {
      throw new Error("once");
    },
  });
  await assert.rejects(() => connectMicroPythonEsp32Session(port));
  assert.equal(port.openCalls.length, 1);
  assert.doesNotMatch(sessionSrc, /await port\.open[\s\S]*await port\.open/);
  assert.match(sessionSrc, /e\?\.name === "InvalidStateError"/);
  assert.doesNotMatch(sessionSrc, /catch\s*\{\s*throw new Error\("BUSY"\)/);
});
