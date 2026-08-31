import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnonymousId,
  isValidAnonymousId,
} from "../src/telemetry/anonymousIdentity.js";
import { sanitizeMetadata, ALLOWED_EVENT_NAMES } from "../src/telemetry/sanitizeMetadata.js";
import { parseUserAgent } from "../src/telemetry/deviceInfo.js";
import {
  clientIp,
  hashIp,
  ipPrefix,
  isValidUuid,
  normalizeEvent,
  resolveAnonymousId,
  sanitizeMetadata as sanitizeServer,
  ANON_COOKIE,
} from "../api/_telemetryHelpers.js";

test("anonymous ID válido (UUID v4)", () => {
  const id = createAnonymousId();
  assert.equal(isValidAnonymousId(id), true);
  assert.equal(isValidUuid(id), true);
});

test("cookie existente se reutiliza en resolveAnonymousId", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const req = { headers: { cookie: `${ANON_COOKIE}=${id}` } };
  const r = resolveAnonymousId(req, "22222222-2222-4222-8222-222222222222");
  assert.equal(r.id, id);
  assert.equal(r.source, "cookie");
});

test("localStorage / client body sirve como fallback", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const req = { headers: {} };
  const r = resolveAnonymousId(req, id);
  assert.equal(r.id, id);
  assert.equal(r.source, "client");
});

test("ID inválido del cliente se descarta y se crea uno nuevo", () => {
  const req = { headers: {} };
  const r = resolveAnonymousId(req, "not-a-uuid");
  assert.equal(isValidUuid(r.id), true);
  assert.equal(r.source, "new");
});

test("metadata sensible se elimina (cliente)", () => {
  const clean = sanitizeMetadata({
    transport: "ble",
    password: "x",
    access_token: "y",
    code: "print(1)",
    error_code: "classroom_403",
  });
  assert.deepEqual(clean, { transport: "ble", error_code: "classroom_403" });
});

test("metadata sensible se elimina (servidor)", () => {
  const clean = sanitizeServer({
    wifi: "secret",
    runtime_version: "4.0.6",
    authorization: "Bearer x",
  });
  assert.deepEqual(clean, { runtime_version: "4.0.6" });
});

test("eventos permitidos se aceptan; desconocidos se rechazan", () => {
  assert.ok(ALLOWED_EVENT_NAMES.has("ide_run"));
  assert.ok(normalizeEvent({ event_name: "ide_run", metadata: { transport: "usb" } }));
  assert.equal(normalizeEvent({ event_name: "hack_event" }), null);
});

test("IP nunca queda almacenada completa", () => {
  process.env.TELEMETRY_IP_SALT = "test-salt";
  const ip = "192.168.10.55";
  const h = hashIp(ip);
  assert.equal(typeof h, "string");
  assert.equal(h.includes(ip), false);
  assert.equal(h.length, 64);
  assert.equal(ipPrefix(ip), "192.168.10.xxx");
});

test("clientIp lee headers de Vercel/proxy", () => {
  assert.equal(
    clientIp({ headers: { "x-vercel-forwarded-for": "203.0.113.9" } }),
    "203.0.113.9",
  );
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": ["198.51.100.2", "10.0.0.1"] } }),
    "198.51.100.2",
  );
  assert.equal(clientIp({ headers: {} }), null);
});

test("cookie name no contiene PII", () => {
  assert.equal(ANON_COOKIE, "pybot_anon_id");
  assert.equal(/email|user|name/i.test(ANON_COOKIE), false);
});

test("parseUserAgent deriva browser/os/device sin librería", () => {
  const p = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  );
  assert.equal(p.browser, "chrome");
  assert.equal(p.os, "windows");
  assert.equal(p.device_type, "desktop");
});

test("cliente no puede falsificar user_id en normalizeEvent", () => {
  const ev = normalizeEvent({
    event_name: "login",
    metadata: { user_id: "fake", transport: "ble" },
  });
  assert.ok(ev);
  assert.equal(ev.metadata.user_id, undefined);
  assert.equal(ev.metadata.transport, "ble");
});
