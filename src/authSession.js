/** Perfil mínimo post-login Google (solo cliente; sesión institucional vendrá después). */

const STORAGE_KEY = "pybot_google_profile";

/**
 * @param {string} credential JWT de Google (GIS)
 * @returns {{ sub: string, email?: string, name?: string, picture?: string } | null}
 */
export function parseGoogleCredential(credential) {
  try {
    const parts = String(credential).split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    return {
      sub: String(payload.sub ?? ""),
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      picture: payload.picture ? String(payload.picture) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} credential
 * @returns {ReturnType<typeof parseGoogleCredential>}
 */
export function saveGoogleProfile(credential) {
  const profile = parseGoogleCredential(credential);
  if (!profile?.sub) return null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function getGoogleProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.sub !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

export function clearGoogleProfile() {
  localStorage.removeItem(STORAGE_KEY);
}
