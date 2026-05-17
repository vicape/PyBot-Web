import { getSupabase } from "../supabaseClient.js";
import { getStoredGoogleRefreshToken, saveGoogleTokens } from "./profileApi.js";

/**
 * Obtiene un access_token de Google Classroom válido para el usuario actual.
 * Solo usa session.provider_token si el usuario ya hizo el OAuth de Classroom
 * (google_token_expires_at guardado en DB). De lo contrario lanza missing_access_token.
 */
export async function getValidClassroomToken(userId) {
  const sb = getSupabase();
  if (!sb || !userId) throw Object.assign(new Error("no_session"), { code: "no_session" });

  // Leer estado de Classroom desde DB
  const stored = await getStoredGoogleRefreshToken(userId);

  // Si no hay refresh_token NI expires_at NI classroom_linked_at → usuario nunca conectó Classroom
  const hasConnected = !!(
    stored?.google_refresh_token ||
    stored?.google_token_expires_at ||
    stored?.classroom_linked_at
  );
  if (!hasConnected) {
    throw Object.assign(
      new Error("No hay token de Classroom. Hacé clic en «Conectar Google Classroom»."),
      { code: "missing_access_token" },
    );
  }

  // Verificar si el token de sesión es válido (no expirado)
  const {
    data: { session },
  } = await sb.auth.getSession();

  const expiresAt = stored?.google_token_expires_at
    ? new Date(stored.google_token_expires_at)
    : null;
  // Si no tenemos expires_at (migración no corrida), usar session.provider_token directamente
  const isExpired = expiresAt ? expiresAt <= new Date(Date.now() + 120_000) : false;

  if (!isExpired && session?.provider_token) {
    return session.provider_token;
  }

  // Renovar con refresh_token guardado en DB
  if (!stored?.google_refresh_token) {
    throw Object.assign(
      new Error("Token expirado. Reconectá Google Classroom desde el panel."),
      { code: "missing_access_token" },
    );
  }

  const supabaseToken = session?.access_token;
  if (!supabaseToken) {
    throw Object.assign(new Error("Sesión expirada. Volvé a iniciar sesión."), {
      code: "no_session",
    });
  }

  const res = await fetch("/api/refresh-classroom-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseToken}`,
    },
    body: JSON.stringify({ refresh_token: stored.google_refresh_token }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data.error === "google_not_configured" && session?.provider_token) {
      // Vercel API no configurada aún: usar token de sesión como fallback
      return session.provider_token;
    }
    throw Object.assign(
      new Error("Token de Classroom expirado. Reconectá desde el panel → Classroom."),
      { code: "token_refresh_failed", status: 403 },
    );
  }

  await saveGoogleTokens(userId, {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  });

  return data.access_token;
}
