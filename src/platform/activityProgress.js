import { getSupabase } from "../supabaseClient.js";

/** Lee el código guardado del usuario actual para una actividad. */
export async function fetchActivityProgress(activityId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { code: null, error: "missing_args" };

  const { data, error } = await sb
    .from("activity_progress")
    .select("code, updated_at")
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { code: null, error: error.message };
  return { code: data?.code ?? null, updatedAt: data?.updated_at ?? null, error: null };
}

/** Guarda progreso (upsert). Para conectar al editor en una fase posterior. */
export async function saveActivityProgress(activityId, userId, code) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { ok: false, error: "missing_args" };

  const { error } = await sb.from("activity_progress").upsert(
    {
      activity_id: activityId,
      user_id: userId,
      code: code ?? "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "activity_id,user_id" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}
