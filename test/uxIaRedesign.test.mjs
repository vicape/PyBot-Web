/**
 * UX/IA redesign PRE_QA focused tests (Norman/Nielsen navigation + flows).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PRIMARY_NAV_IDS,
  buildTeacherAttentionItems,
  mapClassroomSyncUserError,
  ownedContentShareState,
  resolveClassesView,
  resolveCourseNextStep,
  resolveCoursePrepGuide,
  shouldAutoCreateInviteOnNavigate,
} from "../src/platform/uxIaHelpers.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";
import { UI_THEMES } from "../src/platform/appearanceApi.js";

const root = resolve(import.meta.dirname, "..");
const sidebarSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassSidebar.jsx"),
  "utf8",
);
const homeSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassHome.jsx"),
  "utf8",
);
const pageSrc = readFileSync(resolve(root, "src/pages/PyBotClassPage.jsx"), "utf8");
const coursePageSrc = readFileSync(resolve(root, "src/pages/PyBotClassCoursePage.jsx"), "utf8");
const summarySrc = readFileSync(
  resolve(root, "src/components/pybotclass/CourseSummaryTab.jsx"),
  "utf8",
);
const rosterSrc = readFileSync(
  resolve(root, "src/components/pybotclass/CourseRosterTab.jsx"),
  "utf8",
);
const contentPageSrc = readFileSync(resolve(root, "src/pages/MyContentPage.jsx"), "utf8");
const contentCardSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/ContentCard.jsx"),
  "utf8",
);
const communitySrc = readFileSync(resolve(root, "src/pages/CommunityPage.jsx"), "utf8");
const topbarSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassTopbar.jsx"),
  "utf8",
);
const appearanceSrc = readFileSync(resolve(root, "src/platform/appearanceApi.js"), "utf8");
const cssSrc = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");

const NEW_I18N = [
  "pcNavContent",
  "pcDailyNav",
  "pcHomeLead",
  "pcCoursesViewLead",
  "pcNeedsAttention",
  "pcCreateActivity",
  "pcAddStudents",
  "pcAssignContent",
  "pcNextStepAddStudents",
  "pcNextStepFirstActivity",
  "pcNextStepGradePending",
  "pcPrepareCourse",
  "pcInviteWithPyBot",
  "pcInviteWithClassroom",
  "pcGenerateInvite",
  "pcCodeCopied",
  "pcLinkCopied",
  "pcClassroomOptionalHint",
  "pcCommunityExternalLead",
  "pcAssignToCourseIntent",
  "pcUsageUnavailable",
  "pcSharedToCourses",
  "pcContentEmptyTitle",
  "pcActivitiesEmptyTitle",
  "pcStudentsEmptyTitle",
];

test("AC1: primary daily sidebar ids are exactly Inicio/Cursos/Contenido/Comunidad/IDE", () => {
  assert.deepEqual([...PRIMARY_NAV_IDS], ["home", "courses", "content", "community", "ide"]);
  assert.match(sidebarSrc, /DAILY_NAV/);
  assert.match(sidebarSrc, /pcHome/);
  assert.match(sidebarSrc, /pcCourses/);
  assert.match(sidebarSrc, /pcNavContent/);
  assert.match(sidebarSrc, /pcCommunity/);
  assert.match(sidebarSrc, /pcOpenIde/);
  assert.doesNotMatch(sidebarSrc, /id: "classroom"/);
  assert.doesNotMatch(sidebarSrc, /id: "account"/);
  assert.doesNotMatch(sidebarSrc, /panel=classroom/);
});

test("AC2: administration grouping includes Institutions + SuperAdmin when authorized", () => {
  assert.match(sidebarSrc, /pcAdministration/);
  assert.match(sidebarSrc, /pcInstitutions/);
  assert.match(sidebarSrc, /pcSuperAdminPanel/);
  assert.match(sidebarSrc, /showAdminSection/);
  assert.match(sidebarSrc, /\/dashboard\?tab=schools/);
  assert.match(sidebarSrc, /\/dashboard\/admin/);
});

test("AC3: Account reachable from topbar profile, not primary daily nav", () => {
  assert.match(topbarSrc, /accountHref/);
  assert.match(topbarSrc, /panel=account/);
  assert.match(topbarSrc, /pbc-topbar__account-link/);
  assert.doesNotMatch(sidebarSrc, /panel=account/);
});

test("AC4: Classroom removed from primary nav; course Integrations remains canonical", () => {
  assert.doesNotMatch(sidebarSrc, /showClassroom/);
  assert.match(coursePageSrc, /tab=integraciones|goIntegrations|integraciones/);
  assert.match(pageSrc, /panel === "classroom"/);
});

test("AC5: Home vs Courses + #mis-cursos compatibility", () => {
  assert.equal(resolveClassesView({}), "home");
  assert.equal(resolveClassesView({ view: "courses" }), "courses");
  assert.equal(resolveClassesView({ hash: "#mis-cursos" }), "courses");
  assert.match(pageSrc, /resolveClassesView/);
  assert.match(pageSrc, /#mis-cursos/);
  assert.match(pageSrc, /view", "courses"/);
  assert.match(sidebarSrc, /view=courses/);
  assert.match(homeSrc, /isCoursesView|classesView/);
});

test("AC6/AC7: role-aware Home attention + student hides teacher create actions", () => {
  const items = buildTeacherAttentionItems([
    {
      course_id: "c1",
      course_title: "Maker Y7",
      my_course_role: "teacher",
      student_count: 0,
      activity_count: 0,
      pending_grade_count: 0,
    },
    {
      course_id: "c2",
      course_title: "Python Y8",
      my_course_role: "teacher",
      student_count: 3,
      activity_count: 0,
      pending_grade_count: 0,
    },
    {
      course_id: "c3",
      course_title: "Robótica",
      my_course_role: "teacher",
      student_count: 5,
      activity_count: 2,
      pending_grade_count: 7,
    },
    {
      course_id: "c4",
      course_title: "Alumno",
      my_course_role: "student",
      student_count: 0,
      activity_count: 0,
      pending_grade_count: 9,
    },
  ]);
  assert.equal(items.some((i) => i.kind === "no_students" && i.courseId === "c1"), true);
  assert.equal(items.some((i) => i.kind === "no_activities" && i.courseId === "c2"), true);
  assert.equal(items.some((i) => i.kind === "pending_grades" && i.count === 7), true);
  assert.equal(items.some((i) => i.courseId === "c4"), false);
  assert.match(homeSrc, /hasStaffAccess/);
  assert.match(homeSrc, /pcCreateCourse/);
  // Create course button gated by hasStaffAccess
  assert.match(homeSrc, /\{hasStaffAccess \? \([\s\S]*pcCreateCourse/);
});

test("AC8–AC10: course contextual shortcuts reuse canonical flows", () => {
  assert.match(coursePageSrc, /goCreateActivity/);
  assert.match(coursePageSrc, /action: "create"/);
  assert.match(coursePageSrc, /goAddStudents/);
  assert.match(coursePageSrc, /focus: "invite"/);
  assert.match(coursePageSrc, /assignToCourse=/);
  assert.match(coursePageSrc, /goSubmissions/);
  assert.match(coursePageSrc, /pbc-course-quick-actions/);
  assert.match(coursePageSrc, /canTeach \?/);
});

test("AC11/AC12: Summary next-step priority + non-blocking prep guide", () => {
  assert.equal(resolveCourseNextStep({ student_count: 0, activity_count: 0, pending_grade_count: 5 })?.kind, "add_students");
  assert.equal(resolveCourseNextStep({ student_count: 2, activity_count: 0, pending_grade_count: 5 })?.kind, "first_activity");
  assert.equal(resolveCourseNextStep({ student_count: 2, activity_count: 1, pending_grade_count: 3 })?.kind, "grade_pending");
  assert.equal(resolveCourseNextStep({ student_count: 2, activity_count: 1, pending_grade_count: 0 }), null);

  const early = resolveCoursePrepGuide({ student_count: 0, activity_count: 0, submission_count: 0 });
  assert.equal(early.established, false);
  assert.equal(early.steps[0].done, true);
  assert.equal(early.steps[1].done, false);

  const established = resolveCoursePrepGuide({ student_count: 1, activity_count: 1, submission_count: 1 });
  assert.equal(established.established, true);
  assert.equal(established.steps.length, 0);

  assert.match(summarySrc, /resolveCourseNextStep/);
  assert.match(summarySrc, /resolveCoursePrepGuide/);
  assert.match(summarySrc, /pcNextStepAddStudents/);
});

test("AC13–AC17: Students invite UX — no auto-create; code/link after generate; Classroom optional", () => {
  assert.equal(shouldAutoCreateInviteOnNavigate(), false);
  assert.match(rosterSrc, /shouldAutoCreateInviteOnNavigate/);
  assert.match(rosterSrc, /pcInviteWithPyBot/);
  assert.match(rosterSrc, /pcInviteWithClassroom/);
  assert.match(rosterSrc, /pcClassroomOptionalHint/);
  assert.match(rosterSrc, /pcGenerateInvite/);
  assert.match(rosterSrc, /setInviteCode/);
  assert.match(rosterSrc, /pcCopyCode/);
  assert.match(rosterSrc, /pcCopyLink/);
  assert.match(rosterSrc, /pcCodeCopied/);
  assert.match(rosterSrc, /pcLinkCopied/);
  assert.doesNotMatch(rosterSrc, /useEffect\(\(\) => \{\s*void generateInvite/);
  assert.match(rosterSrc, /organization_invites/);
  assert.match(rosterSrc, /list_course_members/);
  assert.match(rosterSrc, /list_course_roster_pending/);
});

test("AC18–AC23: Content canonical owned home; Community external-only", () => {
  assert.match(contentPageSrc, /getMyContentUsageMetrics/);
  assert.match(contentPageSrc, /usageUnavailable/);
  assert.match(contentCardSrc, /pcUsageUnavailable/);
  assert.match(contentPageSrc, /assignToCourse/);
  assert.match(contentPageSrc, /pcAssignToCourseIntent/);
  assert.match(contentPageSrc, /listMyContents/);
  assert.equal(ownedContentShareState("private"), "private");
  assert.equal(ownedContentShareState("courses"), "courses");
  assert.equal(ownedContentShareState("community"), "community");

  assert.match(communitySrc, /listCommunityContents/);
  assert.match(communitySrc, /excludeOwnerId:\s*user\?\.id/);
  assert.match(communitySrc, /pcCommunityExternalLead/);
  assert.doesNotMatch(communitySrc, /VIEW_MINE|listMyContents|ShareContentModal|pcCommunityTabMine/);
  assert.match(communitySrc, /pcCreateCopy/);
  assert.match(communitySrc, /pcAssignAsIs/);
  assert.match(communitySrc, /pcRead/);
});

test("AC24–AC26: actionable empty states + error mapping without raw codes", () => {
  assert.match(homeSrc, /pcNoCoursesYet/);
  assert.match(contentPageSrc, /pcContentEmptyTitle/);
  assert.equal(mapClassroomSyncUserError({ code: "missing_access_token" }).kind, "reconnect");
  assert.match(rosterSrc, /pcClassroomSyncNeedReconnect/);
  assert.match(rosterSrc, /mapClassroomSyncUserError/);
  // Raw code may exist in catch mapping, but must not be shown as user-facing copy.
  assert.doesNotMatch(rosterSrc, /t\(["']missing_access_token["']\)/);
  assert.doesNotMatch(rosterSrc, />\s*missing_access_token/);
});

test("AC28: System/Light/Dark themes preserved", () => {
  assert.deepEqual([...UI_THEMES], ["system", "light", "dark"]);
  assert.match(appearanceSrc, /system/);
  assert.match(appearanceSrc, /light/);
  assert.match(appearanceSrc, /dark/);
  assert.match(topbarSrc, /UI_THEMES/);
  assert.match(topbarSrc, /pcThemeSystem/);
});

test("AC29: responsive helpers for quick actions / wrap", () => {
  assert.match(cssSrc, /pbc-course-quick-actions/);
  assert.match(cssSrc, /flex-wrap:\s*wrap/);
  assert.match(cssSrc, /max-width:\s*430px/);
  assert.match(cssSrc, /overflow-wrap:\s*anywhere/);
});

test("AC31: new UX strings present in all supported languages", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    assert.ok(bag, `missing lang ${lang}`);
    for (const key of NEW_I18N) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key} empty`);
    }
  }
  assert.equal(PYBOTCLASS_STRINGS.es.pcNavContent, "Contenido");
  assert.equal(PYBOTCLASS_STRINGS.es.pcCourses, "Cursos");
});

test("AC33: deep-link routes remain referenced", () => {
  assert.match(pageSrc, /\/dashboard\/classes/);
  assert.match(pageSrc, /panel=account|panel === "account"/);
  assert.match(contentPageSrc, /\/dashboard\/content/);
  assert.match(communitySrc, /\/dashboard\/community/);
  assert.match(rosterSrc, /\/join\?code=/);
});
