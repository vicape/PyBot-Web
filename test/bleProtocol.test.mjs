import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SERVICE_UUID,
  RX_UUID,
  TX_UUID,
  COMMANDS,
  MAX_COMMAND_LENGTH,
  deviceIdFromMac,
  bleNameFromDeviceId,
  bleNameFromMac,
  buildLedCommand,
  classifyResponse,
  parseInfoResponse,
  simulateDeviceResponse,
  splitMessages,
  PYBOT_RUNTIME_VERSION,
  PYBOT_PROTOCOL_VERSION,
} from "../src/bleProtocol.js";

test("UUIDs are the agreed PyBot service UUIDs", () => {
  assert.equal(SERVICE_UUID, "8fbc0001-4d5a-4b8c-9a1f-123456789001");
  assert.equal(RX_UUID, "8fbc0002-4d5a-4b8c-9a1f-123456789002");
  assert.equal(TX_UUID, "8fbc0003-4d5a-4b8c-9a1f-123456789003");
});

test("deviceIdFromMac returns last 6 hex uppercase", () => {
  assert.equal(deviceIdFromMac("24:6f:28:a3:4f:21"), "A34F21");
  assert.equal(deviceIdFromMac("246f28a34f21"), "A34F21");
  assert.equal(deviceIdFromMac("aa bb cc a3 4f 21"), "A34F21");
});

test("deviceIdFromMac is stable for the same input", () => {
  const a = deviceIdFromMac("246f28a34f21");
  const b = deviceIdFromMac("24-6F-28-A3-4F-21");
  assert.equal(a, b);
});

test("deviceIdFromMac pads short/empty input", () => {
  assert.equal(deviceIdFromMac(""), "000000");
  assert.equal(deviceIdFromMac("ab"), "0000AB");
});

test("bleNameFromDeviceId / bleNameFromMac build PYBOT-XXXXXX", () => {
  assert.equal(bleNameFromDeviceId("a34f21"), "PYBOT-A34F21");
  assert.equal(bleNameFromMac("24:6f:28:a3:4f:21"), "PYBOT-A34F21");
});

test("buildLedCommand maps boolean to protocol strings", () => {
  assert.equal(buildLedCommand(true), "LED,1");
  assert.equal(buildLedCommand(false), "LED,0");
  assert.equal(buildLedCommand(true), COMMANDS.LED_ON);
});

test("classifyResponse recognizes each response kind", () => {
  assert.equal(classifyResponse("PONG"), "PONG");
  assert.equal(classifyResponse("OK"), "OK");
  assert.equal(classifyResponse("ERR,UNKNOWN_COMMAND"), "ERROR");
  assert.equal(classifyResponse('{"device":"PYBOT-A34F21"}'), "INFO");
  assert.equal(classifyResponse("weird"), "UNKNOWN");
});

test("parseInfoResponse parses valid JSON and rejects garbage", () => {
  const parsed = parseInfoResponse(
    '{"device":"PYBOT-A34F21","id":"A34F21","firmware":"1.0.0","protocol":"1.0","runtime":"PyBot BLE Runtime","board":"ESP32"}',
  );
  assert.ok(parsed);
  assert.equal(parsed.device, "PYBOT-A34F21");
  assert.equal(parsed.id, "A34F21");
  assert.equal(parseInfoResponse("PONG"), null);
  assert.equal(parseInfoResponse("{not json}"), null);
});

test("simulateDeviceResponse: PING -> PONG", () => {
  assert.equal(simulateDeviceResponse("PING"), "PONG");
  assert.equal(simulateDeviceResponse("ping"), "PONG");
});

test("simulateDeviceResponse: INFO -> parseable JSON with correct versions", () => {
  const resp = simulateDeviceResponse("INFO", {
    deviceName: "PYBOT-A34F21",
    deviceId: "A34F21",
  });
  const obj = parseInfoResponse(resp);
  assert.ok(obj);
  assert.equal(obj.device, "PYBOT-A34F21");
  assert.equal(obj.id, "A34F21");
  assert.equal(obj.firmware, PYBOT_RUNTIME_VERSION);
  assert.equal(obj.protocol, PYBOT_PROTOCOL_VERSION);
  assert.equal(obj.runtime, "PyBot BLE Runtime");
  assert.equal(obj.board, "ESP32");
});

test("simulateDeviceResponse: LED,1 / LED,0 -> OK", () => {
  assert.equal(simulateDeviceResponse("LED,1"), "OK");
  assert.equal(simulateDeviceResponse("LED,0"), "OK");
  assert.equal(simulateDeviceResponse("LED,1", { hasLed: false }), "ERR,NO_LED");
});

test("simulateDeviceResponse: unknown -> ERR,UNKNOWN_COMMAND", () => {
  assert.equal(simulateDeviceResponse("FOO"), "ERR,UNKNOWN_COMMAND");
  assert.equal(simulateDeviceResponse("LED,2"), "ERR,UNKNOWN_COMMAND");
});

test("simulateDeviceResponse: empty is ignored, too long is rejected", () => {
  assert.equal(simulateDeviceResponse(""), null);
  assert.equal(simulateDeviceResponse("   "), null);
  assert.equal(simulateDeviceResponse(null), null);
  const tooLong = "A".repeat(MAX_COMMAND_LENGTH + 1);
  assert.equal(simulateDeviceResponse(tooLong), "ERR,TOO_LONG");
});

test("splitMessages accumulates and keeps the incomplete tail", () => {
  const first = splitMessages("PONG\nOK\nPAR");
  assert.deepEqual(first.messages, ["PONG", "OK"]);
  assert.equal(first.rest, "PAR");

  const second = splitMessages(first.rest + "TIAL\n");
  assert.deepEqual(second.messages, ["PARTIAL"]);
  assert.equal(second.rest, "");
});
