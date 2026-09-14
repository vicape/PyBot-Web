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
 * @param {Array<{ ok?: boolean, skipped?: boolean, error?: string }>} results
 */
export function summarizeClassroomGradeBatch(results = []) {
  let success = 0;
  let skipped = 0;
  let error = 0;
  for (const r of results) {
    if (r?.skipped) skipped += 1;
    else if (r?.ok) success += 1;
    else error += 1;
  }
  return { success, skipped, error, total: results.length };
}

/**
 * @param {Array<{ ok?: boolean, skipped?: boolean, error?: string }>} results
 */
export function summarizeClassroomReturnBatch(results = []) {
  return summarizeClassroomGradeBatch(results);
}
