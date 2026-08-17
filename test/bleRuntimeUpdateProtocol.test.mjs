import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE,
  UPDATE_ERRORS,
  MAX_RUNTIME_UPDATE_SIZE,
  UPDATE_SOURCE_CHUNK,
  PYBOT_RUNTIME_VERSION,
  PYBOT_PROTOCOL_VERSION,
  PYBOT_CAPABILITIES,
  buildUpdateBegin,
  buildUpdateChunk,
  chunkRuntimeUpdate,
  parseUpdateFrame,
  parseUpdateInfo,
  reassembleProgram,
  sha256HexUtf8,
  runtimeSupportsUpdate,
  compareRuntimeVersions,
  runtimeUpdateStatus,
  simulateDeviceResponse,
  parseInfoResponse,
} from "../src/bleProtocol.js";

// ---------------------------------------------------------------------------
// Versión / capability (fuente de verdad única)
// ---------------------------------------------------------------------------

test("runtime 4.0.2 / protocol 3.2 declare runtime-update capability", () => {
  assert.equal(PYBOT_RUNTIME_VERSION, "4.0.2");
  assert.equal(PYBOT_PROTOCOL_VERSION, "3.2");
  assert.ok(PYBOT_CAPABILITIES.includes("runtime-update"));
});

test("INFO simulation exposes runtime-update capability and the published version", () => {
  const info = parseInfoResponse(simulateDeviceResponse("INFO"));
  assert.ok(info);
  assert.equal(info.firmware, PYBOT_RUNTIME_VERSION);
  assert.equal(info.protocol, PYBOT_PROTOCOL_VERSION);
  assert.ok(info.capabilities.includes("runtime-update"));
});

// ---------------------------------------------------------------------------
// compareRuntimeVersions
// ---------------------------------------------------------------------------

test("compareRuntimeVersions orders semantic versions numerically", () => {
  assert.equal(compareRuntimeVersions("3.1.0", "3.1.0"), 0); // same
  assert.equal(compareRuntimeVersions("3.0.1", "3.1.0"), -1); // older
  assert.equal(compareRuntimeVersions("3.1.0", "3.0.1"), 1); // newer
  assert.equal(compareRuntimeVersions("3.2.0", "3.10.0"), -1); // numeric, not lexical
  assert.equal(compareRuntimeVersions("3.1", "3.1.0"), 0); // missing parts = 0
  assert.equal(compareRuntimeVersions("garbage", "x"), 0); // tolerant -> equal
});

// ---------------------------------------------------------------------------
// runtimeSupportsUpdate (capability-based, NOT version inference)
// ---------------------------------------------------------------------------

test("runtimeSupportsUpdate is strictly capability-based", () => {
  assert.equal(runtimeSupportsUpdate({ capabilities: ["run", "runtime-update"] }), true);
  // Un runtime 3.0.x (protocol 3.0) SIN la capability NO soporta OTA (necesita USB).
  assert.equal(runtimeSupportsUpdate({ protocol: "3.0", capabilities: ["run", "deploy"] }), false);
  assert.equal(runtimeSupportsUpdate({ firmware: "9.9.9" }), false); // no infiere por version
  assert.equal(runtimeSupportsUpdate(null), false);
  assert.equal(runtimeSupportsUpdate({}), false);
});

// ---------------------------------------------------------------------------
// runtimeUpdateStatus: same / older / newer / capability missing / present
// ---------------------------------------------------------------------------

test("runtimeUpdateStatus: same version -> no update", () => {
  const s = runtimeUpdateStatus(
    { firmware: "3.1.0", capabilities: ["runtime-update"] },
    "3.1.0",
  );
  assert.equal(s.updateAvailable, false);
  assert.equal(s.canUpdateOta, false);
  assert.equal(s.needsUsb, false);
  assert.equal(s.installed, "3.1.0");
  assert.equal(s.latest, "3.1.0");
});

test("runtimeUpdateStatus: 3.1.x -> 3.2+ modular layout requires USB (not pack OTA)", () => {
  const s = runtimeUpdateStatus(
    { firmware: "3.1.0", capabilities: ["runtime-update"] },
    "3.2.0",
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.supportsOta, true);
  assert.equal(s.canUpdateOta, false);
  assert.equal(s.needsUsb, true);
});

test("runtimeUpdateStatus: newer published version on 3.2+ board -> OTA available", () => {
  const s = runtimeUpdateStatus(
    { firmware: "3.2.0", capabilities: ["runtime-update"] },
    "3.2.7",
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.supportsOta, true);
  assert.equal(s.canUpdateOta, true);
  assert.equal(s.needsUsb, false);
});

