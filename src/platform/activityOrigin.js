/**
 * Origen de actividades PyBotClass (P8).
 * classroom ≠ pybot; desconocido se trata como neutral (no como pybot).
 */

/**
 * @param {unknown} origin
 * @returns {"pybot"|"classroom"|null}
 */
export function normalizeActivityOrigin(origin) {
  if (origin === "pybot" || origin === "classroom") return origin;
  return null;
}

/**
 * @param {{ origin?: string|null, classroom_coursework_id?: string|null }} activity
 */
export function isClassroomImportedActivity(activity) {
  if (!activity) return false;
  if (normalizeActivityOrigin(activity.origin) === "classroom") return true;
  return Boolean(activity.classroom_coursework_id) && normalizeActivityOrigin(activity.origin) !== "pybot";
}

/**
 * ¿Google permite modificar este courseWork vía developer association?
 * @param {{ classroom_associated_with_developer?: boolean|null, associatedWithDeveloper?: boolean|null }} activityOrCw
 */
export function canModifyClassroomCourseWork(activityOrCw) {
  const flag =
    activityOrCw?.classroom_associated_with_developer ??
    activityOrCw?.associatedWithDeveloper;
  if (typeof flag === "boolean") return flag;
  // Desconocido: no asumir permisos de modificación.
  return false;
}

/**
 * Capacidades UI/API derivadas del origen.
 * @param {{ origin?: string|null, classroom_coursework_id?: string|null, classroom_associated_with_developer?: boolean|null }} activity
 */
export function activityClassroomCapabilities(activity) {
  const origin = normalizeActivityOrigin(activity?.origin);
  const imported = isClassroomImportedActivity(activity);
  const linked = Boolean(activity?.classroom_coursework_id);
  const canPatchGoogle = linked && canModifyClassroomCourseWork(activity);
  return {
    origin,
    imported,
    linked,
    treatAsPybotCreated: origin === "pybot",
    canPatchGoogleCourseWork: canPatchGoogle,
    // Importadas: no asumir edición plena en Google.
    assumeFullGoogleEdit: origin === "pybot" && canPatchGoogle,
  };
}
