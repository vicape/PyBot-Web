const ACTIVITY_LAUNCH_KEY = "pybot_activity_launch";
const ACTIVITY_LAUNCH_TTL_MS = 5 * 60 * 1000;

export const STARTER_CODE_SCHEMA_HINT =
  "No se pudo guardar el código inicial. En Supabase ejecutá la migración 018 (columna starter_code) y 025 (RPC update_activity_for_staff).";

export const ACTIVITY_UPDATE_PERMISSION_HINT =
  "Sin permiso para editar actividades. En Supabase ejecutá las migraciones 024 y 025.";

/** @param {string} activityId @param {string} code */
export function writeActivityLaunchCache(activityId, code) {
  if (!activityId) return;
  try {
    sessionStorage.setItem(
      ACTIVITY_LAUNCH_KEY,
      JSON.stringify({
        activityId,
        code: code ?? "",
        at: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

/** @param {string | null} activityId */
export function readActivityLaunchCache(activityId) {
  if (!activityId) return null;
  try {
    const raw = sessionStorage.getItem(ACTIVITY_LAUNCH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.activityId !== activityId) return null;
    if (Date.now() - Number(data.at || 0) > ACTIVITY_LAUNCH_TTL_MS) return null;
    return typeof data.code === "string" ? data.code : null;
  } catch {
    return null;
  }
}

function isMissingRpcError(message) {
  return /update_activity_for_staff|could not find the function|42883/i.test(message ?? "");
}

function isStarterColumnError(message) {
  return /starter_code/i.test(message ?? "");
}

function isPermissionError(message) {
  return /permission|policy|forbidden|42501|activity_not_found/i.test(message ?? "");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ courseId: string, title: string, description?: string, pybotLessonId?: string, starterCode?: string, createdBy: string }} fields
 */
export async function createCourseActivity(supabase, fields) {
  if (!supabase || !fields.courseId || !fields.createdBy) {
    return { row: null, error: "missing_args" };
  }

  const title = String(fields.title ?? "").trim();
  if (!title) return { row: null, error: "Título requerido" };

  const full = {
    course_id: fields.courseId,
    title,
    description: String(fields.description ?? "").trim(),
    pybot_lesson_id: String(fields.pybotLessonId ?? "").trim() || null,
    starter_code: String(fields.starterCode ?? ""),
    created_by: fields.createdBy,
  };

  let { data, error } = await supabase
    .from("activities")
    .insert(full)
    .select("id, title, starter_code, description, pybot_lesson_id, created_at")
    .maybeSingle();

  if (error?.message && isStarterColumnError(error.message)) {
    return { row: null, error: STARTER_CODE_SCHEMA_HINT };
  }

  if (
    error &&
    (error.message?.includes("description") || error.message?.includes("pybot_lesson"))
  ) {
    ({ data, error } = await supabase
      .from("activities")
      .insert({
        course_id: fields.courseId,
        title,
        starter_code: full.starter_code,
        created_by: fields.createdBy,
      })
      .select("id, title, starter_code, created_at")
      .maybeSingle());

    if (error?.message && isStarterColumnError(error.message)) {
      return { row: null, error: STARTER_CODE_SCHEMA_HINT };
    }
  }

  if (error) return { row: null, error: error.message };
  return { row: data, error: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} activityId
 * @param {{ title: string, description?: string, pybotLessonId?: string, starterCode?: string, courseId?: string }} fields
 */
export async function updateCourseActivity(supabase, activityId, fields) {
  if (!supabase || !activityId) return { ok: false, error: "missing_args" };

  const title = String(fields.title ?? "").trim();
  if (!title) return { ok: false, error: "Título requerido" };

  const starterCode = String(fields.starterCode ?? "");
  const payload = {
    p_activity_id: activityId,
    p_title: title,
    p_description: String(fields.description ?? ""),
    p_pybot_lesson_id: String(fields.pybotLessonId ?? "").trim() || null,
    p_starter_code: starterCode,
  };

  const rpc = await supabase.rpc("update_activity_for_staff", payload);
  if (!rpc.error) {
    if (fields.courseId) {
      const { error: moveErr } = await supabase
        .from("activities")
        .update({ course_id: fields.courseId })
        .eq("id", activityId);
      if (moveErr) return { ok: false, error: moveErr.message };
    }
    return { ok: true, error: null };
  }

  const rpcMsg = rpc.error?.message ?? "";
  if (!isMissingRpcError(rpcMsg) && !isPermissionError(rpcMsg)) {
    if (isStarterColumnError(rpcMsg)) {
      return { ok: false, error: STARTER_CODE_SCHEMA_HINT };
    }
    return { ok: false, error: rpcMsg };
  }

  const body = {
    title,
    description: payload.p_description,
    pybot_lesson_id: payload.p_pybot_lesson_id,
    starter_code: starterCode,
  };
  if (fields.courseId) body.course_id = fields.courseId;

  const { error } = await supabase.from("activities").update(body).eq("id", activityId);

  if (!error) return { ok: true, error: null };
  if (isStarterColumnError(error.message)) {
    return { ok: false, error: STARTER_CODE_SCHEMA_HINT };
  }
  if (isPermissionError(error.message) || isMissingRpcError(rpcMsg)) {
    return { ok: false, error: ACTIVITY_UPDATE_PERMISSION_HINT };
  }
  return { ok: false, error: error.message ?? rpcMsg };
}
