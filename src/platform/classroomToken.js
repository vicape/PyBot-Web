/**
 * Access tokens Classroom en memoria, aislados por usuario + modo.
 * Nunca reutilizar entre alumnos ni entre teacher/student.
 *
 * La renovación del access_token se hace SOLO vía /api/refresh-classroom-token
 * (GOOGLE_CLIENT_SECRET nunca en el browser).
 */

import { getSupabase } from "../supabaseClient.js";
import {
  getStoredGoogleRefreshToken,
  getStoredStudentGoogleRefreshToken,
} from "./profileApi.js";

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

function cacheKey(userId, mode) {
  return `${String(userId || "").trim()}:${mode === "student" ? "student" : "teacher"}`;
}

function normalizeMode(mode) {
  return mode === "student" ? "student" : "teacher";
}

/**
 * @param {string} [userId]
 * @param {"teacher"|"student"} [mode]
 */
export function clearClassroomTokenCache(userId, mode) {
  ensureAuthListener();
  if (!userId) {
    tokenCache.clear();
    return;
  }
  const uid = String(userId).trim();
  if (mode) {
    tokenCache.delete(cacheKey(uid, normalizeMode(mode)));
    return;
  }
  tokenCache.delete(cacheKey(uid, "teacher"));
  tokenCache.delete(cacheKey(uid, "student"));
}

/**
 * Primar access token en memoria (p.ej. tras OAuth Classroom). No persiste.
 * @param {string} userId
 * @param {"teacher"|"student"} mode
 * @param {string} accessToken
 * @param {number} [expiresInSec]
 */
export function primeClassroomAccessToken(userId, mode, accessToken, expiresInSec) {
  const uid = String(userId || "").trim();
  const tok = String(accessToken || "").trim();
  if (!uid || !tok) return;
  const m = normalizeMode(mode);
  const expSec = Number(expiresInSec);
  const expiresAt =
    Number.isFinite(expSec) && expSec > 0
      ? Date.now() + Math.max(30, expSec - 60) * 1000
      : Date.now() + 50 * 60 * 1000;
  tokenCache.set(cacheKey(uid, m), { accessToken: tok, expiresAt });
}

/**
 * Renueva el access_token vía endpoint server-side (nunca llama a Google
 * con client_secret desde el browser).
 * @param {string} refreshToken
 */
async function refreshAccessToken(refreshToken) {
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

  const res = await fetch(REFRESH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAccess}`,
    },
    body: JSON.stringify({ refresh_token: String(refreshToken) }),
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
 * @param {{ mode?: "teacher"|"student" }} [opts]
 * @returns {Promise<string|null>}
 */
export async function getValidClassroomToken(userId, opts = {}) {
  ensureAuthListener();
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const mode = normalizeMode(opts?.mode);

  const key = cacheKey(uid, mode);
  const cached = tokenCache.get(key);
  if (cached?.accessToken && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  let refreshToken = null;
  if (mode === "student") {
    refreshToken = await getStoredStudentGoogleRefreshToken(uid);
  } else {
    const stored = await getStoredGoogleRefreshToken(uid);
    refreshToken =
      typeof stored === "string" ? stored : stored?.google_refresh_token || null;
  }
  refreshToken = refreshToken ? String(refreshToken).trim() : null;

  if (refreshToken) {
    try {
      const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);
      if (accessToken) {
        primeClassroomAccessToken(uid, mode, accessToken, expiresIn);
        return accessToken;
      }
    } catch (e) {
      clearClassroomTokenCache(uid, mode);
      throw e;
    }
  }

  // No usar session.provider_token del login normal (scopes openid/email/profile).
  return null;
}
