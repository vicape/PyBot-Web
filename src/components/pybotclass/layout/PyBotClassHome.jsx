import { t } from "../../../i18n.js";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { countryNameByCode } from "../../../data/countries.js";
import { computeAccountRoleBadges, computeQuickSummary } from "../../../platform/accountRoles.js";
import { normalizeCourseRole } from "../../../platform/courseRole.js";
import { connectGoogleClassroom } from "../../../platform/googleOAuth.js";
import { getStoredGoogleRefreshToken } from "../../../platform/profileApi.js";
import {
  buildTeacherAttentionItems,
  resolveClassesView,
} from "../../../platform/uxIaHelpers.js";
import {
  CompactContentIcon,
  CompactCreateIcon,
  CompactIdeIcon,
  CompactJoinIcon,
  IconClipboard,
  IconCourseCompact,
  IconGrade,
  IconPeople,
} from "../illustrations/ActionIcons.jsx";
import EmptyCoursesIllustration from "../illustrations/EmptyCoursesIllustration.jsx";
import { GoogleClassroomIcon } from "../illustrations/SidebarIcons.jsx";
import RoleBadges from "./RoleBadges.jsx";

const ROLE_BADGE = {
  teacher: { label: t("pcTeacher"), variant: "purple" },
  student: { label: t("pcStudent"), variant: "teal" },
};

