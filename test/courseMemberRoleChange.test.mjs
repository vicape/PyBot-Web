import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canShowCourseRoleChangeAction,
  updateCourseMemberRole,
} from "../src/platform/courseMemberRoleApi.js";
import { canManageRoster, resolveCourseContext } from "../src/platform/courseRole.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rosterSrc = readFileSync(resolve(root, "src/components/pybotclass/CourseRosterTab.jsx"), "utf8");
const apiSrc = readFileSync(resolve(root, "src/platform/courseMemberRoleApi.js"), "utf8");

function makeUpdateClient({ error = null, data = null } = {}) {
  const calls = [];
  const chain = {
    update(payload) {
      calls.push({ type: "update", payload });
      return chain;
    },
    eq(col, val) {
      calls.push({ type: "eq", col, val });
      return chain;
    },
    select(cols) {
      calls.push({ type: "select", cols });
      return chain;
    },
    maybeSingle() {
      calls.push({ type: "maybeSingle" });
      return Promise.resolve({ data, error });
    },
  };
  return {
    calls,
    from(table) {
      calls.push({ type: "from", table });
      return chain;
    },
  };
}

test("updateCourseMemberRole: student -> teacher updates only role", async () => {
  const existing = {
    course_id: "c1",
    user_id: "u2",
    role: "teacher",
    source: "classroom",
    classroom_user_id: "gc-2",
    classroom_email: "ana@school.edu",
    created_at: "2026-01-01T00:00:00Z",
    synced_at: "2026-01-02T00:00:00Z",
  };
  const sb = makeUpdateClient({ data: existing });
  const result = await updateCourseMemberRole(sb, {
    courseId: "c1",
    userId: "u2",
    role: "teacher",
    actorUserId: "manager-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.role, "teacher");
  assert.equal(result.row.source, "classroom");
  assert.equal(result.row.classroom_user_id, "gc-2");
  assert.equal(result.row.classroom_email, "ana@school.edu");
  assert.equal(result.row.created_at, "2026-01-01T00:00:00Z");
  assert.equal(result.row.synced_at, "2026-01-02T00:00:00Z");
  assert.deepEqual(
    sb.calls.filter((c) => c.type === "update").map((c) => c.payload),
    [{ role: "teacher" }],
  );
  assert.equal(sb.calls.some((c) => c.type === "from" && c.table === "course_members"), true);
  assert.equal(sb.calls.some((c) => c.type === "from" && c.table === "organization_members"), false);
  assert.equal(sb.calls.some((c) => c.type === "from" && c.table === "profiles"), false);
});

test("updateCourseMemberRole: teacher -> student updates only role", async () => {
  const sb = makeUpdateClient({
    data: {
      course_id: "c1",
      user_id: "u3",
      role: "student",
      source: "manual",
      classroom_user_id: null,
      classroom_email: null,
      created_at: "2026-02-01T00:00:00Z",
      synced_at: null,
    },
  });
  const result = await updateCourseMemberRole(sb, {
    courseId: "c1",
    userId: "u3",
    role: "student",
    actorUserId: "manager-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.role, "student");
  assert.equal(result.row.source, "manual");
  assert.deepEqual(
    sb.calls.filter((c) => c.type === "update").map((c) => c.payload),
    [{ role: "student" }],
  );
});

test("updateCourseMemberRole: does not mutate organization membership conceptually", async () => {
  // Org teacher remains org teacher while course role becomes student (AC4/AC5).
  const orgMembership = { org_id: "o1", user_id: "u9", role: "teacher" };
  const sb = makeUpdateClient({
    data: {
      course_id: "course-b",
      user_id: "u9",
      role: "student",
      source: "invite",
      classroom_user_id: null,
      classroom_email: null,
      created_at: "2026-03-01T00:00:00Z",
      synced_at: null,
    },
  });
  const result = await updateCourseMemberRole(sb, {
    courseId: "course-b",
    userId: "u9",
    role: "student",
    actorUserId: "manager-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.role, "student");
  assert.equal(orgMembership.role, "teacher");
  assert.doesNotMatch(apiSrc, /\.from\(\s*["']organization_members["']\s*\)/);
  assert.doesNotMatch(apiSrc, /\.from\(\s*["']profiles["']\s*\)/);
  assert.doesNotMatch(apiSrc, /preferred_role\s*:/);
  assert.match(apiSrc, /\.update\(\s*\{\s*role:\s*nextRole\s*\}\s*\)/);

  const courseA = resolveCourseContext({ orgRole: "teacher", courseRole: "teacher" });
  const courseB = resolveCourseContext({ orgRole: "teacher", courseRole: "student" });
  assert.equal(courseA.mode, "teaching");
  assert.equal(courseB.mode, "studying");
  assert.equal(courseB.capabilities.canManageRoster, false);
});

test("updateCourseMemberRole: blocks self role edit", async () => {
  const sb = makeUpdateClient({
    data: { course_id: "c1", user_id: "me", role: "student", source: "manual" },
  });
  const result = await updateCourseMemberRole(sb, {
    courseId: "c1",
    userId: "me",
    role: "teacher",
    actorUserId: "me",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "cannot_change_own_role");
  assert.equal(sb.calls.some((c) => c.type === "update"), false);
});

test("updateCourseMemberRole: failed mutation is not reported as success", async () => {
  const sb = makeUpdateClient({ error: { message: "permission denied" }, data: null });
  const result = await updateCourseMemberRole(sb, {
    courseId: "c1",
    userId: "u2",
    role: "teacher",
    actorUserId: "manager-1",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
  assert.equal(result.row, null);
});

test("updateCourseMemberRole: empty RLS result is fail-closed", async () => {
  const sb = makeUpdateClient({ data: null, error: null });
  const result = await updateCourseMemberRole(sb, {
    courseId: "c1",
    userId: "u2",
    role: "teacher",
    actorUserId: "manager-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_found_or_forbidden");
});

test("canShowCourseRoleChangeAction: self / pending / unauthorized hidden", () => {
  assert.equal(
    canShowCourseRoleChangeAction({
      memberUserId: "u1",
      actorUserId: "mgr",
      canManageRoster: true,
      isPending: false,
    }),
    true,
  );
  assert.equal(
    canShowCourseRoleChangeAction({
      memberUserId: "mgr",
      actorUserId: "mgr",
      canManageRoster: true,
      isPending: false,
    }),
    false,
  );
  assert.equal(
    canShowCourseRoleChangeAction({
      memberUserId: null,
      actorUserId: "mgr",
      canManageRoster: true,
      isPending: true,
    }),
    false,
  );
  assert.equal(
    canShowCourseRoleChangeAction({
      memberUserId: "u1",
      actorUserId: "mgr",
      canManageRoster: false,
      isPending: false,
    }),
    false,
  );
  assert.equal(canManageRoster({ orgRole: "student", courseRole: "student" }), false);
});

test("CourseRosterTab exposes role change UX with confirmation and preserves flows", () => {
  assert.match(rosterSrc, /pcCourseRoleLabel/);
  assert.match(rosterSrc, /pcCourseRoleChangeToTeacher/);
  assert.match(rosterSrc, /pcCourseRoleChangeToStudent/);
  assert.match(rosterSrc, /pcCourseRolePromoteConfirm/);
  assert.match(rosterSrc, /pcCourseRoleDemoteConfirm/);
  assert.match(rosterSrc, /updateCourseMemberRole/);
  assert.match(rosterSrc, /canShowCourseRoleChangeAction/);
  assert.match(rosterSrc, /RoleChangeConfirmModal/);
  assert.match(rosterSrc, /role="dialog"/);
  assert.match(rosterSrc, /pcCourseRoleChangeError/);
  assert.match(rosterSrc, /await load\(\)/);
  assert.match(rosterSrc, /remove_course_member/);
  assert.match(rosterSrc, /syncClassroomRosterToCourse/);
  assert.match(rosterSrc, /syncClassroomTeachersToCourse/);
  assert.match(rosterSrc, /organization_invites/);
  assert.match(rosterSrc, /list_course_roster_pending/);
  assert.match(rosterSrc, /userId === user\?\.id|actorUserId/);
  assert.doesNotMatch(rosterSrc, /organization_members/);
  assert.doesNotMatch(rosterSrc, /preferred_role/);
});

test("CourseRosterTab: Personas tab remains teaching-only in course page", () => {
  const pageSrc = readFileSync(resolve(root, "src/pages/PyBotClassCoursePage.jsx"), "utf8");
  assert.match(pageSrc, /activeTab === "alumnos" && mode === COURSE_ACCESS_MODES\.TEACHING/);
  assert.match(pageSrc, /CourseRosterTab/);
});

test("course role change i18n keys exist in all languages", () => {
  const keys = [
    "pcCourseRoleLabel",
    "pcCourseRoleChangeToTeacher",
    "pcCourseRoleChangeToStudent",
    "pcCourseRolePromoteConfirm",
    "pcCourseRolePromoteDetail",
    "pcCourseRoleDemoteConfirm",
    "pcCourseRoleDemoteDetail",
    "pcCourseRoleChangedToTeacher",
    "pcCourseRoleChangedToStudent",
    "pcCourseRoleChangeError",
  ];
  for (const lang of Object.keys(PYBOTCLASS_STRINGS)) {
    for (const key of keys) {
      assert.equal(typeof PYBOTCLASS_STRINGS[lang][key], "string", `${lang}.${key}`);
      assert.ok(PYBOTCLASS_STRINGS[lang][key].length > 0, `${lang}.${key}`);
    }
  }
  assert.match(PYBOTCLASS_STRINGS.es.pcCourseRoleLabel, /Rol en este curso/);
  assert.match(PYBOTCLASS_STRINGS.es.pcCourseRoleChangeToTeacher, /Cambiar a Docente/);
  assert.match(PYBOTCLASS_STRINGS.es.pcCourseRoleChangeToStudent, /Cambiar a Alumno/);
});

test("Classroom student sync still protects existing teacher role", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260830000026_course_teacher_permissions.sql"),
    "utf8",
  );
  assert.match(
    sql,
    /role = case\s+when course_members\.role = 'teacher' then 'teacher'\s+else 'student'\s+end/s,
  );
});
