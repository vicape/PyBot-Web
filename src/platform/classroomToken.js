import { getSupabase } from "../supabaseClient.js";
import { getStoredGoogleRefreshToken, saveGoogleTokens } from "./profileApi.js";

/**
 * Obtiene un access_token de Google Classroom válido para el usuario actual.
 * Orden de prioridad:
 *   1. provider_token de la sesión actual (si no expiró)
 *   2. Token renovado vía /api/refresh-classroom-token usando el refresh_token guardado en DB
 * Lanza error si no puede obtener un token válido.
 */
export async function getValidClassroomToken(userId) {
  const sb = getSupabase();
  if (!sb || !userId) throw Object.assign(new Error("no_session"), { code: "no_session" });

  const {
    data: { session },
  } = await sb.auth.getSession();

  // 1. Usar token de sesión si todavía está fresco (guardamos expiresAt en DB al conectar)
  if (session?.provider_token) {
    const stored = await getStoredGoogleRefreshToken(userId);
    const expiresAt = stored?.google_token_expires_at
      ? new Date(stored.google_token_expires_at)
      : null;
    const isExpired = expiresAt ? expiresAt <= new Date(Date.now() + 60_000) : false;

    if (!isExpired) {
      return session.provider_token;
    }
  }

  // 2. Renovar con refresh_token guardado en DB
  const stored = await getStoredGoogleRefreshToken(userId);
  if (!stored?.google_refresh_token) {
    throw Object.assign(
      new Error("No hay token de Classroom. Hacé clic en «Conectar Google Classroom»."),
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
    if (data.error === "google_not_configured") {
      // Fallback: env vars no configuradas en Vercel, intentar con session token igualmente
      if (session?.provider_token) return session.provider_token;
    }
    throw Object.assign(
      new Error("Token de Classroom expirado. Reconectá desde el panel → Classroom."),
      { code: "token_refresh_failed", status: 403 },
    );
  }

  // Guardar el nuevo access_token y su expiración
  await saveGoogleTokens(userId, {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  });

  return data.access_token;
}
