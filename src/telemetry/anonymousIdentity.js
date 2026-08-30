const STORAGE_KEY = "pybot_anon_id";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAnonymousId(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

export function createAnonymousId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback sin crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function readLocalAnonymousId() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isValidAnonymousId(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLocalAnonymousId(id) {
  if (!isValidAnonymousId(id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    //
  }
}

/**
 * Resuelve identidad local (prioridad cookie la aplica el servidor;
 * aquí: localStorage → nuevo UUID).
 */
export function resolveLocalAnonymousId() {
  const existing = readLocalAnonymousId();
  if (existing) return existing;
  const id = createAnonymousId();
  writeLocalAnonymousId(id);
  return id;
}

export { STORAGE_KEY as ANON_STORAGE_KEY };
