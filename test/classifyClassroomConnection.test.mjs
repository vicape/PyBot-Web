import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSROOM_CONNECTION,
  classifyClassroomConnectionError,
  classroomConnectionBadge,
  shouldShowClassroomReconnect,
} from "../src/platform/classifyClassroomConnection.js";
import { readFileSync } from "node:fs";

test("P3: sin token → NOT_CONNECTED", () => {
  const r = classifyClassroomConnectionError({ code: "missing_access_token", message: "missing_access_token" });
  assert.equal(r.status, CLASSROOM_CONNECTION.NOT_CONNECTED);
  assert.equal(r.message, null);
});

test("P3: invalid_grant → RECONNECT_REQUIRED", () => {
  const r = classifyClassroomConnectionError({ code: "invalid_grant", message: "invalid_grant" });
  assert.equal(r.status, CLASSROOM_CONNECTION.RECONNECT_REQUIRED);
  assert.match(r.message, /Reconectá/);
});

test("P3: 401 → RECONNECT_REQUIRED", () => {
  const r = classifyClassroomConnectionError({ status: 401, message: "Unauthorized" });
  assert.equal(r.status, CLASSROOM_CONNECTION.RECONNECT_REQUIRED);
});

test("P3: permisos insuficientes por googleReason", () => {
  const r = classifyClassroomConnectionError({
    status: 403,
    code: "PERMISSION_DENIED",
    googleReason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    message: "Request had insufficient authentication scopes.",
  });
  assert.equal(r.status, CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS);
});

test("P3: error temporal → ERROR (no CONNECTED)", () => {
  const r = classifyClassroomConnectionError({ status: 503, message: "Service Unavailable" });
  assert.equal(r.status, CLASSROOM_CONNECTION.ERROR);
  assert.notEqual(r.status, CLASSROOM_CONNECTION.CONNECTED);
});

test("P3: badge Conectado sólo para CONNECTED", () => {
  assert.equal(classroomConnectionBadge(CLASSROOM_CONNECTION.CONNECTED).tone, "ok");
  assert.equal(classroomConnectionBadge(CLASSROOM_CONNECTION.CONNECTED).label, "Conectado");
  for (const s of [
    CLASSROOM_CONNECTION.CHECKING,
    CLASSROOM_CONNECTION.NOT_CONNECTED,
    CLASSROOM_CONNECTION.RECONNECT_REQUIRED,
    CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS,
    CLASSROOM_CONNECTION.ERROR,
  ]) {
    assert.notEqual(classroomConnectionBadge(s).tone, "ok");
    assert.notEqual(classroomConnectionBadge(s).label, "Conectado");
  }
});

test("P3: ClassroomPanel no usa linkedAt solo para badge verde", () => {
  const src = readFileSync(new URL("../src/components/dashboard/ClassroomPanel.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /linkedAt && courses\.length >= 0/);
  assert.doesNotMatch(src, /\{linkedAt \? "Vinculado"/);
  assert.match(src, /connectionStatus/);
  assert.match(src, /CLASSROOM_CONNECTION\.CONNECTED/);
  assert.match(src, /classifyClassroomConnectionError/);
  assert.match(src, /shouldShowClassroomReconnect/);
});

test("P3: linkedAt histórico no implica CONNECTED en el clasificador", () => {
  const r = classifyClassroomConnectionError({ status: 500, message: "boom" });
  assert.equal(r.status, CLASSROOM_CONNECTION.ERROR);
  assert.equal(classroomConnectionBadge(r.status).label, "No se pudo comprobar");
});

test("P3: ERROR no ofrece Reconectar; RECONNECT y permisos sí", () => {
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.ERROR), false);
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.CHECKING), false);
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.NOT_CONNECTED), false);
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.CONNECTED), false);
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.RECONNECT_REQUIRED), true);
  assert.equal(shouldShowClassroomReconnect(CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS), true);
});

test("P3: PyBotClassHome usa Vinculado/No vinculado, no Conectado por persistencia", () => {
  const src = readFileSync(
    new URL("../src/components/pybotclass/layout/PyBotClassHome.jsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /Vinculado/);
  assert.match(src, /No vinculado/);
  assert.doesNotMatch(src, /classroomLinked \? "Conectado"/);
  assert.doesNotMatch(src, /"No conectado"/);
  assert.doesNotMatch(src, /Google Classroom conectado/);
  assert.match(src, /Google Classroom vinculado/);
  assert.match(src, /Google Classroom no vinculado/);
});

test("P1/P2 intactos", () => {
  const token = readFileSync(new URL("../src/platform/classroomToken.js", import.meta.url), "utf8");
  assert.match(token, /\/api\/refresh-classroom-token/);
  assert.doesNotMatch(token, /VITE_GOOGLE_CLIENT_SECRET/);
  const persist = readFileSync(
    new URL("../src/platform/confirmClassroomPersistence.js", import.meta.url),
    "utf8",
  );
  assert.match(persist, /persist_skipped|missing_refresh_token/);
});
