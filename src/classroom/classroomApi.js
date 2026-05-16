const CLASSROOM_ROOT = "https://classroom.googleapis.com/v1";

async function classroomFetch(path, accessToken) {
  if (!accessToken) {
    const err = new Error("missing_access_token");
    err.code = "missing_access_token";
    throw err;
  }
  const res = await fetch(`${CLASSROOM_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Classroom HTTP ${res.status}`);
    err.code = json?.error?.status || "classroom_error";
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Lista cursos ACTIVOS donde el usuario es teacher.
 */
export async function listTeacherClassroomCourses(accessToken) {
  const qs = new URLSearchParams({ courseStates: "ACTIVE", teacherId: "me", pageSize: "50" });
  const json = await classroomFetch(`/courses?${qs}`, accessToken);
  return Array.isArray(json.courses) ? json.courses : [];
}

/**
 * Lista alumnos de un curso de Classroom.
 * Requiere scope classroom.rosters.readonly.
 * Devuelve array de { userId, profile: { name, emailAddress, photoUrl } }
 */
export async function listCourseStudents(accessToken, classroomCourseId) {
  if (!classroomCourseId) return [];
  const qs = new URLSearchParams({ pageSize: "200" });
  const json = await classroomFetch(
    `/courses/${encodeURIComponent(classroomCourseId)}/students?${qs}`,
    accessToken,
  );
  return Array.isArray(json.students) ? json.students : [];
}
