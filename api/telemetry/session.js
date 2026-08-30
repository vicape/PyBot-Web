/**
 * POST /api/telemetry/session
 * Body: { action: "start"|"heartbeat"|"end"|"authenticate", session_id?, anonymous_id?, device?, ... }
 * Header opcional: Authorization: Bearer <supabase_access_token>
 */

import {
  anonCookieHeader,
  clientIp,
  geoFromHeaders,
  hashIp,
  ipPrefix,
  isProd,
  isValidUuid,
  resolveAnonymousId,
  resolveUserId,
  SESSION_TTL_MS,
  supabaseRest,
} from "../_telemetryHelpers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const action = body.action || "start";
    const { id: anonymousId } = resolveAnonymousId(req, body.anonymous_id);
    const userId = await resolveUserId(req);
    // Ignorar body.user_id — nunca confiar en el cliente
    const cookie = anonCookieHeader(anonymousId, isProd(req));
    res.setHeader("Set-Cookie", cookie);

    if (action === "start") {
      return await startSession(req, res, { anonymousId, userId, body });
    }
    if (action === "heartbeat") {
      return await heartbeat(res, { anonymousId, userId, body });
    }
    if (action === "end") {
      return await endSession(res, { anonymousId, userId, body });
    }
    if (action === "authenticate") {
      return await authenticateSession(res, { anonymousId, userId, body });
    }
    return res.status(400).json({ error: "unknown_action" });
  } catch (ex) {
    if (ex?.code === "server_misconfigured") {
      return res.status(500).json({ error: "server_misconfigured" });
    }
    console.error("telemetry/session:", ex);
    return res.status(500).json({ error: "internal" });
  }
}

async function startSession(req, res, { anonymousId, userId, body }) {
  const ip = clientIp(req);
  const geo = geoFromHeaders(req);
  const device = body.device && typeof body.device === "object" ? body.device : {};
  const now = new Date().toISOString();

  // Reutilizar sesión abierta reciente del mismo anonymous_id
  const existing = await supabaseRest(
    `usage_sessions?anonymous_id=eq.${anonymousId}&ended_at=is.null&order=last_seen_at.desc&limit=1`,
  );
  if (Array.isArray(existing) && existing[0]) {
    const row = existing[0];
    const last = new Date(row.last_seen_at).getTime();
    if (Date.now() - last < SESSION_TTL_MS) {
      const patch = {
        last_seen_at: now,
        is_authenticated: !!userId || row.is_authenticated,
      };
      if (userId) patch.user_id = userId;
      await supabaseRest(`usage_sessions?id=eq.${row.id}`, {
        method: "PATCH",
        body: patch,
        prefer: "return=representation",
      });
      return res.status(200).json({
        session_id: row.id,
        anonymous_id: anonymousId,
        reused: true,
      });
    }
  }

  const consent =
    body.consent_state === "accepted" || body.consent_state === "declined"
      ? body.consent_state
      : "unknown";

  const insert = {
    anonymous_id: anonymousId,
    user_id: userId || null,
    started_at: now,
    last_seen_at: now,
    duration_seconds: 0,
    is_authenticated: !!userId,
    consent_state: consent,
    ip_hash: hashIp(ip),
    ip_prefix: ipPrefix(ip),
    country: geo.country,
    region: geo.region,
    city: geo.city,
    user_agent: str(device.user_agent, 512),
    browser: str(device.browser, 64),
    browser_version: str(device.browser_version, 32),
    os: str(device.os, 64),
    os_version: str(device.os_version, 32),
    device_type: str(device.device_type, 32),
    language: str(device.language, 32),
    timezone: str(device.timezone, 64),
    screen_width: num(device.screen_width),
    screen_height: num(device.screen_height),
    referrer: str(device.referrer, 500),
    landing_path: str(device.landing_path || body.path, 500),
  };

  const rows = await supabaseRest("usage_sessions", {
    method: "POST",
    body: insert,
    prefer: "return=representation",
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return res.status(200).json({
    session_id: row?.id,
    anonymous_id: anonymousId,
    reused: false,
  });
}

async function heartbeat(res, { anonymousId, body }) {
  const sessionId = body.session_id;
  if (!isValidUuid(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }
  const rows = await supabaseRest(
    `usage_sessions?id=eq.${sessionId}&anonymous_id=eq.${anonymousId}&select=id,started_at,ended_at`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.ended_at) {
    return res.status(404).json({ error: "session_not_found" });
  }
  const now = new Date();
  const started = new Date(row.started_at);
  const duration = Math.max(0, Math.floor((now - started) / 1000));
  await supabaseRest(`usage_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: {
      last_seen_at: now.toISOString(),
      duration_seconds: duration,
    },
  });
  return res.status(200).json({
    session_id: sessionId,
    anonymous_id: anonymousId,
    duration_seconds: duration,
  });
}

async function endSession(res, { anonymousId, body }) {
  const sessionId = body.session_id;
  if (!isValidUuid(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }
  const rows = await supabaseRest(
    `usage_sessions?id=eq.${sessionId}&anonymous_id=eq.${anonymousId}&select=id,started_at`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return res.status(404).json({ error: "session_not_found" });
  }
  const now = new Date();
  const duration = Math.max(0, Math.floor((now - new Date(row.started_at)) / 1000));
  await supabaseRest(`usage_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: {
      last_seen_at: now.toISOString(),
      ended_at: now.toISOString(),
      duration_seconds: duration,
    },
  });
  return res.status(200).json({ ok: true, duration_seconds: duration });
}

async function authenticateSession(res, { anonymousId, userId, body }) {
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const sessionId = body.session_id;
  if (!isValidUuid(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }
  await supabaseRest(`usage_sessions?id=eq.${sessionId}&anonymous_id=eq.${anonymousId}`, {
    method: "PATCH",
    body: {
      user_id: userId,
      is_authenticated: true,
      last_seen_at: new Date().toISOString(),
    },
  });
  return res.status(200).json({
    session_id: sessionId,
    anonymous_id: anonymousId,
    user_id: userId,
  });
}

function str(v, max) {
  if (typeof v !== "string") return null;
  return v.slice(0, max);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.floor(n) : null;
}
