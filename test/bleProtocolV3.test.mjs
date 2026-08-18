import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUN,
  DEPLOY,
  DEPLOY_ERRORS,
  APP_ERRORS,
  APP,
  PYBOT_CAPABILITIES,
  PYBOT_RUNTIME_VERSION,
  PYBOT_PROTOCOL_VERSION,
  MAX_RUN_PROGRAM_SIZE,
  MAX_DEPLOY_PROGRAM_SIZE,
  MAX_PROGRAM_LENGTH,
  DEPLOY_SOURCE_CHUNK,
  sha256Hex,
  sha256HexUtf8,
  buildDeployBegin,
  buildDeployChunk,
  chunkDeployProgram,
  parseDeployFrame,
  parseRunFrame,
  parseAppFrame,
  parseAppInfo,
  buildAppAutostart,
  parseCapabilities,
  runtimeSupportsDeploy,
  runtimeSupportsRun,
  reassembleProgram,
  simulateDeviceResponse,
  parseInfoResponse,
} from "../src/bleProtocol.js";

test("version and protocol bumped to 4.0 / 3.2 (native REPL + OTA)", () => {
  assert.equal(PYBOT_RUNTIME_VERSION, "4.0.4");
  assert.equal(PYBOT_PROTOCOL_VERSION, "3.2");
});

test("capabilities include run/stop/deploy/app-control/autostart/runtime-update/native-repl", () => {
  assert.deepEqual([...PYBOT_CAPABILITIES], [
    "run",
    "stop",
    "deploy",
    "app-control",
    "autostart",
    "runtime-update",
    "native-repl",
  ]);
});

test("INFO simulation exposes capabilities", () => {
  const info = parseInfoResponse(simulateDeviceResponse("INFO"));
  assert.ok(info);
  assert.deepEqual(info.capabilities, [...PYBOT_CAPABILITIES]);
});

test("size limits: RUN < DEPLOY, alias preserved", () => {
  assert.equal(MAX_RUN_PROGRAM_SIZE, 8192);
  assert.equal(MAX_DEPLOY_PROGRAM_SIZE, 16384);
  assert.equal(MAX_PROGRAM_LENGTH, MAX_RUN_PROGRAM_SIZE);
  assert.ok(MAX_DEPLOY_PROGRAM_SIZE > MAX_RUN_PROGRAM_SIZE);
});

