import { getSupabase } from "../supabaseClient.js";
import { getStoredGoogleRefreshToken, saveGoogleTokens } from "./profileApi.js";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const CACHE_BUFFER_MS = 120_000;

/** Limpia el access_token renovado en memoria (p. ej. al reconectar Classroom). */
export function clearClassroomTokenCache() {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
}

/**
 * Obtiene un access_token de Google Classroom válido para el usuario actual.
 * Solo usa session.provider_token si el usuario ya hizo el OAuth de Classroom
 * (google_token_expires_at guardado en DB). De lo contrario lanza missing_access_token.
 */
export async function getValidClassroomToken(userId) {
  const sb = getSupabase();
  if (!sb || !userId) throw Object.assign(new Error("no_session"), { code: "no_session" });

  const stored = await getStoredGoogleRefreshToken(userId);

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

  // Token renovado en memoria: no volver a session.provider_token (OAuth original)
  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + CACHE_BUFFER_MS) {
    return cachedAccessToken;
  }

  const {
    data: { session },
  } = await sb.auth.getSession();

  const expiresAt = stored?.google_token_expires_at
    ? new Date(stored.google_token_expires_at)
    : null;
  const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() + CACHE_BUFFER_MS : false;

  // provider_token solo si sigue vigente según DB y no hay token renovado en caché
  if (!isExpired && session?.provider_token) {
    return session.provider_token;
  }

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
      return session.provider_token;
    }
    if (data.error === "invalid_grant") {
      clearClassroomTokenCache();
      throw Object.assign(
        new Error("La conexión con Google Classroom venció. Reconectá desde el panel → Classroom."),
        { code: "invalid_grant", status: res.status },
      );
    }
    throw Object.assign(
      new Error(
        data.error
          ? `Error al renovar token de Classroom: ${data.error}`
          : "Token de Classroom expirado. Reconectá desde el panel → Classroom.",
      ),
      { code: "token_refresh_failed", status: res.status, googleError: data.error },
    );
  }

  const newAccessToken = data.access_token;
  const expiresIn = data.expires_in ?? 3600;

  cachedAccessToken = newAccessToken;
  cachedAccessTokenExpiresAt = Date.now() + expiresIn * 1000;

  await saveGoogleTokens(userId, { expiresIn });

  return cachedAccessToken;
}
