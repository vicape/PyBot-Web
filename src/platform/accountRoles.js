import { hasStaffMembership } from "../orgRole.js";

/**
 * Badges de rol derivados de datos reales (no preferred_role).
 * @param {{ orgs?: {role?: string}[], courses?: {my_course_role?: string}[], isSuperAdmin?: boolean }} input
 */
export function computeAccountRoleBadges({ orgs = [], courses = [], isSuperAdmin = false } = {}) {
  const badges = [];

  if (isSuperAdmin) {
    badges.push({ id: "superadmin", label: "SuperAdmin", variant: "gold" });
  }

  if (orgs.some((o) => o.role === "owner")) {
    badges.push({ id: "gestion", label: "Gestión", variant: "purple" });
  }

  const teachesCourse = courses.some((c) => c.my_course_role === "teacher");
  const hasStaffOrg = orgs.some((o) => o.role === "owner" || o.role === "teacher");
  if (teachesCourse || hasStaffOrg) {
    badges.push({ id: "docente", label: "Docente", variant: "blue" });
  }

  const studiesCourse = courses.some((c) => c.my_course_role === "student");
  if (studiesCourse) {
    badges.push({ id: "alumno", label: "Alumno", variant: "teal" });
  }

  return badges;
}

export function computeQuickSummary({ courses = [], isSuperAdmin = false } = {}) {
  const teacherCourses = courses.filter((c) => c.my_course_role === "teacher");
  const studentCourses = courses.filter((c) => c.my_course_role === "student");
  const pending = courses.reduce((n, c) => n + (c.pending_grade_count ?? 0), 0);
  const totalStudents = teacherCourses.reduce((n, c) => n + (c.student_count ?? 0), 0);
  const totalActivities = teacherCourses.reduce((n, c) => n + (c.activity_count ?? 0), 0);

  const items = [];

  if (teacherCourses.length > 0 || studentCourses.length > 0) {
    items.push({
      id: "courses",
      label: "Cursos",
      value: String(courses.length),
    });
  }

  if (teacherCourses.length > 0) {
    items.push({
      id: "teacher",
      label: "Como docente",
      value: String(teacherCourses.length),
    });
  }

  if (studentCourses.length > 0) {
    items.push({
      id: "student",
      label: "Como alumno",
      value: String(studentCourses.length),
    });
  }

  if (pending > 0) {
    items.push({
      id: "pending",
      label: "Por corregir",
      value: String(pending),
      highlight: true,
    });
  }

  if (isSuperAdmin && totalStudents > 0) {
    items.push({
      id: "students",
      label: "Alumnos (tus cursos)",
      value: String(totalStudents),
    });
  }

  if (teacherCourses.length > 0 && totalActivities > 0) {
    items.push({
      id: "activities",
      label: "Actividades",
      value: String(totalActivities),
    });
  }

  return items;
}
