/**
 * Contexto institucional de Classroom (P5).
 * Tokens Google siguen globales por usuario PyBot hasta migración org-scoped.
 * Este módulo garantiza destino de importación y hints de colegio, sin romper P4.
 */

export const CLASSROOM_ORG_HINT_KEY = "pybot_classroom_org_hint";

/**
 * @param {unknown} orgId
 * @param {Array<{ id?: string }|string>} staffOrgs
 * @returns {boolean}
 */
export function isStaffOrgId(orgId, staffOrgs = []) {
  const id = typeof orgId === "string" ? orgId.trim() : "";
  if (!id) return false;
  const ids = (staffOrgs || []).map((o) => (typeof o === "string" ? o : o?.id)).filter(Boolean);
  return ids.includes(id);
}

/**
 * Org efectiva para importar. Nunca inventa un colegio distinto al seleccionado.
 * Si selected no es staff válido → "".
 * @param {{ selectedOrgId?: string|null, staffOrgs?: Array<{id?: string}|string> }} args
 */
export function resolveImportOrgId({ selectedOrgId = "", staffOrgs = [] } = {}) {
  const selected = typeof selectedOrgId === "string" ? selectedOrgId.trim() : "";
  if (!selected) return "";
  return isStaffOrgId(selected, staffOrgs) ? selected : "";
}

/**
 * Inicialización del selector: preferida → hint → único colegio → vacío (forzar elección).
 * No usa staffOrgs[0] cuando hay varios colegios.
 * @param {{
 *   preferredOrgId?: string|null,
 *   lastHintOrgId?: string|null,
 *   staffOrgs?: Array<{id?: string}|string>,
 * }} args
 */
export function pickInitialClassroomOrgId({
  preferredOrgId = null,
  lastHintOrgId = null,
  staffOrgs = [],
} = {}) {
  const ids = (staffOrgs || []).map((o) => (typeof o === "string" ? o : o?.id)).filter(Boolean);
  if (ids.length === 0) return "";
  if (preferredOrgId && ids.includes(preferredOrgId)) return preferredOrgId;
  if (lastHintOrgId && ids.includes(lastHintOrgId)) return lastHintOrgId;
  if (ids.length === 1) return ids[0];
  return "";
}

/**
 * @param {string} orgId
 * @param {{ setItem?: Function }} [storage=localStorage]
 */
export function saveClassroomOrgHint(orgId, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return;
  const id = typeof orgId === "string" ? orgId.trim() : "";
  try {
    if (!id) storage.removeItem(CLASSROOM_ORG_HINT_KEY);
    else storage.setItem(CLASSROOM_ORG_HINT_KEY, id);
  } catch {
    //
  }
}

/**
 * @param {{ getItem?: Function }} [storage]
 * @returns {string|null}
 */
export function loadClassroomOrgHint(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return null;
  try {
    const v = storage.getItem(CLASSROOM_ORG_HINT_KEY);
    return v && String(v).trim() ? String(v).trim() : null;
  } catch {
    return null;
  }
}

export function clearClassroomOrgHint(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return;
  try {
    storage.removeItem(CLASSROOM_ORG_HINT_KEY);
  } catch {
    //
  }
}

/**
 * Aviso UX: tokens Classroom son globales por usuario hasta migración por institución.
 * @param {{ selectedOrgId?: string|null, hintOrgId?: string|null }} args
 */
export function classroomOrgAccountNotice({ selectedOrgId = "", hintOrgId = null } = {}) {
  const selected = typeof selectedOrgId === "string" ? selectedOrgId.trim() : "";
  const hint = typeof hintOrgId === "string" ? hintOrgId.trim() : "";
  if (selected && hint && selected !== hint) {
    return {
      kind: "mismatch",
      message:
        "La última conexión de Classroom se asoció a otro colegio. La cuenta Google activa es una sola para todos tus colegios: reconectá si necesitás otra cuenta Google para este colegio.",
    };
  }
  return {
    kind: "global",
  message:
      "Classroom puede usar una cuenta Google distinta por colegio (cuando esté habilitado el vault server-only). El colegio elegido define dónde se importan los cursos y qué credenciales se usan.",
};
}
