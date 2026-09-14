/**
 * Resultados de operaciones Classroom secundarias (P11–P13).
 * PyBot es fuente de verdad local; Classroom es sync.
 */

/**
 * @param {object|null|undefined} classroomResult resultado de turnInPybotActivityToClassroom
 */
export function classifyPybotClassroomTurnIn(classroomResult) {
  if (!classroomResult) {
    return { pybot: "saved", classroom: "unknown" };
  }
  if (classroomResult.skipped) {
    return {
      pybot: "saved",
      classroom: "skipped",
      reason: classroomResult.error || null,
    };
  }
  if (classroomResult.ok) {
    return {
      pybot: "saved",
      classroom: classroomResult.alreadyTurnedIn ? "already_ok" : "ok",
    };
  }
  if (classroomResult.needsConnect) {
    return { pybot: "saved", classroom: "pending_auth" };
  }
  return {
    pybot: "saved",
    classroom: "error",
    reason: classroomResult.error || "classroom_failed",
  };
}

/**
 * Normaliza un resultado de op Classroom a {ok|skipped|error} para batches (P14).
 * @param {{ ok?: boolean, skipped?: boolean, error?: string }|null|undefined} res
 */
export function normalizeClassroomBatchItem(res) {
  if (!res) return { ok: false, error: "empty_result" };
  if (res.skipped) return { skipped: true, error: res.error || null };
  if (res.ok) return { ok: true };
  const code = String(res.error || "");
  if (
    code === "associated_with_developer_false" ||
    code === "coursework_not_associated_with_developer"
  ) {
    return { skipped: true, error: code };
  }
  return { ok: false, error: code || "failed" };
}

/**
 * @param {Array<{ ok?: boolean, skipped?: boolean, error?: string }>} results
 */
export function summarizeClassroomGradeBatch(results = []) {
  let success = 0;
  let skipped = 0;
  let error = 0;
  for (const r of results) {
    const n = normalizeClassroomBatchItem(r);
    if (n.skipped) skipped += 1;
    else if (n.ok) success += 1;
    else error += 1;
  }
  return { success, skipped, error, total: results.length };
}

/** Alias publish batch (misma taxonomía P14). */
export function summarizeClassroomPublishBatch(results = []) {
  return summarizeClassroomGradeBatch(results);
}

/**
 * @param {Array<{ ok?: boolean, skipped?: boolean, error?: string }>} results
 */
export function summarizeClassroomReturnBatch(results = []) {
  return summarizeClassroomGradeBatch(results);
}

/**
 * @param {string} label
 * @param {{ success: number, skipped: number, error: number, total: number }} summary
 */
export function formatClassroomBatchSummary(label, summary) {
  return `${label}: ${summary.success} ok · ${summary.skipped} omitidas · ${summary.error} error(es) (total ${summary.total}).`;
}
