import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_DIAGNOSTIC_SCRIPT,
  parseMemoryDiagnostic,
} from "../src/memoryDiagnostic.js";

test("script imprime las líneas parseables esperadas", () => {
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MEMFREE', gc\.mem_free\(\)\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('MAINSIZE'/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('CORESIZE'/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('COMPILE', 'OK'\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('COMPILE', 'MEMORYERROR'\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('BLE', 'OK'\)/);
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /print\('DIAG_DONE'\)/);
  // Siempre desactiva BLE si se activó (solo lectura, no deja estado raro).
  assert.match(MEMORY_DIAGNOSTIC_SCRIPT, /_ble\.active\(False\)/);
});

test("todo OK → conclusión 'ok'", () => {
  const out = [
    "MEMFREE 58000",
    "MAINSIZE 36",
    "CORESIZE 18000",
    "COMPILE OK",
    "BLE OK",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.memFree, 58000);
  assert.equal(r.mainSize, 36);
  assert.equal(r.coreSize, 18000);
  assert.equal(r.compile, "OK");
  assert.equal(r.ble, "OK");
  assert.equal(r.bleTested, true);
  assert.equal(r.done, true);
  assert.equal(r.conclusion, "ok");
});

test("MemoryError al compilar → conclusión 'memory'", () => {
  const out = [
    "MEMFREE 8000",
    "MAINSIZE 58000",
    "COMPILE MEMORYERROR",
    "BLE OK",
    "DIAG_DONE",
  ].join("\r\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.compile, "MEMORYERROR");
  assert.equal(r.conclusion, "memory");
});

test("MemoryError al activar BLE → conclusión 'memory'", () => {
  const out = [
    "MEMFREE 12000",
    "MAINSIZE 58000",
    "COMPILE OK",
    "BLE MEMORYERROR",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.ble, "MEMORYERROR");
  assert.equal(r.conclusion, "memory");
});

test("main.py inexistente → mainSize null, sigue parseando", () => {
  const out = ["MEMFREE 40000", "MAINSIZE NA", "COMPILE OK", "BLE OK", "DIAG_DONE"].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.mainSize, null);
  assert.equal(r.conclusion, "ok");
});

test("error de compilación no-memoria → captura repr y conclusión 'unknown'", () => {
  const out = [
    "MEMFREE 40000",
    "MAINSIZE 58000",
    "COMPILE ERR SyntaxError('invalid syntax',)",
    "DIAG_DONE",
  ].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.compile, "ERR");
  assert.equal(r.compileError, "SyntaxError('invalid syntax',)");
  assert.equal(r.conclusion, "unknown");
});

test("BLE no probado (sin línea BLE) con compile OK → conclusión 'ok'", () => {
  const out = ["MEMFREE 40000", "MAINSIZE 37000", "COMPILE OK", "DIAG_DONE"].join("\n");
  const r = parseMemoryDiagnostic(out);
  assert.equal(r.bleTested, false);
  assert.equal(r.ble, null);
  assert.equal(r.conclusion, "ok");
});

test("salida vacía / sin sentinel → done false, conclusión 'unknown'", () => {
  const r = parseMemoryDiagnostic("");
  assert.equal(r.done, false);
  assert.equal(r.conclusion, "unknown");
  assert.equal(r.memFree, null);
});
