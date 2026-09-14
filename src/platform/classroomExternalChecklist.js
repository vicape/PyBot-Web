/**
 * P17 — Separación código vs configuración externa (Google / Workspace).
 *
 * Lo resuelto EN CÓDIGO (repo):
 * - OAuth Classroom dedicado (`/auth/classroom/callback`), separado del login PyBot
 * - Client ID público vía VITE_GOOGLE_CLIENT_ID; secret solo server-side
 * - State CSRF + TTL; exchange/refresh/disconnect en APIs Vercel
 * - Tokens refresh server-only (vault) cuando migración 45 está aplicada
 *
 * Lo que queda EXTERNO (humano / Google Cloud / Workspace) — NO está “completo” en código:
 * - Registrar redirect URI Classroom en Google Cloud Console
 * - OAuth Verification / scopes sensibles si Google lo exige
 * - Workspace Admin: permitir app / Classroom API para el dominio
 * - Aplicar migraciones Supabase 45/46/47 en el proyecto cloud
 * - Variables Vercel: SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_SECRET, etc.
 */

export const CLASSROOM_CODE_RESOLVED = Object.freeze([
  "dedicated_classroom_oauth_callback",
  "no_vite_google_client_secret",
  "csrf_state_and_ttl",
  "server_exchange_refresh_disconnect_apis",
  "pybot_identity_separated_from_classroom",
]);

export const CLASSROOM_EXTERNAL_PENDING = Object.freeze([
  {
    id: "google_redirect_uri",
    label: "Redirect URI Classroom en Google Cloud Console",
    example: "https://<host>/auth/classroom/callback",
  },
  {
    id: "oauth_verification",
    label: "OAuth Verification / scopes sensibles (si Google lo requiere)",
  },
  {
    id: "workspace_admin",
    label: "Workspace Admin: app + Classroom API habilitados para el dominio",
  },
  {
    id: "supabase_migrations_45_46_47",
    label: "Aplicar migraciones 45/46/47 en Supabase (revisión humana)",
  },
  {
    id: "vercel_secrets",
    label: "Secrets Vercel: SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID/SECRET",
  },
]);

/** P17 nunca se considera “completo” solo por código. */
export function isClassroomExternalSetupComplete() {
  return false;
}

export function classroomP17Status() {
  return {
    codeResolved: [...CLASSROOM_CODE_RESOLVED],
    externalPending: CLASSROOM_EXTERNAL_PENDING.map((x) => x.id),
    complete: false,
  };
}