test("runtimeUpdateStatus: newer version but NO capability -> needs USB (not OTA)", () => {
  // Placa 3.0.x actual: no declara runtime-update.
  const s = runtimeUpdateStatus(
    { firmware: "3.0.1", capabilities: ["run", "stop", "deploy", "app-control", "autostart"] },
    "3.1.0",
  );
  assert.equal(s.updateAvailable, true);
  assert.equal(s.supportsOta, false);
  assert.equal(s.canUpdateOta, false);
  assert.equal(s.needsUsb, true);
});

test("runtimeUpdateStatus: older installed than newer published is never offered as downgrade", () => {
  // Instalada MAS NUEVA que la publicada (no deberia pasar, pero es seguro): sin update.
  const s = runtimeUpdateStatus(
    { firmware: "3.5.0", capabilities: ["runtime-update"] },
    "3.1.0",
  );
  assert.equal(s.updateAvailable, false);
  assert.equal(s.canUpdateOta, false);
});

test("runtimeUpdateStatus: unknown installed version -> no update offered", () => {
  const s = runtimeUpdateStatus({ capabilities: ["runtime-update"] }, "3.1.0");
  assert.equal(s.installed, null);
  assert.equal(s.updateAvailable, false);
});

// ---------------------------------------------------------------------------
// UPDATE protocol tokens / errors / builders / parsers
// ---------------------------------------------------------------------------

test("UPDATE error codes are the documented set", () => {
  for (const code of [
    "BUSY",
    "UNSUPPORTED",
    "BAD_VERSION",
    "TOO_LONG",
    "BAD_ENCODING",
    "BAD_HASH",
    "HASH_UNAVAILABLE",
    "WRITE_FAILED",
    "VERIFY_FAILED",
    "NO_SPACE",
    "BAD_FRAME",
    "INCOMPATIBLE",
  ]) {
    assert.ok(UPDATE_ERRORS.includes(code), `falta ${code}`);
  }
});

test("buildUpdateBegin encodes version/size/hash (lowercase hash)", () => {
  const hash = sha256HexUtf8("print(1)\n");
  assert.equal(
    buildUpdateBegin("3.2.0", 1234, hash),
    `UPDATE:BEGIN:3.2.0:1234:${hash}`,
  );
  assert.equal(buildUpdateBegin("3.2.0", 9, "ABCD"), "UPDATE:BEGIN:3.2.0:9:abcd");
});

test("buildUpdateChunk / chunkRuntimeUpdate round-trip is lossless", () => {
  const runtime = "# runtime\n" + "x = 1\n".repeat(400);
  const chunks = chunkRuntimeUpdate(runtime);
  assert.ok(chunks.length > 1);
  assert.equal(reassembleProgram(chunks), runtime);
  assert.equal(buildUpdateChunk("QUJD"), "UPDATE:CHUNK:QUJD");
});

test("chunkRuntimeUpdate uses the large UPDATE chunk size", () => {
  const program = "a".repeat(UPDATE_SOURCE_CHUNK * 2 + 5);
  assert.equal(chunkRuntimeUpdate(program).length, 3);
});

test("parseUpdateFrame recognizes info/ready/ack/verify/applying/error", () => {
  assert.equal(parseUpdateFrame(UPDATE.READY).type, "ready");
  assert.equal(parseUpdateFrame(UPDATE.VERIFY_OK).type, "verify_ok");
  assert.equal(parseUpdateFrame(UPDATE.APPLYING).type, "applying");
  const ack = parseUpdateFrame("UPDATE:ACK:5");
  assert.equal(ack.type, "ack");
  assert.equal(ack.index, 5);
  const err = parseUpdateFrame("UPDATE:ERROR:BAD_HASH");
  assert.equal(err.type, "error");
  assert.equal(err.code, "BAD_HASH");
  const info = parseUpdateFrame(
    'UPDATE:INFO:{"runtime":"3.1.0","protocol":"3.1","max":65536,"hash":true,"state":"idle"}',
  );
  assert.equal(info.type, "info");
  assert.equal(info.info.runtime, "3.1.0");
  assert.equal(info.info.max, 65536);
  assert.equal(info.info.hash, true);
  // frames de otros protocolos no se confunden con UPDATE
  assert.equal(parseUpdateFrame("DEPLOY:READY").type, "unknown");
  assert.equal(parseUpdateFrame("PONG").type, "unknown");
});

test("parseUpdateInfo tolerates garbage", () => {
  assert.equal(parseUpdateInfo("UPDATE:INFO:{bad}"), null);
  assert.equal(parseUpdateInfo("PONG"), null);
});

test("MAX_RUNTIME_UPDATE_SIZE is generous but bounded", () => {
  assert.equal(MAX_RUNTIME_UPDATE_SIZE, 131072);
});