function CourseCards({ filtered, hasStaffAccess, onCreateCourse, onJoinCourse }) {
  if (filtered.length === 0) {
    return (
      <div className="pbc-empty-state">
        <span className="pbc-empty-state__illus" aria-hidden>
          <EmptyCoursesIllustration />
        </span>
        <h3 className="pbc-empty-state__title">{t("pcNoCoursesYet")}</h3>
        <p className="pbc-empty-state__desc">
          {hasStaffAccess ? t("pcNoCoursesStaffDesc") : t("pcNoCoursesStudentDesc")}
        </p>
        <div className="pbc-empty-state__actions">
          {hasStaffAccess ? (
            <button type="button" className="pbc-btn pbc-btn--primary" onClick={onCreateCourse}>
              <span aria-hidden>
                <CompactCreateIcon />
              </span>
              {t("pcCreateCourse")}
            </button>
          ) : null}
          <button
            type="button"
            className={`pbc-btn ${hasStaffAccess ? "pbc-btn--ghost" : "pbc-btn--primary"}`}
            onClick={onJoinCourse}
          >
            <span aria-hidden>
              <CompactJoinIcon />
            </span>
            {t("pcJoinCourse")}
          </button>
          <a href="/" className="pbc-btn pbc-btn--ghost">
            <span aria-hidden>
              <CompactIdeIcon />
            </span>
            {t("pcOpenIde")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="pbc-course-grid">
      {filtered.map((c) => {
        const role = normalizeCourseRole(c.my_course_role);
        const rb = role ? ROLE_BADGE[role] : null;
        const iconTone =
          role === "teacher" ? "teacher" : role === "student" ? "student" : "neutral";
        return (
          <Link key={c.course_id} to={`/dashboard/classes/${c.course_id}`} className="pbc-course-card">
            <div className="pbc-course-card__body">
              <div className="pbc-course-card__lead">
                <span className={`pbc-course-card__icon pbc-course-card__icon--${iconTone}`} aria-hidden>
                  <IconCourseCompact size={20} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="pbc-course-card__title">{c.course_title}</p>
                  <p className="pbc-course-card__meta">{c.org_name || t("pcInstitution")}</p>
                </div>
              </div>
              <div className="pbc-course-card__footer">
                {rb ? <span className={`pbc-badge pbc-badge--${rb.variant}`}>{rb.label}</span> : null}
                {role === "teacher" && c.student_count > 0 ? (
                  <span className="pbc-course-card__stat">
                    {c.student_count} {t("pcTabStudents")}
                  </span>
                ) : null}
                {c.pending_grade_count > 0 ? (
                  <span className="pbc-course-card__stat">
                    {c.pending_grade_count} {t("pcFilterToGrade")}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function attentionLabel(item) {
  if (item.kind === "pending_grades") {
    return t("pcAttentionPendingGrades")
      .replace("{n}", String(item.count))
      .replace("{course}", item.title);
  }
  if (item.kind === "no_students") {
    return t("pcAttentionNoStudents").replace("{course}", item.title);
  }
  if (item.kind === "no_activities") {
    return t("pcAttentionNoActivities").replace("{course}", item.title);
  }
  return item.title;
}

function attentionCta(kind) {
  if (kind === "no_students") return t("pcAddStudents");
  if (kind === "no_activities") return t("pcCreateActivity");
  if (kind === "pending_grades") return t("pcGrade");
  return null;
}

function AttentionIcon({ kind }) {
  if (kind === "no_students") return <IconPeople size={18} />;
  if (kind === "no_activities") return <IconClipboard size={18} />;
  if (kind === "pending_grades") return <IconGrade size={18} />;
  return <IconCourseCompact size={18} />;
}

function MetricIcon({ id }) {
  if (id === "students" || id === "student") return <IconPeople size={18} />;
  if (id === "activities") return <IconClipboard size={18} />;
  if (id === "pending") return <IconGrade size={18} />;
  return <IconCourseCompact size={18} />;
}

function MetricsRow({ summary }) {
  if (!summary.length) return null;
  return (
    <section className="pbc-metrics" aria-label={t("pcQuickSummary")}>
      {summary.map((s) => (
        <div
          key={s.id}
          className={`pbc-metric-card${s.highlight ? " pbc-metric-card--highlight" : ""}`}
        >
          <span className="pbc-metric-card__icon" aria-hidden>
            <MetricIcon id={s.id} />
          </span>
          <span className="pbc-metric-card__body">
            <span className="pbc-metric-card__value">{s.value}</span>
            <span className="pbc-metric-card__label">{s.label}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

export default function PyBotClassHome({
  user,
  orgs = [],
  courses = [],
  isSuperAdmin = false,
  hasStaffAccess = false,
  onCreateCourse,
  onJoinCourse,
  classesView = "home",
}) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("");
  const [classroomLinked, setClassroomLinked] = useState(null);
  const location = useLocation();

  const view = classesView || resolveClassesView({
    view: new URLSearchParams(location.search).get("view"),
    hash: location.hash,
  });
  const isCoursesView = view === "courses";

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !hasStaffAccess) {
      setClassroomLinked(false);
      return undefined;
    }
    void getStoredGoogleRefreshToken(user.id).then((stored) => {
      if (cancelled) return;
      setClassroomLinked(
        !!(stored?.classroom_linked_at || stored?.google_refresh_token || stored?.google_token_expires_at),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, hasStaffAccess]);

  useEffect(() => {
    const content = document.querySelector(".pbc-dashboard__content");
    if (location.pathname !== "/dashboard/classes") return;
    content?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo(0, 0);
  }, [location.pathname, location.search, isCoursesView]);

  const meta = user?.user_metadata || {};
  const firstName =
    (meta.full_name || meta.name || user?.email?.split("@")[0] || t("pcUser")).split(" ")[0];

  const orgMemberships = useMemo(
    () =>
      orgs.map((o) => ({
        id: o.org_id || o.id,
        name: o.org_name || o.name,
        role: o.role,
        country_code: o.country_code,
      })),
    [orgs],
  );

  const badges = useMemo(
    () =>
      computeAccountRoleBadges({
        orgs: orgMemberships,
        courses,
        isSuperAdmin,
      }).map((b) => ({
        ...b,
        label:
          b.id === "gestion"
            ? t("pcManagement")
            : b.id === "docente"
              ? t("pcTeacher")
              : b.id === "alumno"
                ? t("pcStudent")
                : b.label,
      })),
    [orgMemberships, courses, isSuperAdmin],
  );

  const summary = useMemo(
    () =>
      computeQuickSummary({ courses, isSuperAdmin }).map((s) => ({
        ...s,
        label:
          s.id === "courses"
            ? t("pcCourses")
            : s.id === "teacher"
              ? t("pcAsTeacher")
              : s.id === "student"
                ? t("pcAsStudent")
                : s.id === "pending"
                  ? t("pcFilterToGrade")
                  : s.id === "students"
                    ? t("pcStudentsYourCourses")
                    : s.id === "activities"
                      ? t("pcActivities")
                      : s.label,
      })),
    [courses, isSuperAdmin],
  );

  const filtered = useMemo(() => {
    let rows = courses;
    if (roleFilter === "teacher") {
      rows = rows.filter((c) => normalizeCourseRole(c.my_course_role) === "teacher");
    }
    if (roleFilter === "student") {
      rows = rows.filter((c) => normalizeCourseRole(c.my_course_role) === "student");
    }
    if (orgFilter) rows = rows.filter((c) => c.org_id === orgFilter);
    return rows;
  }, [courses, roleFilter, orgFilter]);

  const attentionItems = useMemo(
    () => (hasStaffAccess ? buildTeacherAttentionItems(courses) : []),
    [courses, hasStaffAccess],
  );

  const recentCourses = useMemo(() => {
    const teaching = courses.filter((c) => normalizeCourseRole(c.my_course_role) === "teacher");
    const studying = courses.filter((c) => normalizeCourseRole(c.my_course_role) === "student");
    const pool = hasStaffAccess ? (teaching.length ? teaching : courses) : studying.length ? studying : courses;
    return pool.slice(0, 6);
  }, [courses, hasStaffAccess]);

  const primaryCountry = orgMemberships.find((o) => o.country_code)?.country_code;
  const onClassroomConnect = () => {
    void connectGoogleClassroom("/dashboard/classes", { mode: "teacher" });
  };

  const classroomStatusLabel =
    classroomLinked == null ? "…" : classroomLinked ? t("pcLinked") : t("pcNotLinked");

  if (isCoursesView) {
    return (
      <div className="pbc-home pbc-home--courses-view">
        <div className="pbc-home__main" style={{ gridColumn: "1 / -1" }}>
          <header className="pbc-hero-block">
            <div className="pbc-hero-block__text">
              <h1 className="pbc-hero-block__title">{t("pcCourses")}</h1>
              <p className="pbc-hero-block__subtitle">{t("pcCoursesViewLead")}</p>
            </div>
            <div className="pbc-hero-block__actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {hasStaffAccess ? (
                <button type="button" className="pbc-btn pbc-btn--primary" onClick={onCreateCourse}>
                  <span aria-hidden>
                    <CompactCreateIcon />
                  </span>
                  {t("pcCreateCourse")}
                </button>
              ) : null}
              <button
                type="button"
                className={`pbc-btn ${hasStaffAccess ? "pbc-btn--ghost" : "pbc-btn--primary"}`}
                onClick={onJoinCourse}
              >
                <span aria-hidden>
                  <CompactJoinIcon />
                </span>
                {t("pcJoinCourse")}
              </button>
            </div>
          </header>

          <section id="mis-cursos" aria-labelledby="courses-heading">
            <div className="pbc-section-head">
              <h2 id="courses-heading" className="pbc-section-head__title">
                {t("pcMyCourses")}
              </h2>
              {orgMemberships.length > 1 ? (
                <select
                  className="pbc-select"
                  style={{ width: "auto", minWidth: "160px" }}
                  value={orgFilter}
                  onChange={(e) => setOrgFilter(e.target.value)}
                  aria-label={t("pcFilterInstitution")}
                >
                  <option value="">{t("pcAllInstitutions")}</option>
                  {orgMemberships.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="pbc-filter-tabs" role="tablist" aria-label={t("pcFilterByRole")}>
              {[
                { id: "all", label: t("pcAll") },
                { id: "teacher", label: t("pcTeacher") },
                { id: "student", label: t("pcStudent") },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={roleFilter === tab.id}
                  className={`pbc-filter-tab${roleFilter === tab.id ? " pbc-filter-tab--active" : ""}`}
                  onClick={() => setRoleFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <CourseCards
              filtered={filtered}
              hasStaffAccess={hasStaffAccess}
              onCreateCourse={onCreateCourse}
              onJoinCourse={onJoinCourse}
            />
          </section>
        </div>
      </div>
    );
  }

  // ── HOME (situation center) ──────────────────────────────────────────────
  return (
    <div className="pbc-home">
      <div className="pbc-home__main">
        <header className="pbc-hero-block">
          <div className="pbc-hero-block__text">
            <h1 className="pbc-hero-block__title">
              {t("pcHello")}, {firstName}
            </h1>
            <p className="pbc-hero-block__subtitle">{t("pcHomeLead")}</p>
          </div>
          <div className="pbc-hero-block__actions">
            {hasStaffAccess ? (
              <button type="button" className="pbc-btn pbc-btn--primary" onClick={onCreateCourse}>
                <span aria-hidden>
                  <CompactCreateIcon />
                </span>
                {t("pcCreateCourse")}
              </button>
            ) : null}
            <a href="/" className="pbc-btn pbc-btn--ghost">
              <span aria-hidden>
                <CompactIdeIcon />
              </span>
              {t("pcOpenIde")}
            </a>
            {hasStaffAccess ? (
              <button
                type="button"
                className={`pbc-classroom-status${
                  classroomLinked ? " pbc-classroom-status--on" : " pbc-classroom-status--off"
                }`}
                onClick={onClassroomConnect}
                title={
                  classroomLinked
                    ? t("pcClassroomLinkedReauth")
                    : t("pcClassroomNotLinkedClick")
                }
                aria-label={
                  classroomLinked
                    ? t("pcClassroomLinkedReauthLabel")
                    : t("pcLinkClassroom")
                }
              >
                <span className="pbc-classroom-status__icon" aria-hidden>
                  <GoogleClassroomIcon />
                </span>
                <span className="pbc-classroom-status__meta">
                  <span className="pbc-classroom-status__name">{t("pcIntegrationOptional")}</span>
                  <span className="pbc-classroom-status__state">
                    <span className="pbc-classroom-status__dot" aria-hidden />
                    {classroomStatusLabel}
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        </header>

        <MetricsRow summary={summary} />

        <div className="pbc-action-grid">
          {hasStaffAccess ? (
            <button type="button" className="pbc-action-card pbc-action-card--create" onClick={onCreateCourse}>
              <span className="pbc-action-card__icon pbc-action-card__icon--blue" aria-hidden>
                <CompactCreateIcon />
              </span>
              <span className="pbc-action-card__body">
                <span className="pbc-action-card__title">{t("pcCreateCourse")}</span>
                <span className="pbc-action-card__desc">{t("pcActionCreateCourseHint")}</span>
              </span>
            </button>
          ) : null}

          {hasStaffAccess ? (
            <Link to="/dashboard/content" className="pbc-action-card pbc-action-card--content">
              <span className="pbc-action-card__icon" aria-hidden>
                <CompactContentIcon />
              </span>
              <span className="pbc-action-card__body">
                <span className="pbc-action-card__title">{t("pcCreateContent")}</span>
                <span className="pbc-action-card__desc">{t("pcActionCreateContentHint")}</span>
              </span>
            </Link>
          ) : null}

          <button type="button" className="pbc-action-card pbc-action-card--join" onClick={onJoinCourse}>
            <span className="pbc-action-card__icon pbc-action-card__icon--violet" aria-hidden>
              <CompactJoinIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcJoinCourse")}</span>
              <span className="pbc-action-card__desc">{t("pcActionJoinCourseHint")}</span>
            </span>
          </button>

          <a href="/" className="pbc-action-card pbc-action-card--ide">
            <span className="pbc-action-card__icon pbc-action-card__icon--indigo" aria-hidden>
              <CompactIdeIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcOpenIde")}</span>
              <span className="pbc-action-card__desc">{t("pcActionOpenIdeHint")}</span>
            </span>
          </a>
        </div>

        {hasStaffAccess && attentionItems.length > 0 ? (
          <section className="pbc-attention" aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="pbc-section-head__title">
              {t("pcNeedsAttention")}
            </h2>
            <ul className="pbc-attention__list">
              {attentionItems.slice(0, 8).map((item) => {
                const cta = attentionCta(item.kind);
                return (
                  <li key={item.id}>
                    <Link to={item.href} className="pbc-attention__item">
                      <span className={`pbc-attention__icon pbc-attention__icon--${item.kind}`} aria-hidden>
                        <AttentionIcon kind={item.kind} />
                      </span>
                      <span className="pbc-attention__body">
                        <span className="pbc-attention__label">{attentionLabel(item)}</span>
                        {cta ? <span className="pbc-attention__cta">{cta}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="pbc-recent-courses" aria-labelledby="recent-courses-heading">
          <div className="pbc-section-head">
            <h2 id="recent-courses-heading" className="pbc-section-head__title">
              {t("pcRecentCourses")}
            </h2>
            <Link to="/dashboard/classes?view=courses" className="pbc-btn pbc-btn--ghost pbc-btn--sm">
              {t("pcViewAllCourses")}
            </Link>
          </div>
          <CourseCards
            filtered={recentCourses}
            hasStaffAccess={hasStaffAccess}
            onCreateCourse={onCreateCourse}
            onJoinCourse={onJoinCourse}
          />
        </section>
      </div>

      <aside className="pbc-home__aside">
        <div className="pbc-panel-card">
          <h3 className="pbc-panel-card__title">{t("pcMyAccount")}</h3>
          {primaryCountry ? (
            <p className="pbc-account-card__email" style={{ marginTop: 0 }}>
              {countryNameByCode(primaryCountry)}
            </p>
          ) : null}
          <RoleBadges badges={badges} />
          <Link
            to="/dashboard/classes?panel=account"
            className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-panel-card__action"
          >
            {t("pcAccount")}
          </Link>
        </div>
      </aside>
    </div>
  );
}
