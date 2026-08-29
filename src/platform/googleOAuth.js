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
].join(" ");

/**
 * Re-autoriza Google con permisos de Classroom (docentes).
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
    options: {
      redirectTo,
      scopes: GOOGLE_CLASSROOM_SCOPES,
      queryParams: { prompt: "consent", access_type: "offline" },
    },
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
