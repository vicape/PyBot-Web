import { DEFAULT_CODE } from "../examplesData.js";
import { fetchActivityProgress } from "./activityProgress.js";
import { readActivityLaunchCache } from "./courseActivityApi.js";

export const ACTIVITY_ID_QUERY = "actividad";
export const ACTIVITY_LAUNCH_STATE_KEY = "activityLaunchCode";

/** @param {URLSearchParams | null | undefined} searchParams */
export function parseActivityId(searchParams) {
  const raw = searchParams?.get(ACTIVITY_ID_QUERY);
  if (!raw) return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

/**
 * Prioridad:
 * 1. código pasado al abrir el IDE (state/cache)
 * 2. progreso guardado (si no es solo la plantilla genérica del IDE)
 * 3. código inicial de la actividad
 * 4. fallback
 */
export function resolveActivityEditorCode({
  starterCode,
  savedCode,
  launchCode,
  fallback = DEFAULT_CODE,
  genericTemplate = DEFAULT_CODE,
}) {
  const launch = launchCode != null ? String(launchCode) : "";
  const saved = savedCode != null ? String(savedCode) : "";
  const starter = starterCode != null ? String(starterCode) : "";
  const generic = genericTemplate != null ? String(genericTemplate).trim() : "";

  if (launch.length > 0) return launch;
  if (saved.length > 0 && saved.trim() !== generic) return saved;
  if (starter.length > 0) return starter;
  if (saved.length > 0) return saved;
  return fallback;
}

/** @deprecated Usar resolveActivityEditorCode */
export function pickActivityEditorCode(starterCode, savedCode, fallback = "") {
  return resolveActivityEditorCode({ starterCode, savedCode, launchCode: "", fallback });
}

/**
 * Carga metadatos de la actividad y el código que debe mostrar el IDE.
 * @returns {Promise<{ activity: object | null, code: string, error: string | null }>}
 */
async function fetchActivityRow(supabase, activityId) {
  const rpc = await supabase.rpc("get_activity_for_ide", { p_activity_id: activityId });
  if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length > 0) {
    return { act: rpc.data[0], error: null };
  }

  let { data: act, error: eAct } = await supabase
    .from("activities")
    .select("id, title, description, starter_code, pybot_lesson_id, course_id")
    .eq("id", activityId)
    .maybeSingle();

  if (eAct) {
    const fb = await supabase
      .from("activities")
      .select("id, title, description, course_id")
      .eq("id", activityId)
      .maybeSingle();
    act = fb.data;
    eAct = fb.error;
  }

  if (eAct) return { act: null, error: eAct.message };
  if (!act) return { act: null, error: "not_found" };
  return { act, error: null };
}

export function readActivityLaunchCode(activityId, locationState) {
  const fromState = locationState?.[ACTIVITY_LAUNCH_STATE_KEY];
  if (typeof fromState === "string" && fromState.length > 0) return fromState;
  const cached = readActivityLaunchCache(activityId);
  if (cached != null && cached.length > 0) return cached;
  return "";
}

export async function loadActivityIdeSession(supabase, activityId, userId, launchCode = "") {
  if (!supabase || !activityId) {
    return { activity: null, code: null, error: "missing_args" };
  }

  const { act, error: eAct } = await fetchActivityRow(supabase, activityId);

  if (eAct) {
    if (launchCode) {
      return { activity: { id: activityId, title: "Actividad" }, code: launchCode, error: null };
    }
    return { activity: null, code: null, error: eAct };
  }

  let savedCode = null;
  if (userId) {
    const prog = await fetchActivityProgress(activityId, userId);
    if (!prog.error) savedCode = prog.code;
  }

  const code = resolveActivityEditorCode({
    starterCode: act.starter_code,
    savedCode,
    launchCode,
  });
  return { activity: act, code, error: null };
}
