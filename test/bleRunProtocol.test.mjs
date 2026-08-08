import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUN,
  RUN_MODES,
  RUN_PROFILES,
  MAX_PROGRAM_LENGTH,
  RUN_SOURCE_CHUNK,
  bytesToBase64,
  base64ToBytes,
  utf8ToBase64,
  base64ToUtf8,
  buildRunBegin,
  buildRunChunk,
  parseRunBegin,
  chunkProgram,
  reassembleProgram,
  parseRunFrame,
  runtimeSupportsRun,
} from "../src/bleProtocol.js";

test("base64 round-trip for arbitrary bytes", () => {
  const cases = [
    [],
    [0],
    [255],
    [0, 1, 2, 3, 4, 5],
    [72, 101, 108, 108, 111], // "Hello"
  ];
  for (const arr of cases) {
    const bytes = Uint8Array.from(arr);
    const b64 = bytesToBase64(bytes);
    assert.deepEqual(Array.from(base64ToBytes(b64)), arr);
  }
});

test("base64 matches known vectors (compat con ubinascii)", () => {
  assert.equal(utf8ToBase64("Hello"), "SGVsbG8=");
  assert.equal(utf8ToBase64("PyBot"), "UHlCb3Q=");
  assert.equal(base64ToUtf8("SGVsbG8="), "Hello");
});

test("utf8 base64 round-trip preserves multi-byte and newlines", () => {
  const text = "acentos: áéí\nñ ç\ttab\nprint('hola')\n";
  assert.equal(base64ToUtf8(utf8ToBase64(text)), text);
});

test("buildRunBegin encodes mode and profile", () => {
  assert.equal(buildRunBegin("mpy", "WEMOS"), "RUN:BEGIN:mpy:WEMOS");
  assert.equal(buildRunBegin("eda6", "ESP32"), "RUN:BEGIN:eda6:ESP32");
});

test("buildRunBegin normalizes unknown mode/profile to safe defaults", () => {
  assert.equal(buildRunBegin("weird", "weird"), "RUN:BEGIN:mpy:WEMOS");
  assert.equal(buildRunBegin(RUN_MODES.EDA6, RUN_PROFILES.ESP32), "RUN:BEGIN:eda6:ESP32");
});

test("parseRunBegin is the inverse for the firmware mirror", () => {
  assert.deepEqual(parseRunBegin("RUN:BEGIN:eda6:ESP32"), {
    mode: "eda6",
    profile: "ESP32",
  });
  assert.deepEqual(parseRunBegin("RUN:BEGIN:mpy:WEMOS"), {
    mode: "mpy",
    profile: "WEMOS",
  });
  assert.equal(parseRunBegin("PING"), null);
});

test("chunkProgram + reassembleProgram is lossless", () => {
  const program = "for i in range(5):\n    print('línea', i)\n" + "x = 1\n".repeat(50);
  const chunks = chunkProgram(program);
  assert.ok(chunks.length > 1, "programa largo debe partirse en varios chunks");
  assert.equal(reassembleProgram(chunks), program);
});

test("chunkProgram respects the source chunk size (bytes before base64)", () => {
  const program = "a".repeat(RUN_SOURCE_CHUNK * 3 + 10);
  const chunks = chunkProgram(program);
  // 3 chunks completos + 1 parcial
  assert.equal(chunks.length, 4);
  assert.equal(reassembleProgram(chunks), program);
});

test("buildRunChunk prefixes the base64 payload", () => {
  const b64 = utf8ToBase64("print('x')");
  assert.equal(buildRunChunk(b64), "RUN:CHUNK:" + b64);
});

test("parseRunFrame recognizes control frames", () => {
  assert.equal(parseRunFrame(RUN.READY).type, "ready");
  assert.equal(parseRunFrame(RUN.STARTED).type, "started");
  assert.equal(parseRunFrame(RUN.DONE).type, "done");
});

test("parseRunFrame decodes OUT and ERR base64 payloads", () => {
  const out = parseRunFrame(RUN.OUT + ":" + utf8ToBase64("hola\n"));
  assert.equal(out.type, "out");
  assert.equal(out.text, "hola\n");

  const err = parseRunFrame(RUN.ERR + ":" + utf8ToBase64("Traceback: boom"));
  assert.equal(err.type, "err");
  assert.equal(err.text, "Traceback: boom");
});

test("parseRunFrame surfaces protocol errors and ignores unrelated frames", () => {
  const e = parseRunFrame("RUN:ERROR:TOO_LONG");
  assert.equal(e.type, "error");
  assert.equal(e.code, "TOO_LONG");

  assert.equal(parseRunFrame("PONG").type, "unknown");
});

test("MAX_PROGRAM_LENGTH is a sane, documented limit", () => {
  assert.equal(typeof MAX_PROGRAM_LENGTH, "number");
  assert.ok(MAX_PROGRAM_LENGTH >= 2048);
});

test("runtimeSupportsRun detects the old MVP runtime (protocol/firmware 1.x)", () => {
  // Runtime viejo (commit MVP): reportaba protocol 1.0 / firmware 1.0.0 y NO
  // entiende RUN:* -> debe considerarse SIN soporte de ejecucion.
  assert.equal(
    runtimeSupportsRun({ protocol: "1.0", firmware: "1.0.0", runtime: "PyBot BLE Runtime" }),
    false,
  );
  // Solo firmware viejo, sin campo protocol (INFO minimal del MVP).
  assert.equal(runtimeSupportsRun({ firmware: "1.0.0" }), false);
});

test("runtimeSupportsRun accepts the new RUN 2.0 runtime", () => {
  assert.equal(runtimeSupportsRun({ protocol: "2.0", firmware: "2.0.0" }), true);
  assert.equal(runtimeSupportsRun({ firmware: "2.1.3" }), true);
  // El protocolo manda sobre el firmware si esta presente.
  assert.equal(runtimeSupportsRun({ protocol: "2.0", firmware: "1.9.9" }), true);
});

test("runtimeSupportsRun is permissive with missing/unknown info (fallback a timeout de RUN)", () => {
  assert.equal(runtimeSupportsRun(null), true);
  assert.equal(runtimeSupportsRun({}), true);
  assert.equal(runtimeSupportsRun({ firmware: "dev" }), true);
});
