/**
 * Access tokens Classroom en memoria, aislados por usuario + modo.
 * Nunca reutilizar entre alumnos ni entre teacher/student.
 */

import { getSupabase } from "../supabaseClient.js";
import {
  getStoredGoogleRefreshToken,
  getStoredStudentGoogleRefreshToken,
} from "./profileApi.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
const CLIENT_SECRET = String(import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "").trim();

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

async function refreshAccessToken(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const err = new Error("Faltan VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET");
    err.code = "missing_oauth_client";
    throw err;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: String(refreshToken),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `token_refresh_${res.status}`);
    err.code = json.error || "token_refresh_failed";
    err.status = res.status;
    throw err;
  }
  return {
    accessToken: String(json.access_token || ""),
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
