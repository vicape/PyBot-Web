const CLASSROOM_ROOT = "https://classroom.googleapis.com/v1";
const MAX_PAGES = 50;

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
 * Recorre páginas de una API de Classroom con nextPageToken.
 * @param {(pageToken: string | null) => Promise<{ items: unknown[], nextPageToken: string | null }>} fetchPage
 */
export async function fetchAllClassroomPages(fetchPage) {
  const all = [];
  let pageToken = null;
  let pages = 0;

  do {
    const { items, nextPageToken } = await fetchPage(pageToken);
    if (Array.isArray(items)) all.push(...items);
    pageToken = nextPageToken || null;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return all;
}

/**
 * Lista cursos ACTIVOS donde el usuario es teacher.
 */
export async function listTeacherClassroomCourses(accessToken) {
  return fetchAllClassroomPages(async (pageToken) => {
    const qs = new URLSearchParams({ courseStates: "ACTIVE", teacherId: "me", pageSize: "50" });
    if (pageToken) qs.set("pageToken", pageToken);
    const json = await classroomFetch(`/courses?${qs}`, accessToken);
    return {
      items: Array.isArray(json.courses) ? json.courses : [],
      nextPageToken: json.nextPageToken || null,
    };
  });
}

/**
 * Lista alumnos de un curso de Classroom.
 * Requiere scope classroom.rosters.readonly.
 */
export async function listCourseStudents(accessToken, classroomCourseId) {
  if (!classroomCourseId) return [];
  return fetchAllClassroomPages(async (pageToken) => {
    const qs = new URLSearchParams({ pageSize: "200" });
    if (pageToken) qs.set("pageToken", pageToken);
    const json = await classroomFetch(
      `/courses/${encodeURIComponent(classroomCourseId)}/students?${qs}`,
      accessToken,
    );
    return {
      items: Array.isArray(json.students) ? json.students : [],
      nextPageToken: json.nextPageToken || null,
    };
  });
}

/**
 * Lista docentes de un curso de Classroom.
 * Mismo scope de roster (classroom.rosters.readonly).
 */
export async function listCourseTeachers(accessToken, classroomCourseId) {
  if (!classroomCourseId) return [];
  return fetchAllClassroomPages(async (pageToken) => {
    const qs = new URLSearchParams({ pageSize: "200" });
    if (pageToken) qs.set("pageToken", pageToken);
    const json = await classroomFetch(
      `/courses/${encodeURIComponent(classroomCourseId)}/teachers?${qs}`,
      accessToken,
    );
    return {
      items: Array.isArray(json.teachers) ? json.teachers : [],
      nextPageToken: json.nextPageToken || null,
    };
  });
}

async function classroomMutate(path, accessToken, { method = "POST", body } = {}) {
  if (!accessToken) {
    const err = new Error("missing_access_token");
    err.code = "missing_access_token";
    throw err;
  }
  const res = await fetch(`${CLASSROOM_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
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
 * Crea un courseWork (assignment) en Classroom.
 * Scope: classroom.coursework.students
 */
export async function createCourseWork(
  accessToken,
  classroomCourseId,
  { title, description, maxPoints, materials, dueDate, dueTime },
) {
  const body = {
    title,
    description: description || "",
    workType: "ASSIGNMENT",
    state: "PUBLISHED",
    materials: materials || [],
  };
  if (maxPoints != null && Number.isFinite(Number(maxPoints))) {
    body.maxPoints = Number(maxPoints);
  }
  if (dueDate) body.dueDate = dueDate;
  if (dueTime) body.dueTime = dueTime;
  return classroomMutate(`/courses/${encodeURIComponent(classroomCourseId)}/courseWork`, accessToken, {
    method: "POST",
    body,
  });
}

/**
 * Actualiza un courseWork existente en Classroom.
 */
export async function patchCourseWork(
  accessToken,
  classroomCourseId,
  courseWorkId,
  { title, description, maxPoints, dueDate, dueTime },
) {
  const fields = [];
  const body = {};
  if (title != null) {
    body.title = title;
    fields.push("title");
  }
  if (description != null) {
    body.description = description;
    fields.push("description");
  }
  if (maxPoints != null && Number.isFinite(Number(maxPoints))) {
    body.maxPoints = Number(maxPoints);
    fields.push("maxPoints");
  }
  if (dueDate) {
    body.dueDate = dueDate;
    fields.push("dueDate");
  }
  if (dueTime) {
    body.dueTime = dueTime;
    fields.push("dueTime");
  }
  if (!fields.length) return null;
  const qs = new URLSearchParams({ updateMask: fields.join(",") });
  return classroomMutate(
    `/courses/${encodeURIComponent(classroomCourseId)}/courseWork/${encodeURIComponent(courseWorkId)}?${qs}`,
    accessToken,
    { method: "PATCH", body },
  );
}

/**
 * Lista courseWork de un curso Classroom con paginación.
 */
export async function listCourseWork(accessToken, classroomCourseId) {
  if (!classroomCourseId) return [];
  return fetchAllClassroomPages(async (pageToken) => {
    const qs = new URLSearchParams({ pageSize: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const json = await classroomFetch(
      `/courses/${encodeURIComponent(classroomCourseId)}/courseWork?${qs}`,
      accessToken,
    );
    return {
      items: Array.isArray(json.courseWork) ? json.courseWork : [],
      nextPageToken: json.nextPageToken || null,
    };
  });
}

/**
 * Lista studentSubmissions de un courseWork.
 * @param {string} [userId] filtro Google userId (p. ej. "me" para el alumno actual)
 */
export async function listStudentSubmissions(accessToken, classroomCourseId, courseWorkId, userId) {
  if (!classroomCourseId || !courseWorkId) return [];
  return fetchAllClassroomPages(async (pageToken) => {
    const qs = new URLSearchParams({ pageSize: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    if (userId) qs.set("userId", userId);
    const json = await classroomFetch(
      `/courses/${encodeURIComponent(classroomCourseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?${qs}`,
      accessToken,
    );
    return {
      items: Array.isArray(json.studentSubmissions) ? json.studentSubmissions : [],
      nextPageToken: json.nextPageToken || null,
    };
  });
}

/**
 * Asigna nota (draftGrade + assignedGrade) a una studentSubmission.
 */
export async function patchStudentSubmissionGrade(
  accessToken,
  classroomCourseId,
  courseWorkId,
  submissionId,
  grade,
) {
  const qs = new URLSearchParams({ updateMask: "draftGrade,assignedGrade" });
  return classroomMutate(
    `/courses/${encodeURIComponent(classroomCourseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}?${qs}`,
    accessToken,
    {
      method: "PATCH",
      body: {
        draftGrade: Number(grade),
        assignedGrade: Number(grade),
      },
    },
  );
}

/**
 * Devuelve la submission al alumno (return).
 */
export async function returnStudentSubmission(
  accessToken,
  classroomCourseId,
  courseWorkId,
  submissionId,
) {
  return classroomMutate(
    `/courses/${encodeURIComponent(classroomCourseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:return`,
    accessToken,
    { method: "POST", body: {} },
  );
}

/**
 * Alumno entrega la StudentSubmission en Classroom (turnIn).
 * Requiere scope classroom.coursework.me y que el courseWork
 * haya sido creado por el mismo proyecto OAuth.
 */
export async function turnInStudentSubmission(
  accessToken,
  classroomCourseId,
  courseWorkId,
  submissionId,
) {
  return classroomMutate(
    `/courses/${encodeURIComponent(classroomCourseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:turnIn`,
    accessToken,
    { method: "POST", body: {} },
  );
}
