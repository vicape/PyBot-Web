import { isStaffRole } from "../orgRole.js";

/** Modo de acceso explícito al curso (no rol global). */
export const COURSE_ACCESS_MODES = Object.freeze({
  TEACHING: "teaching",
  STUDYING: "studying",
  ADMIN: "admin",
  NONE: "none",
});

/** Claves de etiqueta contextual (presentación; no autorizan). */
export const COURSE_DISPLAY_ROLES = Object.freeze({
  TEACHER: "teacher",
  CO_TEACHER: "co_teacher",
  STUDENT: "student",
  SUPERADMIN: "superadmin",
});

const TEACHING_TAB_IDS = Object.freeze([
  "resumen",
  "actividades",
  "alumnos",
  "entregas",
  "notas",
  "integraciones",
]);
const STUDYING_TAB_IDS = Object.freeze(["resumen", "actividades", "notas"]);
const ADMIN_TAB_IDS = Object.freeze(["resumen", "actividades"]);

/**
 * Rol efectivo en un curso (no rol institucional).
 * owner (acceso staff vía org) → teacher; desconocido → null (nunca student).
 * @param {unknown} role
 * @returns {"teacher"|"student"|null}
 */
export function normalizeCourseRole(role) {
  if (role === "owner" || role === "teacher") return "teacher";
  if (role === "student") return "student";
  return null;
}

/** @param {{ isSuperAdmin?: boolean }} opts */
export function canManagePlatform({ isSuperAdmin = false } = {}) {
  return isSuperAdmin === true;
}

/** @param {{ orgRole?: string | null }} opts */
export function canManageOrganization({ orgRole = null } = {}) {
  return orgRole === "owner";
}

/**
 * Capacidades docentes sobre un curso concreto.
 * @param {{ orgRole?: string | null, courseRole?: string | null }} opts
 */
export function canTeachCourse({ orgRole = null, courseRole = null } = {}) {
  return isStaffRole(orgRole) || normalizeCourseRole(courseRole) === "teacher";
}

/**
 * ¿Es alumno inscrito en el curso? (no co-docente)
 * @param {{ courseRole?: string | null }} opts
 */
export function isCourseStudent({ courseRole = null } = {}) {
  return normalizeCourseRole(courseRole) === "student";
}

/** @param {{ courseRole?: string | null }} opts */
export function canStudyCourse({ courseRole = null } = {}) {
  return isCourseStudent({ courseRole });
}

/** @param {{ orgRole?: string | null, courseRole?: string | null }} opts */
export function canGradeCourse({ orgRole = null, courseRole = null } = {}) {
  return canTeachCourse({ orgRole, courseRole });
}

/** @param {{ orgRole?: string | null, courseRole?: string | null }} opts */
export function canManageRoster({ orgRole = null, courseRole = null } = {}) {
  return canTeachCourse({ orgRole, courseRole });
}

/**
 * Resolvedor contextual único: etiqueta de display + modo de acceso + capacidades.
 * No persiste rol; preferredRole se ignora (preferencia, no permiso).
 * Superadmin no se mapea automáticamente a Docente/Alumno.
 *
 * @param {{
 *   orgRole?: string | null,
 *   courseRole?: string | null,
 *   isSuperAdmin?: boolean,
 *   preferredRole?: string | null,
 * }} opts
 * @returns {{
 *   mode: "teaching"|"studying"|"admin"|"none",
 *   displayRole: "teacher"|"co_teacher"|"student"|"superadmin"|null,
 *   capabilities: {
 *     canManagePlatform: boolean,
 *     canManageOrganization: boolean,
 *     canTeachCourse: boolean,
 *     canStudyCourse: boolean,
 *     canGradeCourse: boolean,
 *     canManageRoster: boolean,
 *   },
 * }}
 */
