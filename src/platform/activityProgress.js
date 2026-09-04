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

/** Guarda progreso (RPC; fallback a upsert directo). */
export async function saveActivityProgress(activityId, userId, code) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("save_activity_progress", {
    p_activity_id: activityId,
    p_code: code ?? "",
  });

  if (!error && data?.ok) return { ok: true, error: null };

  // Fallback si la migración 042 aún no está aplicada
  if (error && /function|does not exist|schema cache/i.test(error.message || "")) {
    const { error: upErr } = await sb.from("activity_progress").upsert(
      {
        activity_id: activityId,
        user_id: userId,
        code: code ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "activity_id,user_id" },
    );
    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true, error: null };
  }

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "save_failed" };
  return { ok: true, error: null };
}
