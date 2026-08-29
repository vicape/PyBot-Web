/**
 * Resolución y sincronización de roster Classroom → course_members.
 * Funciones puras testeables + orquestación Supabase.
 */

/** @typedef {{ userId: string, profile?: { name?: { fullName?: string }, emailAddress?: string } }} ClassroomStudent */

/**
 * @param {ClassroomStudent} student
 * @param {Map<string, { user_id: string }>} byClassroomUserId
 * @param {Map<string, { id: string }>} profileByEmail
 */
export function resolveClassroomStudent(student, byClassroomUserId, profileByEmail) {
  const classroomUserId = student.userId;
  const emailRaw = student.profile?.emailAddress;
  const email = emailRaw ? emailRaw.trim().toLowerCase() : null;
  const name = student.profile?.name?.fullName || emailRaw || classroomUserId;

  const existing = byClassroomUserId.get(classroomUserId);
  if (existing?.user_id) {
    return {
      status: "actualizado",
      name,
      email: emailRaw ?? null,
      classroomUserId,
      userId: existing.user_id,
    };
  }

  if (!email) {
    return { status: "sin_email", name, email: null, classroomUserId };
  }

  const profile = profileByEmail.get(email);
  if (!profile?.id) {
    return { status: "no_registrado", name, email: emailRaw, classroomUserId };
  }

  return {
    status: "importado",
    name,
    email: emailRaw,
    classroomUserId,
    userId: profile.id,
  };
}

/**
 * @param {ReturnType<typeof resolveClassroomStudent>[]} results
 */
export function summarizeClassroomSyncResults(results) {
  const countBy = (status) => results.filter((r) => r.status === status).length;
  return {
    imported: countBy("importado"),
    updated: countBy("actualizado"),
    noRegistrado: countBy("no_registrado"),
    sinEmail: countBy("sin_email"),
    total: results.length,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ courseId: string, orgId: string, classroomStudents: ClassroomStudent[] }} params
 */
export async function syncClassroomRosterToCourse(supabase, { courseId, orgId, classroomStudents }) {
  if (!supabase || !courseId || !orgId) {
    return { ok: false, error: "missing_args", results: [] };
  }

  const { data: existingRows, error: listErr } = await supabase.rpc("list_course_members", {
    p_course_id: courseId,
  });

  if (listErr) {
    return { ok: false, error: listErr.message || "error_list_members", results: [] };
  }

  const byClassroomUserId = new Map();
  for (const row of existingRows ?? []) {
    if (row.classroom_user_id) {
      byClassroomUserId.set(row.classroom_user_id, { user_id: row.user_id });
    }
  }

  const profileByEmail = new Map();
  const emailsToResolve = new Set();

  for (const s of classroomStudents) {
    const cid = s.userId;
    if (byClassroomUserId.has(cid)) continue;
    const email = s.profile?.emailAddress?.trim().toLowerCase();
    if (email) emailsToResolve.add(email);
  }

  for (const email of emailsToResolve) {
    const { data: profileRows, error: profErr } = await supabase.rpc("find_profile_by_email", {
      p_email: email,
    });
    if (profErr) {
      return { ok: false, error: profErr.message || "error_profile_lookup", results: [] };
    }
    const profile = Array.isArray(profileRows) ? profileRows[0] : null;
    if (profile?.id) profileByEmail.set(email, profile);
  }

  const results = classroomStudents.map((s) =>
    resolveClassroomStudent(s, byClassroomUserId, profileByEmail),
  );

  const enrolled = results
    .filter((r) => r.userId)
    .map((r) => ({
      user_id: r.userId,
      classroom_user_id: r.classroomUserId,
      classroom_email: r.email,
    }));

  const pending = results
    .filter((r) => r.status === "no_registrado" && r.email && r.classroomUserId)
    .map((r) => ({
      classroom_user_id: r.classroomUserId,
      email: r.email.trim().toLowerCase(),
      display_name: r.name,
    }));

  const activeClassroomUserIds = classroomStudents.map((s) => s.userId).filter(Boolean);

  const { data: syncData, error: syncErr } = await supabase.rpc("sync_classroom_course_roster", {
    p_course_id: courseId,
    p_org_id: orgId,
    p_enrolled: enrolled,
    p_active_classroom_user_ids: activeClassroomUserIds,
    p_pending: pending,
  });

  if (syncErr) {
    // Fallback si la DB aún no tiene el arg p_pending (migración 016)
    if (/p_pending|Could not find the function|function.*does not exist/i.test(syncErr.message || "")) {
      const legacy = await supabase.rpc("sync_classroom_course_roster", {
        p_course_id: courseId,
        p_org_id: orgId,
        p_enrolled: enrolled,
        p_active_classroom_user_ids: activeClassroomUserIds,
      });
      if (legacy.error) {
        return { ok: false, error: legacy.error.message || "error_supabase", results };
      }
      if (!legacy.data?.ok) {
        return { ok: false, error: legacy.data?.error || "sync_failed", results };
      }
      return {
        ok: true,
        results,
        summary: summarizeClassroomSyncResults(results),
        removed: legacy.data.removed ?? 0,
        synced: legacy.data.synced ?? 0,
        pendingUpserted: 0,
        pendingLegacy: true,
      };
    }
    return { ok: false, error: syncErr.message || "error_supabase", results };
  }

  if (!syncData?.ok) {
    const errCode = syncData?.error || "sync_failed";
    return { ok: false, error: errCode, results };
  }

  return {
    ok: true,
    results,
    summary: summarizeClassroomSyncResults(results),
    removed: syncData.removed ?? 0,
    synced: syncData.synced ?? 0,
    pendingUpserted: syncData.pending_upserted ?? pending.length,
  };
}

/**
 * Traduce errores de sincronización Classroom a mensajes en español.
 * @param {Error & { code?: string, status?: number }} err
 */
export function classroomSyncErrorMessage(err) {
  const code = err?.code;
  if (code === "missing_access_token") {
    return "Classroom no conectado. Andá al panel → Classroom y hacé clic en «Conectar Google Classroom».";
  }
  if (err?.status === 401 || err?.status === 403) {
    return "Token de Classroom expirado o sin permisos. Reconectá Classroom desde el panel.";
  }
  if (code === "sin_permisos") {
    return "No tenés permisos para sincronizar alumnos en este curso.";
  }
  if (code === "curso_invalido") {
    return "Curso no encontrado o sin vínculo con la institución.";
  }
  return err?.message || "Error al sincronizar alumnos desde Classroom.";
}
