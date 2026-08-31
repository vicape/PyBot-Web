import { getSupabase } from "../supabaseClient.js";

export const GOOGLE_BASE_SCOPES = "openid email profile";

export const GOOGLE_CLASSROOM_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  // Necesario para profile.emailAddress en el roster (sin esto no se puede matchear a PyBot)
  "https://www.googleapis.com/auth/classroom.profile.emails",
  // CourseWork + student submissions + grades (punto 4)
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
].join(" ");

/**
 * Login docente: mismos scopes que Classroom (un solo consentimiento Google).
 * Incluye offline + consent para obtener refresh_token.
 */
export function teacherLoginOAuthOptions(redirectTo) {
  return {
    redirectTo,
    scopes: GOOGLE_CLASSROOM_SCOPES,
    queryParams: { prompt: "consent", access_type: "offline" },
  };
}

/** Login alumno: solo identidad (sin Classroom). */
export function studentLoginOAuthOptions(redirectTo) {
  return {
    redirectTo,
    scopes: GOOGLE_BASE_SCOPES,
    queryParams: { prompt: "select_account" },
  };
}

/**
 * Re-autoriza Google con permisos de Classroom (si el docente revocó o expiró el refresh).
 * Tras el callback, volver a /dashboard?tab=classroom
 */
export async function connectGoogleClassroom() {
  const sb = getSupabase();
  if (!sb) return;

  try {
    sessionStorage.setItem("pybot_oauth_next", "/dashboard?tab=classroom");
    sessionStorage.setItem("pybot_oauth_classroom", "1");
  } catch {
    //
  }

  const redirectTo = `${window.location.origin}/auth/callback`;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: teacherLoginOAuthOptions(redirectTo),
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

/** Marca el login docente para guardar tokens de Classroom en el callback. */
export function markTeacherLoginOAuthIntent() {
  try {
    sessionStorage.setItem("pybot_oauth_classroom", "1");
  } catch {
    //
  }
}