export function resolveCourseContext({
  orgRole = null,
  courseRole = null,
  isSuperAdmin = false,
  preferredRole = null,
} = {}) {
  void preferredRole;

  const capabilities = {
    canManagePlatform: canManagePlatform({ isSuperAdmin }),
    canManageOrganization: canManageOrganization({ orgRole }),
    canTeachCourse: canTeachCourse({ orgRole, courseRole }),
    canStudyCourse: canStudyCourse({ courseRole }),
    canGradeCourse: canGradeCourse({ orgRole, courseRole }),
    canManageRoster: canManageRoster({ orgRole, courseRole }),
  };

  const orgStaff = isStaffRole(orgRole);
  const normalized = normalizeCourseRole(courseRole);

  let mode = COURSE_ACCESS_MODES.NONE;
  let displayRole = null;

  if (orgStaff) {
    // owner u org-teacher → Docente / teaching (prioridad pedagógica)
    mode = COURSE_ACCESS_MODES.TEACHING;
    displayRole = COURSE_DISPLAY_ROLES.TEACHER;
  } else if (normalized === "teacher") {
    // course teacher sin staff de org → Co-docente / teaching
    mode = COURSE_ACCESS_MODES.TEACHING;
    displayRole = COURSE_DISPLAY_ROLES.CO_TEACHER;
  } else if (normalized === "student") {
    // student (también con superadmin) → Alumno / studying
    mode = COURSE_ACCESS_MODES.STUDYING;
    displayRole = COURSE_DISPLAY_ROLES.STUDENT;
  } else if (isSuperAdmin === true) {
    // superadmin sin rol pedagógico → Superadmin / admin (neutro)
    mode = COURSE_ACCESS_MODES.ADMIN;
    displayRole = COURSE_DISPLAY_ROLES.SUPERADMIN;
  } else {
    mode = COURSE_ACCESS_MODES.NONE;
    displayRole = null;
  }

  return { mode, displayRole, capabilities };
}

/**
 * Ids de pestaña según modo (sin fallback binario not-teacher→student).
 * @param {"teaching"|"studying"|"admin"|"none"} mode
 * @returns {readonly string[]}
 */
export function courseTabIdsForMode(mode) {
  switch (mode) {
    case COURSE_ACCESS_MODES.TEACHING:
      return TEACHING_TAB_IDS;
    case COURSE_ACCESS_MODES.STUDYING:
      return STUDYING_TAB_IDS;
    case COURSE_ACCESS_MODES.ADMIN:
      return ADMIN_TAB_IDS;
    default:
      return Object.freeze([]);
  }
}

/**
 * Clave i18n de la etiqueta de display (presentación).
 * @param {"teacher"|"co_teacher"|"student"|"superadmin"|null|undefined} displayRole
 * @returns {string|null}
 */
export function courseDisplayRoleI18nKey(displayRole) {
  switch (displayRole) {
    case COURSE_DISPLAY_ROLES.TEACHER:
      return "pcTeacher";
    case COURSE_DISPLAY_ROLES.CO_TEACHER:
      return "pcCoTeacher";
    case COURSE_DISPLAY_ROLES.STUDENT:
      return "pcStudent";
    case COURSE_DISPLAY_ROLES.SUPERADMIN:
      return "pcSuperadmin";
    default:
      return null;
  }
}

/**
 * Etiqueta "Rol actual: …" solo cuando hay contexto unívoco.
 * Nunca devuelve "—" / vacío con prefijo (omitir badge en pantallas ambiguas).
 * @param {"teacher"|"co_teacher"|"student"|"superadmin"|null|undefined} displayRole
 * @param {(key: string) => string} translate
 * @returns {string|null}
 */
export function formatCurrentRoleLabel(displayRole, translate) {
  const key = courseDisplayRoleI18nKey(displayRole);
  if (!key || typeof translate !== "function") return null;
  return `${translate("pcCurrentRole")} ${translate(key)}`;
}

/**
 * Lee el rol del usuario en course_members.
 * @returns {Promise<string | null>}
 */
export async function fetchMyCourseRole(supabase, courseId, userId) {
  if (!supabase || !courseId || !userId) return null;

  const { data, error } = await supabase
    .from("course_members")
    .select("role")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("fetchMyCourseRole:", error);
    return null;
  }
  return data?.role ?? null;
}
