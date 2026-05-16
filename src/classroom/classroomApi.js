const CLASSROOM_ROOT = "https://classroom.googleapis.com/v1";

/**
 * Lista cursos ACTIVOS donde el usuario maestro es teacher (Classroom API).
 * @param {string} accessToken — session.provider_token del login Google vía Supabase
 */
export async function listTeacherClassroomCourses(accessToken) {
  if (!accessToken) {
    const err = new Error("missing_access_token");
    err.code = "missing_access_token";
    throw err;
  }
  const qs = new URLSearchParams({
    courseStates: "ACTIVE",
    teacherId: "me",
    pageSize: "50",
  });
  const res = await fetch(`${CLASSROOM_ROOT}/courses?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Classroom HTTP ${res.status}`);
    err.code = json?.error?.status || "classroom_error";
    err.status = res.status;
    throw err;
  }
  return Array.isArray(json.courses) ? json.courses : [];
}
