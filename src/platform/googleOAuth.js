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

const OAUTH_EXPECTED_USER_ID = "pybot_oauth_expected_user_id";
const OAUTH_EXPECTED_EMAIL = "pybot_oauth_expected_email";
const OAUTH_CLASSROOM_MODE = "pybot_oauth_classroom_mode";
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
 * OAuth con scopes Classroom.
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
    queryParams: { prompt: "consent", access_type: "offline" },
  };
}

/** @deprecated */
export function teacherLoginOAuthOptions(redirectTo) {
  return classroomOAuthOptions(redirectTo, "teacher");
}

/**
 * Conectar Google Classroom bajo demanda.
 * @param {string} [nextPath]
 * @param {{ mode?: "teacher"|"student" }} [opts]
 */
export async function connectGoogleClassroom(nextPath, opts = {}) {
  const sb = getSupabase();
  if (!sb) return;

  const mode = normalizeMode(opts?.mode);
  const next =
    typeof nextPath === "string" && nextPath.startsWith("/")
      ? nextPath
      : mode === "student"
        ? "/"
        : "/dashboard/classes?panel=classroom";

  const {
    data: { user },
  } = await sb.auth.getUser();

  try {
    sessionStorage.setItem("pybot_oauth_next", next);
    sessionStorage.setItem("pybot_oauth_classroom", "1");
    sessionStorage.setItem(OAUTH_CLASSROOM_MODE, mode);
    if (user?.id) sessionStorage.setItem(OAUTH_EXPECTED_USER_ID, user.id);
    else sessionStorage.removeItem(OAUTH_EXPECTED_USER_ID);
    if (user?.email) sessionStorage.setItem(OAUTH_EXPECTED_EMAIL, String(user.email).toLowerCase());
    else sessionStorage.removeItem(OAUTH_EXPECTED_EMAIL);
  } catch {
    //
  }

  const redirectTo = `${window.location.origin}/auth/callback`;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: classroomOAuthOptions(redirectTo, mode),
  });
}

export function wasClassroomOAuthIntent() {
  try {
    const v = sessionStorage.getItem("pybot_oauth_classroom");
    sessionStorage.removeItem("pybot_oauth_classroom");
    return v === "1";
  } catch {
    return false;
  }
}

/** Lee y limpia el mode Classroom del OAuth (teacher|student). Default teacher. */
export function consumeClassroomOAuthMode() {
  try {
    const v = sessionStorage.getItem(OAUTH_CLASSROOM_MODE);
    sessionStorage.removeItem(OAUTH_CLASSROOM_MODE);
    return normalizeMode(v);
  } catch {
    return "teacher";
  }
}

/** Expectativas de cuenta para validar post-callback. No limpia. */
export function peekClassroomOAuthExpected() {
  try {
    return {
      userId: sessionStorage.getItem(OAUTH_EXPECTED_USER_ID) || null,
      email: sessionStorage.getItem(OAUTH_EXPECTED_EMAIL) || null,
      mode: normalizeMode(sessionStorage.getItem(OAUTH_CLASSROOM_MODE)),
    };
  } catch {
    return { userId: null, email: null, mode: "teacher" };
  }
}

export function clearClassroomOAuthExpected() {
  try {
    sessionStorage.removeItem(OAUTH_EXPECTED_USER_ID);
    sessionStorage.removeItem(OAUTH_EXPECTED_EMAIL);
    sessionStorage.removeItem(OAUTH_CLASSROOM_MODE);
  } catch {
    //
  }
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
  try {
    sessionStorage.setItem("pybot_oauth_classroom", "1");
    sessionStorage.setItem(OAUTH_CLASSROOM_MODE, "teacher");
  } catch {
    //
  }
}
