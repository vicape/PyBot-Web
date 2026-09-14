import { getSupabase } from "../supabaseClient.js";

export const GOOGLE_BASE_SCOPES = "openid email profile";

/** Scopes Classroom docente (implementación actual). */
export const GOOGLE_CLASSROOM_TEACHER_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
].join(" ");

/** Scopes Classroom alumno: solo turnIn / coursework.me. */
export const GOOGLE_CLASSROOM_STUDENT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.coursework.me",
].join(" ");

/** @deprecated Preferir GOOGLE_CLASSROOM_TEACHER_SCOPES / STUDENT. */
export const GOOGLE_CLASSROOM_SCOPES = GOOGLE_CLASSROOM_TEACHER_SCOPES;

export const CLASSROOM_OAUTH_CALLBACK_PATH = "/auth/classroom/callback";
export const CLASSROOM_OAUTH_FLOW_KEY = "pybot_classroom_oauth_flow";
export const CLASSROOM_OAUTH_TTL_MS = 10 * 60 * 1000;
export const EXCHANGE_CLASSROOM_CODE_API = "/api/exchange-classroom-code";

const PENDING_TURNIN_KEY = "pybot_pending_classroom_turnin";
const PENDING_TURNIN_TTL_MS = 10 * 60 * 1000;

function normalizeMode(mode) {
  return mode === "student" ? "student" : "teacher";
}

/** Login normal: solo identidad Google (sin Classroom). */
export function baseLoginOAuthOptions(redirectTo) {
  return {
    redirectTo,
    scopes: GOOGLE_BASE_SCOPES,
    queryParams: { prompt: "select_account" },
  };
}

/** @deprecated Usar baseLoginOAuthOptions para login. */
export function studentLoginOAuthOptions(redirectTo) {
  return baseLoginOAuthOptions(redirectTo);
}

/**
 * Opciones legacy (documentación / tests). Classroom ya no usa Supabase OAuth.
 * @param {string} redirectTo
 * @param {"teacher"|"student"} [mode="teacher"]
 */
export function classroomOAuthOptions(redirectTo, mode = "teacher") {
  const scopes =
    normalizeMode(mode) === "student"
      ? GOOGLE_CLASSROOM_STUDENT_SCOPES
      : GOOGLE_CLASSROOM_TEACHER_SCOPES;
  return {
    redirectTo,
    scopes,
    queryParams: { prompt: "consent select_account", access_type: "offline" },
  };
}

/** @deprecated */
export function teacherLoginOAuthOptions(redirectTo) {
  return classroomOAuthOptions(redirectTo, "teacher");
}

/** Valor aleatorio criptográficamente seguro para OAuth `state`. Sin Web Crypto: error. */
export function createClassroomOAuthState() {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("web_crypto_unavailable");
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getClassroomRedirectUri(origin = typeof window !== "undefined" ? window.location.origin : "") {
  return `${String(origin || "").replace(/\/$/, "")}${CLASSROOM_OAUTH_CALLBACK_PATH}`;
}

export function scopesForClassroomMode(mode = "teacher") {
  return normalizeMode(mode) === "student"
    ? GOOGLE_CLASSROOM_STUDENT_SCOPES
    : GOOGLE_CLASSROOM_TEACHER_SCOPES;
}

/**
 * @param {{ clientId: string, redirectUri: string, scopes: string, state: string }} args
 */
export function buildClassroomAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  const params = new URLSearchParams({
    client_id: String(clientId || ""),
    redirect_uri: String(redirectUri || ""),
    response_type: "code",
    scope: String(scopes || ""),
    access_type: "offline",
    prompt: "consent select_account",
    state: String(state || ""),
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * @param {{
 *   state: string,
 *   initiatingPybotUserId: string,
 *   mode: "teacher"|"student",
 *   nextPath: string,
 *   createdAt: number,
 *   orgId?: string|null,
 * }} flow
 */
export function saveClassroomOAuthFlow(flow) {
  try {
    const orgId =
      typeof flow.orgId === "string" && flow.orgId.trim() ? flow.orgId.trim() : null;
    sessionStorage.setItem(
      CLASSROOM_OAUTH_FLOW_KEY,
      JSON.stringify({
        state: String(flow.state || ""),
        initiatingPybotUserId: String(flow.initiatingPybotUserId || ""),
        mode: normalizeMode(flow.mode),
        nextPath: String(flow.nextPath || ""),
        createdAt: Number(flow.createdAt) || Date.now(),
        orgId,
      }),
    );
  } catch {
    //
  }
}

/** @returns {null | { state: string, initiatingPybotUserId: string, mode: "teacher"|"student", nextPath: string, createdAt: number, orgId: string|null }} */
export function loadClassroomOAuthFlow() {
  try {
    const raw = sessionStorage.getItem(CLASSROOM_OAUTH_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.state || !parsed?.initiatingPybotUserId) return null;
    return {
      state: String(parsed.state),
      initiatingPybotUserId: String(parsed.initiatingPybotUserId),
      mode: normalizeMode(parsed.mode),
      nextPath: String(parsed.nextPath || ""),
      createdAt: Number(parsed.createdAt) || 0,
      orgId:
        typeof parsed.orgId === "string" && parsed.orgId.trim()
          ? parsed.orgId.trim()
          : null,
    };
  } catch {
    return null;
  }
}

export function clearClassroomOAuthFlow() {
  try {
    sessionStorage.removeItem(CLASSROOM_OAUTH_FLOW_KEY);
  } catch {
    //
  }
}

/**
 * Valida state CSRF + TTL del flujo Classroom.
 * @param {ReturnType<typeof loadClassroomOAuthFlow>} stored
 * @param {string|null} returnedState
 * @param {number} [now=Date.now()]
 * @param {number} [ttlMs=CLASSROOM_OAUTH_TTL_MS]
 * @returns {{ ok: true, flow: object } | { ok: false, code: string }}
 */
export function validateClassroomOAuthFlow(stored, returnedState, now = Date.now(), ttlMs = CLASSROOM_OAUTH_TTL_MS) {
  if (!stored?.state || !stored?.initiatingPybotUserId) {
    return { ok: false, code: "missing_flow" };
  }
  if (!returnedState || typeof returnedState !== "string") {
    return { ok: false, code: "missing_state" };
  }
  if (returnedState !== stored.state) {
    return { ok: false, code: "state_mismatch" };
  }
  const age = now - Number(stored.createdAt || 0);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) {
    return { ok: false, code: "flow_expired" };
  }
  return { ok: true, flow: stored };
}

/**
 * Tras fallo de validación de state: ¿borrar el flujo en sessionStorage?
 * state_mismatch / missing_state: no (callback no autenticado no destruye el flujo legítimo).
 * flow_expired / missing_flow: sí.
 * @param {{ ok?: boolean, code?: string }} validationResult
 */
export function shouldClearClassroomOAuthFlow(validationResult) {
  if (!validationResult || validationResult.ok) return false;
  return (
    validationResult.code === "flow_expired" || validationResult.code === "missing_flow"
  );
}

/**
 * Conectar Google Classroom bajo demanda (OAuth Google directo; no Supabase OAuth).
 * @param {string} [nextPath]
 * @param {{ mode?: "teacher"|"student", orgId?: string|null }} [opts]
 */
export async function connectGoogleClassroom(nextPath, opts = {}) {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "no_supabase" };

  const mode = normalizeMode(opts?.mode);
  const orgId =
    typeof opts?.orgId === "string" && opts.orgId.trim() ? opts.orgId.trim() : null;
  const next =
    typeof nextPath === "string" && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : mode === "student"
        ? "/"
        : "/dashboard/classes?panel=classroom";

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) {
    return { ok: false, error: "not_authenticated" };
  }

  const clientId =
    typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string"
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
      : "";
  if (!clientId) {
    return { ok: false, error: "missing_client_id" };
  }

  let state;
  try {
    state = createClassroomOAuthState();
  } catch {
    return { ok: false, error: "web_crypto_unavailable" };
  }

  const redirectUri = getClassroomRedirectUri();
  const scopes = scopesForClassroomMode(mode);

  saveClassroomOAuthFlow({
    state,
    initiatingPybotUserId: user.id,
    mode,
    nextPath: next,
    createdAt: Date.now(),
    orgId,
  });

  const url = buildClassroomAuthorizeUrl({ clientId, redirectUri, scopes, state });
  window.location.assign(url);
  return { ok: true };
}

