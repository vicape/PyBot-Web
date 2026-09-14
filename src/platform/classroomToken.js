/**
 * Access tokens Classroom en memoria, aislados por usuario + modo + org.
 * Nunca reutilizar entre alumnos ni entre teacher/student ni entre colegios.
 *
 * Renovación SOLO vía /api/refresh-classroom-token (nunca GOOGLE_CLIENT_SECRET en browser).
 * P5/P16: el browser NO lee refresh tokens; el server los carga del vault / legacy profiles.
 */

import { getSupabase } from "../supabaseClient.js";

const REFRESH_API = "/api/refresh-classroom-token";

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const tokenCache = new Map();
let authListenerBound = false;

function ensureAuthListener() {
  if (authListenerBound || typeof window === "undefined") return;
  const sb = getSupabase();
  if (!sb) return;
  authListenerBound = true;
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") tokenCache.clear();
  });
}

function normalizeMode(mode) {
  return mode === "student" ? "student" : "teacher";
}

function cacheKey(userId, mode, orgId) {
  const oid = orgId ? String(orgId).trim() : "legacy";
  return `${String(userId || "").trim()}:${normalizeMode(mode)}:${oid}`;
}

/**
 * @param {string} [userId]
 * @param {"teacher"|"student"} [mode]
 * @param {string} [orgId]
 */
export function clearClassroomTokenCache(userId, mode, orgId) {
  ensureAuthListener();
  if (!userId) {
    tokenCache.clear();
    return;
  }
  const uid = String(userId).trim();
  if (mode && orgId) {
    tokenCache.delete(cacheKey(uid, mode, orgId));
    return;
  }
  if (mode) {
    const prefix = `${uid}:${normalizeMode(mode)}:`;
    for (const k of tokenCache.keys()) {
      if (k.startsWith(prefix)) tokenCache.delete(k);
    }
    return;
  }
  const prefix = `${uid}:`;
  for (const k of tokenCache.keys()) {
    if (k.startsWith(prefix)) tokenCache.delete(k);
  }
}

/**
 * Primar access token en memoria (p.ej. tras OAuth Classroom). No persiste.
 */
export function primeClassroomAccessToken(userId, mode, accessToken, expiresInSec, orgId) {
  const uid = String(userId || "").trim();
  const tok = String(accessToken || "").trim();
  if (!uid || !tok) return;
  const m = normalizeMode(mode);
  const expSec = Number(expiresInSec);
  const expiresAt =
    Number.isFinite(expSec) && expSec > 0
      ? Date.now() + Math.max(30, expSec - 60) * 1000
      : Date.now() + 50 * 60 * 1000;
  tokenCache.set(cacheKey(uid, m, orgId), { accessToken: tok, expiresAt });
}

/**
 * Renueva access_token vía server. Preferido: { mode, org_id }.
 * Legacy body refresh_token ya no se usa desde el browser.
 */
async function refreshAccessTokenViaApi({ mode, orgId }) {
  const sb = getSupabase();
  if (!sb) {
    const err = new Error("Supabase no configurado");
    err.code = "supabase_unavailable";
    throw err;
  }
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) {
    const err = new Error(sessionError.message || "session_error");
    err.code = "session_error";
    throw err;
  }
  const supabaseAccess = sessionData?.session?.access_token;
  if (!supabaseAccess) {
    const err = new Error("Sesión PyBot requerida para renovar Classroom");
    err.code = "unauthorized";
    throw err;
  }

  const body = { mode: normalizeMode(mode) };
  if (orgId) body.org_id = String(orgId).trim();

  const res = await fetch(REFRESH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAccess}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(json.error || `token_refresh_${res.status}`);
    const err = new Error(code);
    err.code = code;
    err.status = res.status;
    throw err;
  }
  const accessToken = String(json.access_token || "").trim();
  if (!accessToken) {
    const err = new Error("token_refresh_empty");
    err.code = "token_refresh_empty";
    throw err;
  }
  return {
    accessToken,
    expiresIn: Number(json.expires_in) || 3600,
  };
}

/**
 * @param {string} userId
 * @param {{ mode?: "teacher"|"student", orgId?: string|null }} [opts]
 * @returns {Promise<string|null>}
 */
export async function getValidClassroomToken(userId, opts = {}) {
  ensureAuthListener();
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const mode = normalizeMode(opts?.mode);
  const orgId =
    typeof opts?.orgId === "string" && opts.orgId.trim() ? opts.orgId.trim() : null;

  const key = cacheKey(uid, mode, orgId);
  const cached = tokenCache.get(key);
  if (cached?.accessToken && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  try {
    const { accessToken, expiresIn } = await refreshAccessTokenViaApi({ mode, orgId });
    if (accessToken) {
      primeClassroomAccessToken(uid, mode, accessToken, expiresIn, orgId);
      return accessToken;
    }
  } catch (e) {
    clearClassroomTokenCache(uid, mode, orgId || undefined);
    throw e;
  }

  return null;
}
