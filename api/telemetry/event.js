/**
 * POST /api/telemetry/event
 * Body: { session_id, anonymous_id?, events: [...] }
 * Header opcional: Authorization: Bearer <supabase_access_token>
 */

import {
  anonCookieHeader,
  isProd,
  isValidUuid,
  normalizeEvent,
  resolveAnonymousId,
  resolveUserId,
  supabaseRest,
} from "../_telemetryHelpers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const { id: anonymousId } = resolveAnonymousId(req, body.anonymous_id);
    const userId = await resolveUserId(req);
    res.setHeader("Set-Cookie", anonCookieHeader(anonymousId, isProd(req)));

    const sessionId = body.session_id;
    if (!isValidUuid(sessionId)) {
      return res.status(400).json({ error: "invalid_session" });
    }

    const rawList = Array.isArray(body.events)
      ? body.events
      : body.event_name || body.name
        ? [body]
        : [];

    if (rawList.length === 0) {
      return res.status(400).json({ error: "no_events" });
    }
    if (rawList.length > 40) {
      return res.status(400).json({ error: "too_many_events" });
    }

    // Verificar que la sesión pertenece al anonymous_id
    const sessions = await supabaseRest(
      `usage_sessions?id=eq.${sessionId}&anonymous_id=eq.${anonymousId}&select=id`,
    );
    if (!Array.isArray(sessions) || !sessions[0]) {
      return res.status(404).json({ error: "session_not_found" });
    }

    const rows = [];
    for (const raw of rawList) {
      const ev = normalizeEvent(raw);
      if (!ev) continue;
      rows.push({
        session_id: sessionId,
        anonymous_id: anonymousId,
        user_id: userId || null,
        event_name: ev.event_name,
        event_category: ev.event_category,
        path: ev.path,
        metadata: ev.metadata,
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: "no_valid_events" });
    }

    await supabaseRest("usage_events", {
      method: "POST",
      body: rows,
      prefer: "return=minimal",
    });

    return res.status(200).json({ ok: true, accepted: rows.length });
  } catch (ex) {
    if (ex?.code === "server_misconfigured") {
      return res.status(500).json({ error: "server_misconfigured" });
    }
    console.error("telemetry/event:", ex);
    return res.status(500).json({ error: "internal" });
  }
}
