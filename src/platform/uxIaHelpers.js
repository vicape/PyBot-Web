import { normalizeCourseRole } from "./courseRole.js";

/** Primary daily nav ids (AC1). */
export const PRIMARY_NAV_IDS = Object.freeze([
  "home",
  "courses",
  "content",
  "community",
  "ide",
]);

/**
 * Resolve Home vs Courses view from URL (additive, hash-compatible).
 * @param {{ view?: string | null, hash?: string | null }} opts
 * @returns {"home"|"courses"}
 */
export function resolveClassesView({ view = null, hash = null } = {}) {
  const v = String(view || "").toLowerCase();
  if (v === "courses") return "courses";
  const h = String(hash || "");
  if (h === "#mis-cursos" || h.endsWith("mis-cursos")) return "courses";
  return "home";
}

/**
 * Teacher Home attention items from existing course list fields only.
 * @param {Array<object>} courses
 * @returns {Array<{ id: string, kind: string, courseId: string, title: string, count?: number, href: string }>}
 */
export function buildTeacherAttentionItems(courses = []) {
  const items = [];
  for (const c of courses) {
    if (normalizeCourseRole(c.my_course_role) !== "teacher") continue;
    const id = c.course_id;
    const title = c.course_title || c.title || id;
    const pending = Number(c.pending_grade_count ?? 0);
    const students = Number(c.student_count ?? 0);
    const activities = Number(c.activity_count ?? 0);

    if (pending > 0) {
      items.push({
        id: `${id}-pending`,
        kind: "pending_grades",
        courseId: id,
        title,
        count: pending,
        href: `/dashboard/classes/${id}?tab=entregas`,
      });
    }
    if (students === 0) {
      items.push({
        id: `${id}-no-students`,
        kind: "no_students",
        courseId: id,
        title,
        href: `/dashboard/classes/${id}?tab=alumnos&focus=invite`,
      });
    } else if (activities === 0) {
      items.push({
        id: `${id}-no-activities`,
        kind: "no_activities",
        courseId: id,
        title,
        href: `/dashboard/classes/${id}?tab=actividades&action=create`,
      });
    }
  }
  return items;
}

/**
 * Course Summary next-step from existing summary values.
 * Priority: missing students → no activities → pending grading → null.
 * @param {{ student_count?: number, activity_count?: number, pending_grade_count?: number } | null} summary
 * @returns {{ kind: string, studentCount?: number, activityCount?: number, pendingCount?: number } | null}
 */
export function resolveCourseNextStep(summary) {
  if (!summary) return null;
  const students = Number(summary.student_count ?? 0);
  const activities = Number(summary.activity_count ?? 0);
  const pending = Number(summary.pending_grade_count ?? 0);

  if (students === 0) {
    return { kind: "add_students", studentCount: 0 };
  }
  if (activities === 0) {
    return { kind: "first_activity", studentCount: students, activityCount: 0 };
  }
  if (pending > 0) {
    return { kind: "grade_pending", pendingCount: pending };
  }
  return null;
}

/**
 * Non-blocking prep guide derived from summary (no persisted state).
 * Hidden when course is established (has students, activities, and submissions).
 * @param {{ student_count?: number, activity_count?: number, submission_count?: number } | null} summary
 * @returns {null | { steps: Array<{ id: string, done: boolean }>, established: boolean }}
 */
export function resolveCoursePrepGuide(summary) {
  if (!summary) return null;
  const students = Number(summary.student_count ?? 0);
  const activities = Number(summary.activity_count ?? 0);
  const submissions = Number(summary.submission_count ?? 0);
  const established = students > 0 && activities > 0 && submissions > 0;
  if (established) return { steps: [], established: true };

  return {
    established: false,
    steps: [
      { id: "course_created", done: true },
      { id: "students_added", done: students > 0 },
      { id: "activity_ready", done: activities > 0 },
      { id: "receiving", done: submissions > 0 },
    ],
  };
}

/**
 * Sharing-state badge key for owned content.
 * @param {string | null | undefined} visibility
 * @returns {"private"|"courses"|"community"}
 */
export function ownedContentShareState(visibility) {
  if (visibility === "community") return "community";
  if (visibility === "courses") return "courses";
  return "private";
}

/**
 * Map known Classroom sync error codes to user-facing recovery kinds.
 * @param {unknown} err
 * @returns {{ kind: string, raw?: string }}
 */
export function mapClassroomSyncUserError(err) {
  const code = err?.code || err?.error || "";
  const msg = String(err?.message || err || "");
  if (
    code === "missing_access_token" ||
    /missing_access_token|not connected|no conectad|expir/i.test(msg)
  ) {
    return { kind: "reconnect" };
  }
  if (/not linked|no.*vinculad|no tiene Classroom/i.test(msg)) {
    return { kind: "link_integrations" };
  }
  return { kind: "generic", raw: msg || undefined };
}

/**
 * Whether invite generation should run on mount/navigation alone.
 * Always false — invite remains an explicit user action.
 */
export function shouldAutoCreateInviteOnNavigate() {
  return false;
}
