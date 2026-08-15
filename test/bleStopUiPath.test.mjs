import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PYBOT_RUNTIME_VERSION,
  PYBOT_STOP_RELIABLE_MIN,
  runtimeStopReliable,
  compareRuntimeVersions,
} from "../src/bleProtocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDE = path.join(__dirname, "..", "src", "PyBotIDE.jsx");
const BRIDGE = path.join(__dirname, "..", "src", "hardwareBridge.js");

test("runtime 4.0.0 / stop-reliable min is 3.2.4", () => {
  assert.equal(PYBOT_RUNTIME_VERSION, "4.0.0");
  assert.equal(PYBOT_STOP_RELIABLE_MIN, "3.2.4");
  assert.equal(runtimeStopReliable({ firmware: "3.2.4" }), true);
  assert.equal(runtimeStopReliable({ firmware: "4.0.0" }), true);
  assert.equal(runtimeStopReliable({ firmware: "3.2.3" }), false);
  assert.ok(compareRuntimeVersions("3.2.3", PYBOT_STOP_RELIABLE_MIN) < 0);
});

test("UI onStop attempts BLE stop without requiring local running", () => {
  const ide = fs.readFileSync(IDE, "utf8");
  const start = ide.indexOf("const onStop = useCallback");
  assert.ok(start >= 0);
  const body = ide.slice(start, start + 1800);
  // Regresión aula: Stop con app autostart y running=false no hacía nada.
  assert.match(body, /bleConnected/);
  assert.match(body, /bleAppRunning|bleAppStatus/);
  assert.match(body, /stopBoardExecution/);
  assert.match(body, /expectRunCleanup/);
  assert.match(ide, /bleStopRuntimeOld/);
  assert.match(ide, /bleRuntimeStopStatus/);
});

test("stopBoardExecution arms ACK before APP:STOP and escalates FORCE", () => {
  const src = fs.readFileSync(BRIDGE, "utf8");
  const start = src.indexOf("export async function stopBoardExecution");
  const body = src.slice(start, start + 4500);
  assert.match(body, /armBleStopAck/);
  assert.match(body, /APP\.STOP/);
  assert.match(body, /STOP_FORCE/);
  assert.match(body, /stop\(\{\s*wait:\s*true\s*\}\)/);
  // No depender de appStop/sendAndWait solo (puede false-ack); path unificado.
  assert.match(body, /waitArmedBleStopAck/);
  // Regresión Run→Stop→Run: no FORCE si arranco otro Run o la placa responde PING.
  assert.match(body, /_bleRunPrepGen/);
  assert.match(body, /app-superseded|app-idle/);
  assert.match(body, /_bleStopInFlight/);
  // 3.2.7: tras stop cooperativo, NUNCA path APP+FORCE (gracia / disarm).
  assert.match(body, /app-recent-coop|recentlyCoopStopped|noteBleCoopStopped/);
  assert.match(body, /disarmForceEscalate/);
  assert.match(src, /STOP:FORCE enviado/);
  assert.match(src, /setBleForceLog/);
});

test("UI wires FORCE log to console", () => {
  const ide = fs.readFileSync(IDE, "utf8");
  assert.match(ide, /setBleForceLog/);
  assert.match(ide, /STOP:FORCE|setBleForceLog/);
});
