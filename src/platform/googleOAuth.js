import { getSupabase } from "../supabaseClient.js";

export const GOOGLE_BASE_SCOPES = "openid email profile";

export const GOOGLE_CLASSROOM_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
  // Alumno: entregar (turnIn) y leer su propia StudentSubmission
  "https://www.googleapis.com/auth/classroom.coursework.me",
].join(" ");

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

/** OAuth con scopes Classroom (solo al conectar explícitamente). */
export function classroomOAuthOptions(redirectTo) {
  return {
    redirectTo,
    scopes: GOOGLE_CLASSROOM_SCOPES,
    queryParams: { prompt: "consent", access_type: "offline" },
  };
}

/** @deprecated */
export function teacherLoginOAuthOptions(redirectTo) {
  return classroomOAuthOptions(redirectTo);
}

/**
 * Conectar Google Classroom bajo demanda.
 * Usá la misma cuenta Google con la que ingresaste a PyBotClass.
 * @param {string} [nextPath] ruta post-OAuth (default panel Classroom)
 */
export async function connectGoogleClassroom(nextPath) {
  const sb = getSupabase();
  if (!sb) return;

  const next =
    typeof nextPath === "string" && nextPath.startsWith("/")
      ? nextPath
      : "/dashboard/classes?panel=classroom";

  try {
    sessionStorage.setItem("pybot_oauth_next", next);
    sessionStorage.setItem("pybot_oauth_classroom", "1");
  } catch {
    //
  }

  const redirectTo = `${window.location.origin}/auth/callback`;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: classroomOAuthOptions(redirectTo),
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

/** @deprecated Ya no se usa en login. */
export function markTeacherLoginOAuthIntent() {
  try {
    sessionStorage.setItem("pybot_oauth_classroom", "1");
  } catch {
    //
  }
}
