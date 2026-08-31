const ACTIVITY_LAUNCH_KEY = "pybot_activity_launch";
const ACTIVITY_LAUNCH_TTL_MS = 5 * 60 * 1000;

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

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} activityId
 * @param {{ title: string, description: string, pybotLessonId: string, starterCode: string }} fields
 */
export async function updateCourseActivity(supabase, activityId, fields) {
  if (!supabase || !activityId) return { ok: false, error: "missing_args" };

  const title = String(fields.title ?? "").trim();
  if (!title) return { ok: false, error: "Título requerido" };

  const payload = {
    p_activity_id: activityId,
    p_title: title,
    p_description: String(fields.description ?? ""),
    p_pybot_lesson_id: String(fields.pybotLessonId ?? "").trim() || null,
    p_starter_code: String(fields.starterCode ?? ""),
  };

  const rpc = await supabase.rpc("update_activity_for_staff", payload);
  if (!rpc.error) return { ok: true, error: null };

  const body = {
    title,
    description: payload.p_description,
    pybot_lesson_id: payload.p_pybot_lesson_id,
    starter_code: payload.p_starter_code,
  };

  let { error } = await supabase.from("activities").update(body).eq("id", activityId);

  if (error?.message?.includes("starter_code")) {
    const { starter_code: _omit, ...withoutStarter } = body;
    ({ error } = await supabase.from("activities").update(withoutStarter).eq("id", activityId));
  }

  if (error?.message?.includes("update_activity_for_staff")) {
    return { ok: false, error: "Sin permiso para editar. Ejecutá la migración 025 en Supabase." };
  }

  return { ok: !error, error: error?.message ?? rpc.error?.message ?? null };
}
