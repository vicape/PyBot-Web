/**
 * Helpers compartidos para endpoints de telemetría (Vercel serverless).
 * Solo server-side — no importar desde el browser.
 */

import { createHash, randomUUID } from "node:crypto";

export const ANON_COOKIE = "pybot_anon_id";
export const SESSION_TTL_MS = 30 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ALLOWED_EVENTS = new Set([
  "app_open",
  "page_view",
  "login",
  "logout",
  "ide_open",
  "ide_run",
  "ide_stop",
  "esp32_connect",
  "esp32_disconnect",
  "ble_connect",
  "ble_disconnect",
  "usb_connect",
  "usb_disconnect",
  "activity_open",
  "classroom_open",
  "error",
]);

const EVENT_CATEGORY = {
  app_open: "system",
  page_view: "navigation",
  login: "auth",
  logout: "auth",
  ide_open: "ide",
  ide_run: "ide",
  ide_stop: "ide",
  esp32_connect: "hardware",
  esp32_disconnect: "hardware",
  ble_connect: "hardware",
  ble_disconnect: "hardware",
  usb_connect: "hardware",
  usb_disconnect: "hardware",
  activity_open: "academic",
  classroom_open: "classroom",
  error: "error",
};

const METADATA_ALLOW = new Set([
  "transport",
  "runtime_version",
  "language_mode",
  "error_code",
  "feature",
  "http_status",
  "board_type",
  "editor_mode",
  "consent_state",
  "path",
]);

const SENSITIVE_KEY_RE = /token|password|secret|authorization|cookie|code|source|wifi|ssid|credential/i;

export function isValidUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

export function newUuid() {
  return randomUUID();
}

export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(val);
  }
  return out;
}

export function anonCookieHeader(anonymousId, isProd) {
  const parts = [
    `${ANON_COOKIE}=${encodeURIComponent(anonymousId)}`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=31536000",
    "HttpOnly",
  ];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

function headerFirst(req, name) {
  const headers = req?.headers || {};
  const key = name.toLowerCase();
  const raw = headers[key] ?? headers[name];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

function normalizeIp(raw) {
  if (!raw || typeof raw !== "string") return null;
  const ip = raw.split(",")[0].trim();
  if (!ip || ip.toLowerCase() === "unknown") return null;
  return ip;
}

/** IP del cliente. Vercel expone x-forwarded-for / x-vercel-forwarded-for / x-real-ip. */
export function clientIp(req) {
  const candidates = [
    headerFirst(req, "x-forwarded-for"),
    headerFirst(req, "x-vercel-forwarded-for"),
    headerFirst(req, "x-real-ip"),
    headerFirst(req, "cf-connecting-ip"),
    headerFirst(req, "true-client-ip"),
  ];
  for (const raw of candidates) {
    const ip = normalizeIp(raw);
    if (ip) return ip;
  }
  return null;
}

export function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.TELEMETRY_IP_SALT || "";
  return createHash("sha256").update(`${salt}${ip}`).digest("hex");
}

export function ipPrefix(ip) {
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.slice(0, 4).join(":") + "::";
  }
  return null;
}

export function geoFromHeaders(req) {
  return {
    country: headerStr(req, "x-vercel-ip-country") || null,
    region: headerStr(req, "x-vercel-ip-country-region") || null,
    city: headerStr(req, "x-vercel-ip-city") || null,
  };
}

function headerStr(req, name) {
  const v = headerFirst(req, name);
  return v && v.trim() ? v.trim() : null;
}

/**
 * Prioridad: cookie válida → body.anonymous_id válido → generar nuevo.
 * No aceptar IDs arbitrarios no-UUID.
 */
export function resolveAnonymousId(req, bodyAnon) {
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = cookies[ANON_COOKIE];
  if (isValidUuid(fromCookie)) return { id: fromCookie, source: "cookie" };
  if (isValidUuid(bodyAnon)) return { id: bodyAnon, source: "client" };
  return { id: newUuid(), source: "new" };
}

export async function resolveUserId(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,
      },
    });
    if (!userRes.ok) return null;
    const data = await userRes.json().catch(() => null);
    return data?.id && isValidUuid(data.id) ? data.id : null;
  } catch {
    return null;
  }
}

export async function supabaseRest(path, { method = "GET", body, prefer } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    const err = new Error("server_misconfigured");
    err.code = "server_misconfigured";
    throw err;
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(typeof data === "object" ? data.message || data.error || "db_error" : "db_error");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!METADATA_ALLOW.has(k)) continue;
    if (SENSITIVE_KEY_RE.test(k) && k !== "error_code") continue;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

export function normalizeEvent(ev) {
  if (!ev || typeof ev !== "object") return null;
  const name = typeof ev.event_name === "string" ? ev.event_name : ev.name;
  if (!ALLOWED_EVENTS.has(name)) return null;
  return {
    event_name: name,
    event_category: EVENT_CATEGORY[name] || (typeof ev.event_category === "string" ? ev.event_category : null),
    path: typeof ev.path === "string" ? ev.path.slice(0, 500) : null,
    metadata: sanitizeMetadata(ev.metadata),
  };
}

export function isProd(req) {
  const host = req.headers.host || "";
  return host.includes("vercel.app") || process.env.VERCEL_ENV === "production";
}
