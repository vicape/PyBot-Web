import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(__dirname, "..", "src", "hardwareBridge.js");
const IDE = path.join(__dirname, "..", "src", "PyBotIDE.jsx");

test("clearPersistentAppUsb removes pybot_app files without wiping runtime", () => {
  const src = fs.readFileSync(BRIDGE, "utf8");
  assert.match(src, /const PERSISTENT_APP_FILES = \[/);
  assert.match(src, /"pybot_app\.py"/);
  assert.match(src, /"pybot_app\.json"/);
  assert.match(src, /export async function clearPersistentAppUsb/);
  assert.match(src, /PERSISTENT_APP_FILES/);
  assert.match(src, /pybot_state\.json/);
  // La acción de clear no reinstala el runtime.
  const start = src.indexOf("export async function clearPersistentAppUsb");
  const next = src.indexOf("\nexport async function", start + 10);
  const body = next >= 0 ? src.slice(start, next) : src.slice(start);
  assert.ok(!body.includes("getBleRuntimeInstallFiles"));
  assert.ok(!body.includes("installBleRuntime"));
});

test("stopBoardExecution prefers APP:STOP then FORCE without requiring APP:INFO", () => {
  const src = fs.readFileSync(BRIDGE, "utf8");
  const fn = src.slice(src.indexOf("export async function stopBoardExecution"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /APP\.STOP/);
  assert.match(body, /STOP_FORCE/);
  // Regresión: no bloquear el Stop en APP:INFO (puede no responder con exec activo).
  assert.ok(!body.includes("appInfo("));
});

test("UI exposes USB clear persistent app recovery action", () => {
  const ide = fs.readFileSync(IDE, "utf8");
  assert.match(ide, /clearPersistentAppUsb/);
  assert.match(ide, /bleClearAppBtn/);
  assert.match(ide, /onClearPersistentAppUsb/);
});
