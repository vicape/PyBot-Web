import { test } from "node:test";
import assert from "node:assert/strict";
import { ByteQueue, indexOfBytes } from "../src/micropython/byteQueue.js";
import { PROTOCOL_ERROR } from "../src/micropython/errors.js";

test("ByteQueue readExact and leftover bytes stay for the next read", async () => {
  const q = new ByteQueue();
  q.push(new Uint8Array([0x4f, 0x4b, 0x48, 0x4f]));
  const ok = await q.readExact(2, 50, PROTOCOL_ERROR.RAW_REPL_EXEC_ACK_BAD);
  assert.deepEqual([...ok], [0x4f, 0x4b]);
  assert.deepEqual([...q.peek(2)], [0x48, 0x4f]);
});

test("ByteQueue readUntil consumes delimiter and keeps the rest", async () => {
  const q = new ByteQueue();
  q.push(new Uint8Array([0x48, 0x04, 0x4b, 0x04]));
  const a = await q.readUntil(0x04, 50, PROTOCOL_ERROR.RAW_REPL_STDOUT_TIMEOUT);
  assert.deepEqual([...a], [0x48]);
  const b = await q.readUntil(0x04, 50, PROTOCOL_ERROR.RAW_REPL_STDERR_TIMEOUT);
  assert.deepEqual([...b], [0x4b]);
});

test("ByteQueue waitForByte times out with structured code", async () => {
  const q = new ByteQueue();
  await assert.rejects(
    () => q.waitForByte(20, PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT),
    (e) => e.code === PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT,
  );
});

test("indexOfBytes finds a multi-byte banner", () => {
  const banner = new TextEncoder().encode("raw REPL; CTRL-B to exit\r\n>");
  const buf = new TextEncoder().encode("xxraw REPL; CTRL-B to exit\r\n>yy");
  assert.equal(indexOfBytes(buf, banner), 2);
});
