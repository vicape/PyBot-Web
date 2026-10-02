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
 * Precedencia canónica:
 * - organization_members.role = institution-level capabilities (owner/teacher staff)
 * - course_members.role = explicit pedagogical role for the course
 * - explicit course_members.student MUST NOT be overridden by org staff
 * - without explicit course membership, preserve existing institution staff teaching
 * @param {{ orgRole?: string | null, courseRole?: string | null }} opts
 */
export function canTeachCourse({ orgRole = null, courseRole = null } = {}) {
  const normalized = normalizeCourseRole(courseRole);
  if (normalized === "student") return false;
  if (normalized === "teacher") return true;
  return isStaffRole(orgRole);
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
 * profiles.preferred_role / preferredRole is preference only — never authorization.
 * When course_members.role is explicit, it determines pedagogical mode for that course;
 * organization_members.role alone must not override explicit course student.
 * Contract: resolveCourseContext(...).mode is studying when course_members.role is student
 * even if organization_members.role is teacher/owner; otherwise staff teaching is preserved.
 *
 * @param {{
 *   orgRole?: string | null,
 *   courseRole?: string | null,
 *   isSuperAdmin?: boolean,
 *   preferredRole?: string | null,
 *   isPersonalCourseCreator?: boolean,
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
  isPersonalCourseCreator = false,
} = {}) {
  // profiles.preferred_role must not grant permissions / must not be the effective role resolver
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

  if (normalized === "student") {
    // course_members.student explícito → Alumno / studying (no lo pisa org staff)
    mode = COURSE_ACCESS_MODES.STUDYING;
    displayRole = COURSE_DISPLAY_ROLES.STUDENT;
  } else if (orgStaff) {
    // owner u org-teacher sin student explícito → Docente / teaching
    mode = COURSE_ACCESS_MODES.TEACHING;
    displayRole = COURSE_DISPLAY_ROLES.TEACHER;
  } else if (normalized === "teacher") {
    // Personal course creator → Docente; other explicit teacher → Co-docente
    mode = COURSE_ACCESS_MODES.TEACHING;
    displayRole = isPersonalCourseCreator
      ? COURSE_DISPLAY_ROLES.TEACHER
      : COURSE_DISPLAY_ROLES.CO_TEACHER;
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
 * Valor compacto del rol (sin prefijo "Rol actual:") para UI estrecha.
 * Independiente de formatCurrentRoleLabel — no parsea strings traducidos.
 * @param {"teacher"|"co_teacher"|"student"|"superadmin"|null|undefined} displayRole
 * @param {(key: string) => string} translate
 * @returns {string|null}
 */
export function formatCurrentRoleCompact(displayRole, translate) {
  const key = courseDisplayRoleI18nKey(displayRole);
  if (!key || typeof translate !== "function") return null;
  return translate(key);
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