/**
 * Intercambia authorization code por tokens vía backend (Bearer Supabase).
 * @param {{ code: string, redirectUri: string, accessToken: string, mode?: string, orgId?: string|null }} args
 */
export async function exchangeClassroomAuthorizationCode({
  code,
  redirectUri,
  accessToken,
  mode,
  orgId,
}) {
  const body = {
    code: String(code || ""),
    redirect_uri: String(redirectUri || ""),
    mode: mode === "student" ? "student" : "teacher",
  };
  if (typeof orgId === "string" && orgId.trim()) body.org_id = orgId.trim();

  const res = await fetch(EXCHANGE_CLASSROOM_CODE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || "exchange_failed",
      status: res.status,
    };
  }
  return {
    ok: true,
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
    persisted: !!data.persisted,
    org_id: data.org_id || body.org_id || null,
    mode: data.mode || body.mode,
    source: data.source || null,
  };
}

/** @deprecated Classroom ya no usa el callback de login Supabase. */
export function wasClassroomOAuthIntent() {
  return false;
}

/** @deprecated */
export function consumeClassroomOAuthMode() {
  return "teacher";
}

/** @deprecated */
export function peekClassroomOAuthExpected() {
  return { userId: null, email: null, mode: "teacher" };
}

/** @deprecated */
export function clearClassroomOAuthExpected() {
  // no-op: flujo Classroom migrado a CLASSROOM_OAUTH_FLOW_KEY
}

/**
 * @param {{ activityId: string, userId: string, returnPath: string }} payload
 */
export function setPendingClassroomTurnIn(payload) {
  try {
    sessionStorage.setItem(
      PENDING_TURNIN_KEY,
      JSON.stringify({
        activityId: String(payload.activityId || ""),
        userId: String(payload.userId || ""),
        returnPath: String(payload.returnPath || ""),
        createdAt: Date.now(),
      }),
    );
  } catch {
    //
  }
}

export function getPendingClassroomTurnIn() {
  try {
    const raw = sessionStorage.getItem(PENDING_TURNIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.activityId || !parsed?.userId) {
      sessionStorage.removeItem(PENDING_TURNIN_KEY);
      return null;
    }
    const age = Date.now() - Number(parsed.createdAt || 0);
    if (!Number.isFinite(age) || age > PENDING_TURNIN_TTL_MS) {
      sessionStorage.removeItem(PENDING_TURNIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingClassroomTurnIn() {
  try {
    sessionStorage.removeItem(PENDING_TURNIN_KEY);
  } catch {
    //
  }
}

/** @deprecated Ya no se usa en login. */
export function markTeacherLoginOAuthIntent() {
  // no-op
}
