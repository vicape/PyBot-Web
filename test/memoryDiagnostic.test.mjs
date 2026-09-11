import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEMORY_DIAGNOSTIC_SCRIPT,
  parseMemoryDiagnostic,
} from "../src/memoryDiagnostic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

test("script does not compile pybot_ble source as a string", () => {
  assert.doesNotMatch(MEMORY_DIAGNOSTIC_SCRIPT, /open\(_core\)\.read\(\)/);
  assert.doesNotMatch(MEMORY_DIAGNOSTIC_SCRIPT, /compile\(_src/);
  assert.doesNotMatch(MEMORY_DIAGNOSTIC_SCRIPT, /compile\(/);
});

test("script imports pybot_ble instead of compiling it", () => {
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /import pybot_ble/);
  assert.doesNotMatch(MEMORY_DIAGNOSTIC_SCRIPT, /pybot_ble\.main\(/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /del sys\.modules\['pybot_ble'\]/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /_ble\.active\(False\)/);
});

test("script measures RAM before, pre-import, post-import and after BLE", () => {
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MEMFREE_BEFORE', gc\.mem_free\(\)\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MEMFREE_PREIMPORT', gc\.mem_free\(\)\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MEMFREE_POSTIMPORT', gc\.mem_free\(\)\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MEMFREE_AFTER_BLE', gc\.mem_free\(\)\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MAINSIZE'/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('CORESIZE'/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('DIAG_DONE'\)/);
});

test("parser RUNTIME_IMPORT OK → runtimeImport OK", () => {
  const r = parseMemoryDiagnostic("RUNTIME_IMPORT OK\n");
  assert.equal(r.runtimeImport, "OK");
  assert.equal(r.compile, "OK");
});

test("parser RUNTIME_IMPORT MEMORYERROR → conclusion memory", () => {
  const out = [
    "MEMFREE_BEFORE 8000",
    "MAINSIZE 36",
    "CORESIZE 18000",
    "MEMFREE_PREIMPORT 7900",
    "RUNTIME_IMPORT MEMORYERROR",
    "MEMFREE_POSTIMPORT 7800",
    "BLE OK",
    "MEMFREE_AFTER_BLE 7700",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.runtimeImport, "MEMORYERROR");
  assert.equal(r.conclusion, "memory");
});

test("parser import OK + BLE OK + DIAG_DONE → conclusion ok", () => {
  const out = [
    "MEMFREE_BEFORE 95296",
    "MAINSIZE 34",
    "CORESIZE 32000",
    "MEMFREE_PREIMPORT 94800",
    "RUNTIME_IMPORT OK",
    "MEMFREE_POSTIMPORT 51000",
    "BLE OK",
    "MEMFREE_AFTER_BLE 45000",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.memFreeBefore, 95296);
  assert.equal(r.memFreePreImport, 94800);
  assert.equal(r.memFreePostImport, 51000);
  assert.equal(r.memFreeAfterBle, 45000);
  assert.equal(r.memFree, 95296);
  assert.equal(r.mainSize, 34);
  assert.equal(r.coreSize, 32000);
  assert.equal(r.runtimeImport, "OK");
  assert.equal(r.ble, "OK");
  assert.equal(r.done, true);
  assert.equal(r.conclusion, "ok");
});

test("parser import OK without BLE test → conclusion unknown", () => {
  const out = ["RUNTIME_IMPORT OK", "DIAG_DONE"].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.runtimeImport, "OK");
  assert.equal(r.ble, null);
  assert.equal(r.conclusion, "unknown");
});

test("a normal ERR is not classified as MemoryError", () => {
  const out = [
    "MEMFREE_BEFORE 40000",
    "MAINSIZE 36",
    "CORESIZE 18000",
    "MEMFREE_PREIMPORT 39000",
    "RUNTIME_IMPORT ERR ImportError('no module named pybot_ble')",
    "MEMFREE_POSTIMPORT 39000",
    "BLE OK",
    "MEMFREE_AFTER_BLE 38000",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.runtimeImport, "ERR");
  assert.equal(r.runtimeImportError, "ImportError('no module named pybot_ble')");
  assert.equal(r.compileError, "ImportError('no module named pybot_ble')");
  assert.notEqual(r.runtimeImport, "MEMORYERROR");
  assert.equal(r.conclusion, "unknown");
});

test("BLE MEMORYERROR after a successful import is still a memory conclusion", () => {
  const out = [
    "RUNTIME_IMPORT OK",
    "BLE MEMORYERROR",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.runtimeImport, "OK");
  assert.equal(r.ble, "MEMORYERROR");
  assert.equal(r.conclusion, "memory");
});

test("main.py missing stays parseable", () => {
  const out = [
    "MEMFREE_BEFORE 40000",
    "MAINSIZE NA",
    "CORESIZE NA",
    "MEMFREE_PREIMPORT 40000",
    "RUNTIME_IMPORT ERR ImportError('no module')",
    "MEMFREE_POSTIMPORT 40000",
    "BLE OK",
    "MEMFREE_AFTER_BLE 40000",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.mainSize, null);
  assert.equal(r.coreSize, null);
  assert.equal(r.conclusion, "unknown");
});

test("empty output is unknown", () => {
  const r = parseMemoryDiagnostic("");
  assert.equal(r.done, false);
  assert.equal(r.conclusion, "unknown");
  assert.equal(r.memFreeBefore, null);
  assert.equal(r.runtimeImport, null);
});

test("UI talks about runtime import, not compilation", () => {
  const es = readFileSync(join(root, "src", "i18n.js"), "utf8");
  const ide = readFileSync(join(root, "src", "PyBotIDE.jsx"), "utf8");
  assert.match(es, /Importación del runtime/);
  assert.match(es, /Runtime import/);
  assert.doesNotMatch(es, /Compilación del runtime/);
  assert.doesNotMatch(es, /Runtime compilation/);
  assert.match(ide, /memDiagRuntimeImport/);
  assert.doesNotMatch(ide, /memDiagResult/);
});
