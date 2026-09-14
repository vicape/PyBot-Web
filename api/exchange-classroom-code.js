/**
 * Vercel Serverless Function: intercambia authorization code de Google Classroom.
 *
 * POST /api/exchange-classroom-code
 * Header: Authorization: Bearer <supabase_access_token>
 * Body:   { code, redirect_uri, mode?, org_id? }
 *
 * Responde:
 *   - vault OK: { access_token, expires_in, persisted: true, org_id, mode }  (sin refresh_token)
 *   - vault no disponible / sin org: { access_token, refresh_token, expires_in, persisted: false }
 *
 * Server-side env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

import { resolveUserId } from "./_telemetryHelpers.js";
import {
  isUuid,
  normalizeClassroomMode,
  upsertClassroomCredentials,
} from "./_classroomCredentials.js";

export const CLASSROOM_CALLBACK_PATH = "/auth/classroom/callback";

/**
 * Valida redirect_uri del cliente (anti open-redirect).
 * @param {string} redirectUri
 * @param {{ headers?: Record<string, string|string[]|undefined> }} req
 */
export function isAllowedClassroomRedirectUri(redirectUri, req = {}) {
  let u;
  try {
    u = new URL(String(redirectUri || ""));
  } catch {
    return false;
  }
  if (u.pathname !== CLASSROOM_CALLBACK_PATH) return false;
  if (u.search || u.hash) return false;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;

  const host = String(u.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }

  if (u.protocol !== "https:") return false;

  const headers = req.headers || {};
  const rawHost = String(headers["x-forwarded-host"] || headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const reqHost = rawHost.replace(/:\d+$/, "");
  if (!reqHost) return false;
  return host === reqHost;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const supabaseToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const body = req.body || {};
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const redirectUri =
    typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  const mode = normalizeClassroomMode(body.mode);
  const orgId = typeof body.org_id === "string" ? body.org_id.trim() : "";

  if (!supabaseToken || !code || !redirectUri) {
    return res.status(400).json({ error: "missing_params" });
  }

  if (!isAllowedClassroomRedirectUri(redirectUri, req)) {
    return res.status(400).json({ error: "invalid_redirect_uri" });
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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "google_not_configured" });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const googleRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await googleRes.json().catch(() => ({}));
  if (!googleRes.ok) {
    return res.status(400).json({ error: data.error || "google_exchange_failed" });
  }

  if (!data.access_token) {
    return res.status(400).json({ error: "missing_access_token" });
  }

  const expiresIn = data.expires_in ?? 3600;
  const refreshToken = data.refresh_token || null;

  // P5/P16: persist server-side when org_id + refresh_token available.
  if (refreshToken && isUuid(orgId)) {
    const saved = await upsertClassroomCredentials({
      userId,
      orgId,
      mode,
      refreshToken,
      expiresIn,
    });
    if (saved.ok) {
      return res.status(200).json({
        access_token: data.access_token,
        expires_in: expiresIn,
        persisted: true,
        org_id: orgId,
        mode,
      });
    }
    // Vault not applied yet → legacy response with refresh_token for dual-path.
    if (!saved.vaultUnavailable) {
      return res.status(500).json({ error: saved.error || "persist_failed" });
    }
  }

  return res.status(200).json({
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    persisted: false,
    org_id: isUuid(orgId) ? orgId : null,
    mode,
  });
}
