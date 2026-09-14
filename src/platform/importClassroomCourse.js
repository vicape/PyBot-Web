/**
 * Importación atómica de un curso Classroom → PyBot (P6).
 * Nunca crea un curso PyBot sin classroom_course_id.
 */

import { slugifyOrganizationName } from "../slugify.js";

/**
 * @param {{ message?: string }|null|undefined} error
 */
export function isSlugInsertError(error) {
  return /slug/i.test(String(error?.message || ""));
}

/**
 * Error relacionado con classroom_course_id → la importación debe fallar (no degradar).
 * @param {{ message?: string }|null|undefined} error
 */
export function isClassroomIdInsertError(error) {
  return /classroom_course_id/i.test(String(error?.message || ""));
}

/**
 * Construye el payload de insert. classroom_course_id es obligatorio.
 * @param {{
 *   orgId: string,
 *   classroomCourseId: string,
 *   title: string,
 *   userId: string,
 *   slug?: string,
 * }} args
 */
export function buildClassroomImportPayload({
  orgId,
  classroomCourseId,
  title,
  userId,
  slug,
}) {
  const classroomId = String(classroomCourseId || "").trim();
  const org = String(orgId || "").trim();
  if (!org || !classroomId) return null;
  const payload = {
    org_id: org,
    title: String(title || `Curso ${classroomId}`).trim() || `Curso ${classroomId}`,
    classroom_course_id: classroomId,
    created_by: userId,
  };
  if (slug) payload.slug = slug;
  return payload;
}

/**
 * Importa un curso Classroom al colegio indicado.
 * @param {object} supabase
 * @param {{
 *   orgId: string,
 *   classroomCourse: { id: string, name?: string, section?: string },
 *   userId: string,
 * }} args
 * @returns {Promise<{
 *   ok: boolean,
 *   code?: string,
 *   courseId?: string,
 *   alreadyImported?: boolean,
 *   message?: string,
 * }>}
 */
export async function importClassroomCourseToOrg(supabase, { orgId, classroomCourse, userId }) {
  const targetOrgId = String(orgId || "").trim();
  const classroomId = String(classroomCourse?.id || "").trim();
  if (!supabase) {
    return { ok: false, code: "no_supabase", message: "Supabase no disponible." };
  }
  if (!userId) {
    return { ok: false, code: "no_user", message: "Sesión PyBot requerida." };
  }
  if (!targetOrgId) {
    return { ok: false, code: "missing_org", message: "Seleccioná un colegio antes de importar." };
  }
  if (!classroomId) {
    return {
      ok: false,
      code: "missing_classroom_id",
      message: "Falta el ID de Google Classroom; no se puede importar.",
    };
  }

  const title =
    classroomCourse.name || classroomCourse.section || `Curso ${classroomId}`;
  const slug = slugifyOrganizationName(title);

  const { data: existing, error: existingErr } = await supabase
    .from("courses")
    .select("id, classroom_course_id")
    .eq("org_id", targetOrgId)
    .eq("classroom_course_id", classroomId)
    .maybeSingle();

  if (existingErr) {
    return {
      ok: false,
      code: "lookup_failed",
      message: existingErr.message || "No se pudo comprobar cursos existentes.",
    };
  }

  if (existing?.id) {
    if (!existing.classroom_course_id) {
      return {
        ok: false,
        code: "corrupt_existing",
        message:
          "Hay un curso en este colegio sin ID de Classroom. No se puede marcar como importado.",
      };
    }
    return {
      ok: true,
      code: "already_imported",
      courseId: existing.id,
      alreadyImported: true,
    };
  }

  const payload = buildClassroomImportPayload({
    orgId: targetOrgId,
    classroomCourseId: classroomId,
    title,
    userId,
    slug,
  });
  if (!payload) {
    return { ok: false, code: "invalid_payload", message: "Datos de importación incompletos." };
  }

  let { data: row, error } = await supabase
    .from("courses")
    .insert(payload)
    .select("id, classroom_course_id")
    .maybeSingle();

  // Reintento sólo sin slug (nunca sin classroom_course_id).
  if (error && isSlugInsertError(error)) {
    const { slug: _omitSlug, ...withoutSlug } = payload;
    ({ data: row, error } = await supabase
      .from("courses")
      .insert(withoutSlug)
      .select("id, classroom_course_id")
      .maybeSingle());
  }

  if (error) {
    if (isClassroomIdInsertError(error)) {
      return {
        ok: false,
        code: "classroom_id_required",
        message:
          "No se pudo guardar el ID de Google Classroom. La importación se canceló para no crear un curso sin vínculo.",
      };
    }
    return {
      ok: false,
      code: "insert_failed",
      message: error.message || "No se pudo importar el curso.",
    };
  }

  if (!row?.id || !row.classroom_course_id) {
    return {
      ok: false,
      code: "integrity_failed",
      message:
        "El curso no quedó vinculado a Classroom. La importación no se considera exitosa.",
    };
  }

  if (String(row.classroom_course_id) !== classroomId) {
    return {
      ok: false,
      code: "integrity_mismatch",
      message: "El ID de Classroom guardado no coincide. Revisá el curso antes de usarlo.",
    };
  }

  return {
    ok: true,
    code: "imported",
    courseId: row.id,
    alreadyImported: false,
  };
}
