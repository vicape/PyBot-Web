/**
 * Vercel Serverless Function: renueva el access_token de Google Classroom.
 *
 * POST /api/refresh-classroom-token
 * Header: Authorization: Bearer <supabase_access_token>
 * Body (preferido P5/P16): { mode, org_id }
 * Body (legacy P1):        { refresh_token }
 *
 * Responde: { access_token, expires_in, source? } o { error }
 */

import { resolveUserId } from "./_telemetryHelpers.js";
import {
  isUuid,
  loadClassroomRefreshToken,
  normalizeClassroomMode,
} from "./_classroomCredentials.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const supabaseToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const body = req.body || {};
  const legacyRefresh =
    typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
  const mode = normalizeClassroomMode(body.mode);
  const orgId = typeof body.org_id === "string" ? body.org_id.trim() : "";

  if (!supabaseToken) {
    return res.status(400).json({ error: "missing_params" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let refreshToken = legacyRefresh || null;
  let source = legacyRefresh ? "client_legacy" : null;

  if (!refreshToken) {
    const loaded = await loadClassroomRefreshToken({
      userId,
      orgId: isUuid(orgId) ? orgId : null,
      mode,
    });
    refreshToken = loaded.refreshToken;
    source = loaded.source;
  }

  if (!refreshToken) {
    return res.status(400).json({ error: "missing_refresh_token" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "google_not_configured" });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const googleRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await googleRes.json().catch(() => ({}));
  if (!googleRes.ok) {
    return res.status(400).json({ error: data.error || "google_refresh_failed" });
  }

  return res.status(200).json({
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
    source: source || undefined,
  });
}