test("sha256Hex matches known NIST vectors", () => {
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256HexUtf8("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256HexUtf8(
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    ),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("sha256 is stable across large inputs and multi-byte utf8", () => {
  const big = "línea áéíóú ñ\n".repeat(1000);
  const a = sha256HexUtf8(big);
  const b = sha256HexUtf8(big);
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("RUN.STOPPED is a distinct terminal frame from RUN.DONE", () => {
  assert.equal(RUN.STOPPED, "RUN:STOPPED");
  assert.notEqual(RUN.STOPPED, RUN.DONE);
  assert.equal(parseRunFrame("RUN:STOPPED").type, "stopped");
  assert.equal(parseRunFrame("RUN:DONE").type, "done");
  assert.equal(RUN.STOP_FORCE, "STOP:FORCE");
});

test("buildDeployBegin encodes mode/profile/size/hash (lowercase hash)", () => {
  const hash = sha256HexUtf8("print(1)\n");
  assert.equal(
    buildDeployBegin("eda6", "ESP32", 9, hash),
    `DEPLOY:BEGIN:eda6:ESP32:9:${hash}`,
  );
  // normaliza mode/profile desconocidos a defaults seguros
  assert.equal(
    buildDeployBegin("weird", "weird", 3, "ABC"),
    "DEPLOY:BEGIN:mpy:WEMOS:3:abc",
  );
});

test("buildDeployChunk / chunkDeployProgram round-trip is lossless", () => {
  const program = "salidaDigital(1, 1)\nwait(0.5)\n".repeat(40);
  const chunks = chunkDeployProgram(program);
  assert.ok(chunks.length > 1);
  assert.equal(reassembleProgram(chunks), program);
  assert.equal(buildDeployChunk("QUJD"), "DEPLOY:CHUNK:QUJD");
});

test("chunkDeployProgram uses the larger DEPLOY chunk size", () => {
  const program = "a".repeat(DEPLOY_SOURCE_CHUNK * 2 + 5);
  const chunks = chunkDeployProgram(program);
  assert.equal(chunks.length, 3);
});

test("parseDeployFrame recognizes ready/ack/verify/error", () => {
  assert.equal(parseDeployFrame(DEPLOY.READY).type, "ready");
  assert.equal(parseDeployFrame(DEPLOY.VERIFY_OK).type, "verify_ok");
  const ack = parseDeployFrame("DEPLOY:ACK:7");
  assert.equal(ack.type, "ack");
  assert.equal(ack.index, 7);
  const err = parseDeployFrame("DEPLOY:ERROR:BAD_HASH");
  assert.equal(err.type, "error");
  assert.equal(err.code, "BAD_HASH");
  assert.equal(parseDeployFrame("PONG").type, "unknown");
});

test("DEPLOY error codes are the documented set", () => {
  for (const code of [
    "BUSY",
    "TOO_LONG",
    "BAD_ENCODING",
    "BAD_HASH",
    "HASH_UNAVAILABLE",
    "WRITE_FAILED",
    "VERIFY_FAILED",
    "INVALID_MODE",
    "INVALID_PROFILE",
    "NO_SPACE",
    "BAD_FRAME",
  ]) {
    assert.ok(DEPLOY_ERRORS.includes(code), `falta ${code}`);
  }
});

test("APP error codes are the documented set", () => {
  for (const code of [
    "NO_APP",
    "BUSY",
    "READ_FAILED",
    "WRITE_FAILED",
    "DELETE_FAILED",
    "BAD_FRAME",
  ]) {
    assert.ok(APP_ERRORS.includes(code), `falta ${code}`);
  }
});

test("APP frames: info/ok/error and JSON parsing", () => {
  const info = parseAppFrame(
    'APP:INFO:{"installed":true,"running":false,"autostart":true,"mode":"eda6","profile":"WEMOS","size":42,"hash":"ab","safe":false,"fail":0,"error":""}',
  );
  assert.equal(info.type, "info");
  assert.equal(info.info.installed, true);
  assert.equal(info.info.mode, "eda6");
  assert.equal(info.info.size, 42);

  const ok = parseAppFrame("APP:OK:START");
  assert.equal(ok.type, "ok");
  assert.equal(ok.action, "START");

  const err = parseAppFrame("APP:ERROR:NO_APP");
  assert.equal(err.type, "error");
  assert.equal(err.code, "NO_APP");

  assert.equal(parseAppInfo("APP:INFO:{bad}"), null);
  assert.equal(parseAppInfo("PONG"), null);
});

test("buildAppAutostart builds APP:AUTOSTART:1/0", () => {
  assert.equal(buildAppAutostart(true), "APP:AUTOSTART:1");
  assert.equal(buildAppAutostart(false), "APP:AUTOSTART:0");
});

test("parseCapabilities normalizes and tolerates garbage", () => {
  assert.deepEqual(parseCapabilities({ capabilities: ["Run", " DEPLOY "] }), [
    "run",
    "deploy",
  ]);
  assert.deepEqual(parseCapabilities({}), []);
  assert.deepEqual(parseCapabilities(null), []);
});

test("runtimeSupportsDeploy prefers capabilities, falls back to version", () => {
  assert.equal(runtimeSupportsDeploy({ capabilities: ["run", "deploy"] }), true);
  assert.equal(runtimeSupportsDeploy({ protocol: "3.0" }), true);
  assert.equal(runtimeSupportsDeploy({ firmware: "3.1.0" }), true);
  // Runtime 2.x: permite RUN pero NO deploy.
  assert.equal(runtimeSupportsDeploy({ protocol: "2.0", firmware: "2.0.0" }), false);
  assert.equal(runtimeSupportsRun({ protocol: "2.0" }), true);
  // Sin datos: conservador (no deploy), pero RUN permisivo.
  assert.equal(runtimeSupportsDeploy(null), false);
  assert.equal(runtimeSupportsDeploy({}), false);
});
