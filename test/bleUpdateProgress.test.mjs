import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUpdatePct,
  formatBleUpdateProgressText,
} from "../src/bleUpdateProgress.js";

const labels = {
  transfer: "Updating… {pct}%",
  verifying: "Verifying…",
  applying: "Applying…",
  reconnecting: "Reconnecting…",
  restarting: "Restarting…",
  finished: "Completed",
  updating: "Updating…",
};

test("normalizeUpdatePct: 0 al inicio y clamps", () => {
  assert.equal(normalizeUpdatePct(undefined), 0);
  assert.equal(normalizeUpdatePct(null), 0);
  assert.equal(normalizeUpdatePct(NaN), 0);
  assert.equal(normalizeUpdatePct(-3), 0);
  assert.equal(normalizeUpdatePct(0), 0);
  assert.equal(normalizeUpdatePct(42.4), 42);
  assert.equal(normalizeUpdatePct(42.6), 43);
  assert.equal(normalizeUpdatePct(100), 100);
  assert.equal(normalizeUpdatePct(150), 100);
});

test("formatBleUpdateProgressText: start/begin muestran 0%", () => {
  assert.equal(formatBleUpdateProgressText("start", 0, labels), "Updating… 0%");
  assert.equal(formatBleUpdateProgressText("begin", undefined, labels), "Updating… 0%");
  // aunque llegue otro pct, start/begin fuerzan 0 visible
  assert.equal(formatBleUpdateProgressText("start", 50, labels), "Updating… 0%");
});

test("formatBleUpdateProgressText: transfer usa porcentaje real", () => {
  assert.equal(formatBleUpdateProgressText("transfer", 0, labels), "Updating… 0%");
  assert.equal(formatBleUpdateProgressText("transfer", 37, labels), "Updating… 37%");
  assert.equal(formatBleUpdateProgressText("transfer", 100, labels), "Updating… 100%");
});

test("formatBleUpdateProgressText: done = Finalizado/Completed", () => {
  assert.equal(formatBleUpdateProgressText("done", 100, labels), "Completed");
  const es = { ...labels, finished: "Finalizado" };
  assert.equal(formatBleUpdateProgressText("done", 100, es), "Finalizado");
});

test("formatBleUpdateProgressText: fases intermedias", () => {
  assert.equal(formatBleUpdateProgressText("verified", 100, labels), "Verifying…");
  assert.equal(formatBleUpdateProgressText("applying", 100, labels), "Applying…");
  assert.equal(formatBleUpdateProgressText("reconnecting", 100, labels), "Reconnecting…");
  assert.equal(formatBleUpdateProgressText("verifying-version", 100, labels), "Restarting…");
  assert.equal(formatBleUpdateProgressText("unknown", 10, labels), "Updating…");
});
