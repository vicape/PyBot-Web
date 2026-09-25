/**
 * UX polish second-pass: desktop nav, attention CTAs, content actions, community search.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";

const root = resolve(import.meta.dirname, "..");
const cssSrc = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");
const themeCss = readFileSync(resolve(root, "src/styles/dashboard-theme.css"), "utf8");
const homeSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassHome.jsx"),
  "utf8",
);
const contentCardSrc = readFileSync(
  resolve(root, "src/components/pybotclass/content/ContentCard.jsx"),
  "utf8",
);
const communitySrc = readFileSync(resolve(root, "src/pages/CommunityPage.jsx"), "utf8");
const actionIconsSrc = readFileSync(
  resolve(root, "src/components/pybotclass/illustrations/ActionIcons.jsx"),
  "utf8",
);
const sidebarIconsSrc = readFileSync(
  resolve(root, "src/components/pybotclass/illustrations/SidebarIcons.jsx"),
  "utf8",
);
const layoutSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassLayout.jsx"),
  "utf8",
);
const topbarSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassTopbar.jsx"),
  "utf8",
);
const sidebarLayoutSrc = readFileSync(
  resolve(root, "src/components/pybotclass/layout/PyBotClassSidebar.jsx"),
  "utf8",
);

test("desktop sidebar toggleable via hamburger ≥961px; no overlay", () => {
  // Exact desktop breakpoint literal required by acceptance: >= 961px
  assert.ok(cssSrc.includes(">= 961px"));
  assert.match(cssSrc, /@media \(min-width:\s*961px\)/);
  assert.match(cssSrc, /position:\s*static/);
  // Hamburger remains available on desktop (toggle)
  assert.doesNotMatch(cssSrc, /\.pbc-topbar__menu-btn\s*\{\s*display:\s*none/);
  // Closed desktop sidebar collapses width so main expands
  assert.match(cssSrc, /\.pbc-sidebar:not\(\.pbc-sidebar--open\)\s*\{[^}]*width:\s*0/s);
  // Overlay never shows on desktop
  assert.match(cssSrc, /\.pbc-dashboard__overlay(?:--open)?,\s*\n\s*\.pbc-dashboard__overlay--open\s*\{[^}]*display:\s*none\s*!important/s);
  // Drawer remains the default (mobile/tablet) via translateX(-100%)
  assert.match(cssSrc, /transform:\s*translateX\(-100%\)/);
});

test("PyBotClass sidebar hamburger is a real toggle with a11y wiring", () => {
  // Exact desktop breakpoint literal required by acceptance: >= 961px
  assert.ok(layoutSrc.includes(">= 961px"));
  assert.match(layoutSrc, /min-width:\s*961px/);
  assert.match(layoutSrc, /onMenuToggle=\{\(\) => setSidebarOpen\(\(open\) => !open\)\}/);
  assert.match(layoutSrc, /isDesktopViewport\(\)/);
  assert.match(layoutSrc, /PBC_SIDEBAR_ID/);
  assert.match(layoutSrc, /Escape/);
  assert.match(topbarSrc, /aria-expanded=\{sidebarOpen\}/);
  assert.match(topbarSrc, /aria-controls=\{sidebarId\}/);
  assert.match(topbarSrc, /aria-label=\{sidebarOpen \? t\("pcCloseMenu"\) : t\("pcOpenMenu"\)\}/);
  assert.match(topbarSrc, /type="button"/);
  assert.match(sidebarLayoutSrc, /id=\{id\}/);
  assert.match(sidebarLayoutSrc, /id = "pbc-sidebar"/);
  assert.equal(PYBOTCLASS_STRINGS.en.pcOpenMenu, "Open menu");
  assert.equal(PYBOTCLASS_STRINGS.en.pcCloseMenu, "Close menu");
});

test("Home attention items expose semantic icon + text CTA", () => {
  assert.match(homeSrc, /AttentionIcon/);
  assert.match(homeSrc, /pcAddStudents/);
  assert.match(homeSrc, /pcCreateActivity/);
  assert.match(homeSrc, /pcGrade/);
  assert.match(homeSrc, /IconPeople|IconClipboard|IconGrade/);
  assert.match(homeSrc, /pbc-attention__cta/);
});

test("Home quick actions are compact icon+label; no orphan Courses mega-card", () => {
  assert.match(homeSrc, /CompactCreateIcon/);
  assert.match(homeSrc, /CompactContentIcon/);
  assert.match(homeSrc, /CompactJoinIcon/);
  assert.match(homeSrc, /CompactIdeIcon/);
  assert.match(homeSrc, /pcCreateCourse/);
  assert.match(homeSrc, /pcCreateContent/);
  assert.match(homeSrc, /pcJoinCourse/);
  assert.match(homeSrc, /pcOpenIde/);
  assert.doesNotMatch(homeSrc, /pbc-action-card__illus/);
  assert.doesNotMatch(homeSrc, /CreateCourseIllustration/);
  assert.doesNotMatch(homeSrc, /JoinCourseIllustration/);
  assert.doesNotMatch(homeSrc, /IdeIllustration/);
  assert.doesNotMatch(homeSrc, /import CoursesIllustration/);
  assert.match(cssSrc, /\.pbc-action-card\s*\{[\s\S]*flex-direction:\s*row/);
});

test("Home does not duplicate topbar identity name/email", () => {
  assert.doesNotMatch(homeSrc, /pbc-account-card__name/);
  assert.doesNotMatch(homeSrc, /pbc-account-card__avatar/);
  assert.match(homeSrc, /RoleBadges/);
});

test("Course cards use SVG course icon, not emoji headers", () => {
  assert.match(homeSrc, /IconCourseCompact/);
  assert.doesNotMatch(homeSrc, /📘|📗/);
  assert.match(cssSrc, /\.pbc-course-card__header\s*\{\s*display:\s*none/);
});

test("Content cards expose Abrir + Asignar directly when assignable", () => {
  assert.match(contentCardSrc, /showDirectAssign/);
  assert.match(contentCardSrc, /IconOpen/);
  assert.match(contentCardSrc, /IconAssign/);
  assert.match(contentCardSrc, /pcOpen/);
  assert.match(contentCardSrc, /pcAssign/);
  assert.match(contentCardSrc, /pbc-content-card__direct-actions/);
});

test("Content status/sharing badges use icon + visible text labels", () => {
  assert.match(contentCardSrc, /IconDraft|IconPublished/);
  assert.match(contentCardSrc, /IconSharedCommunity|IconSharedCourses|IconLock/);
  assert.match(contentCardSrc, /pbc-badge--with-icon/);
  assert.match(contentCardSrc, /pcPublished|pcDraft/);
  assert.match(contentCardSrc, /pcSharedInCommunity|pcSharedToCourses|pcPrivate/);
  // Status must not be icon-only
  assert.match(contentCardSrc, /content\.status === "published" \? t\("pcPublished"\) : t\("pcDraft"\)/);
});

test("Content usage unavailable is muted, not emphasized", () => {
  assert.match(contentCardSrc, /pcUsageUnavailable/);
  assert.match(contentCardSrc, /pbc-content-card__usage--muted/);
  assert.match(contentCardSrc, /if \(unavailable\)/);
});

test("Community hides unrelated course search; keeps community search + empty CTA", () => {
  assert.match(communitySrc, /hideSearch/);
  assert.match(communitySrc, /pcCommunitySearchLabel/);
  assert.match(communitySrc, /pcCommunityEmptyTitle/);
  assert.match(communitySrc, /pcGoToContent/);
  assert.match(communitySrc, /\/dashboard\/content/);
  assert.match(communitySrc, /IconCommunityEmpty|CompactContentIcon/);
});

test("Institution select reads as enabled interactive control", () => {
  assert.match(themeCss, /\.pbc-dashboard\s+\.pbc-select/);
  assert.match(themeCss, /cursor:\s*pointer/);
  assert.match(homeSrc, /pcFilterInstitution/);
});

test("Icon system uses currentColor SVG + aria-hidden decorative pattern", () => {
  assert.match(actionIconsSrc, /currentColor/);
  assert.match(actionIconsSrc, /aria-hidden/);
  assert.match(sidebarIconsSrc, /currentColor/);
  assert.doesNotMatch(actionIconsSrc, /from ["']lucide|react-icons|@heroicons/);
  // Content cards stay in ActionIcons language (no SidebarIcons mix for badges)
  assert.doesNotMatch(contentCardSrc, /from ["'].*SidebarIcons/);
  assert.match(contentCardSrc, /IconSharedCommunity|IconSharedCourses|IconContentType/);
});

test("Primary/secondary actions use icon + text labels (not icon-only)", () => {
  assert.match(contentCardSrc, /IconOpen[\s\S]*pcOpen/);
  assert.match(contentCardSrc, /IconAssign[\s\S]*pcAssign/);
  assert.match(contentCardSrc, /IconShare[\s\S]*pcManageSharing/);
  assert.match(contentCardSrc, /IconCopy[\s\S]*pcCreateCopy/);
  assert.match(contentCardSrc, /IconEdit[\s\S]*pcEdit/);
  assert.match(homeSrc, /CompactCreateIcon[\s\S]*pcCreateCourse/);
  assert.match(homeSrc, /IconPeople[\s\S]*|pcAddStudents/);
  assert.match(communitySrc, /IconOpen[\s\S]*pcRead|IconCopy[\s\S]*pcCreateCopy/);
});

test("Role-safe: teacher create/attention gated; assign gated by canAssign", () => {
  assert.match(homeSrc, /hasStaffAccess && attentionItems/);
  assert.match(homeSrc, /\{hasStaffAccess \? \([\s\S]*pcCreateCourse/);
  assert.match(contentCardSrc, /canAssign && Boolean\(onAssign\)/);
});

test("Refined surfaces avoid horizontal clip: min-width 0 / wrap / max-width 100%", () => {
  assert.match(cssSrc, /\.pbc-content-card__direct-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(cssSrc, /\.pbc-content-card__direct-actions\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(cssSrc, /\.pbc-action-card__body\s*\{[\s\S]*min-width:\s*0/);
  assert.match(communitySrc, /maxWidth:\s*"100%"/);
  assert.match(communitySrc, /flexWrap:\s*"wrap"/);
});

test("New polish i18n keys present in all languages", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    for (const key of ["pcGrade", "pcCommunityEmptyTitle", "pcGoToContent"]) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key} empty`);
    }
  }
  assert.equal(PYBOTCLASS_STRINGS.es.pcGrade, "Corregir");
  assert.equal(PYBOTCLASS_STRINGS.es.pcGoToContent, "Ir a Contenido");
});
