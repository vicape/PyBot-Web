import { t } from "../../../i18n.js";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { countryNameByCode } from "../../../data/countries.js";
import { computeAccountRoleBadges, computeQuickSummary } from "../../../platform/accountRoles.js";
import { normalizeCourseRole } from "../../../platform/courseRole.js";
import { connectGoogleClassroom } from "../../../platform/googleOAuth.js";
import { getStoredGoogleRefreshToken } from "../../../platform/profileApi.js";
import {
  CoursesActionIcon,
  CreateCourseActionIcon,
  IdeActionIcon,
  JoinCourseActionIcon,
} from "../illustrations/ActionCardIcons.jsx";
import CoursesIllustration from "../illustrations/CoursesIllustration.jsx";
import CreateCourseIllustration from "../illustrations/CreateCourseIllustration.jsx";
import EmptyCoursesIllustration from "../illustrations/EmptyCoursesIllustration.jsx";
import IdeIllustration from "../illustrations/IdeIllustration.jsx";
import JoinCourseIllustration from "../illustrations/JoinCourseIllustration.jsx";
import { GoogleClassroomIcon } from "../illustrations/SidebarIcons.jsx";
import RoleBadges from "./RoleBadges.jsx";

const ROLE_BADGE = {
  teacher: { label: t("pcTeacher"), variant: "purple" },
  student: { label: t("pcStudent"), variant: "teal" },
};

export default function PyBotClassHome({
  user,
  orgs = [],
  courses = [],
  isSuperAdmin = false,
  hasStaffAccess = false,
  onCreateCourse,
  onJoinCourse,
}) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("");
  const [classroomLinked, setClassroomLinked] = useState(null); // null loading
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
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
  }, [user?.id]);

  useEffect(() => {
    const content = document.querySelector(".pbc-dashboard__content");
    if (location.pathname !== "/dashboard/classes") return;

    // Scroll only the dashboard content pane. scrollIntoView() also moves
    // window/document and can push the sticky topbar off-screen on mobile.
    if (location.hash === "#mis-cursos") {
      requestAnimationFrame(() => {
        const target = document.getElementById("mis-cursos");
        if (content && target) {
          const top =
            target.getBoundingClientRect().top -
            content.getBoundingClientRect().top +
            content.scrollTop;
          content.scrollTo({ top, behavior: "smooth" });
        }
        window.scrollTo(0, 0);
      });
      return;
    }

    content?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

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
          b.id === "gestion" ? t("pcManagement") :
          b.id === "docente" ? t("pcTeacher") :
          b.id === "alumno" ? t("pcStudent") : b.label,
      })),
    [orgMemberships, courses, isSuperAdmin],
  );

  const summary = useMemo(() => computeQuickSummary({ courses, isSuperAdmin }).map((s) => ({
    ...s,
    label:
      s.id === "courses" ? t("pcCourses") :
      s.id === "teacher" ? t("pcAsTeacher") :
      s.id === "student" ? t("pcAsStudent") :
      s.id === "pending" ? t("pcFilterToGrade") :
      s.id === "students" ? t("pcStudentsYourCourses") :
      s.id === "activities" ? t("pcActivities") : s.label,
  })), [courses, isSuperAdmin]);

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

  const primaryCountry = orgMemberships.find((o) => o.country_code)?.country_code;

  const onClassroomConnect = () => {
    void connectGoogleClassroom("/dashboard/classes", { mode: "teacher" });
  };

  const classroomStatusLabel =
    classroomLinked == null ? "…" : classroomLinked ? t("pcLinked") : t("pcNotLinked");

  return (
    <div className="pbc-home">
      <div className="pbc-home__main">
        <header className="pbc-hero-block pbc-hero-block--with-classroom">
          <div className="pbc-hero-block__text">
            <h1 className="pbc-hero-block__title">{t("pcHello")}, {firstName} 👋</h1>
            <p className="pbc-hero-block__subtitle">{t("pcChooseWork")}</p>
          </div>
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
              <span className="pbc-classroom-status__name">Classroom</span>
              <span className="pbc-classroom-status__state">
                <span className="pbc-classroom-status__dot" aria-hidden />
                {classroomStatusLabel}
              </span>
            </span>
          </button>
        </header>

        <div className="pbc-action-grid">
          <button
            type="button"
            className="pbc-action-card pbc-action-card--courses"
            onClick={() => navigate("/dashboard/classes#mis-cursos", { replace: true })}
          >
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__illus" aria-hidden>
              <CoursesIllustration />
            </span>
            <span className="pbc-action-card__icon pbc-action-card__icon--blue" aria-hidden>
              <CoursesActionIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcMyCourses")}</span>
              <span className="pbc-action-card__desc">
                {courses.length} {t("pcCourses")}
              </span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <button type="button" className="pbc-action-card pbc-action-card--create" onClick={onCreateCourse}>
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__illus" aria-hidden>
              <CreateCourseIllustration />
            </span>
            <span className="pbc-action-card__icon pbc-action-card__icon--teal" aria-hidden>
              <CreateCourseActionIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcCreateCourse")}</span>
              <span className="pbc-action-card__desc">{t("pcWorkAsTeacher")}</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <button type="button" className="pbc-action-card pbc-action-card--join" onClick={onJoinCourse}>
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__illus" aria-hidden>
              <JoinCourseIllustration />
            </span>
            <span className="pbc-action-card__icon pbc-action-card__icon--violet" aria-hidden>
              <JoinCourseActionIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcJoinCourse")}</span>
              <span className="pbc-action-card__desc">{t("pcJoinByCodeOrLink")}</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <a href="/" className="pbc-action-card pbc-action-card--ide">
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__illus" aria-hidden>
              <IdeIllustration />
            </span>
            <span className="pbc-action-card__icon pbc-action-card__icon--indigo" aria-hidden>
              <IdeActionIcon />
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">{t("pcOpenIde")}</span>
              <span className="pbc-action-card__desc">{t("pcOpenIdeDesc")}</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </a>
        </div>

        <section id="mis-cursos">
          <div className="pbc-section-head">
            <h2 className="pbc-section-head__title">{t("pcMyCourses")}</h2>
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
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={roleFilter === t.id}
                className={`pbc-filter-tab${roleFilter === t.id ? " pbc-filter-tab--active" : ""}`}
                onClick={() => setRoleFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="pbc-empty-state">
              <span className="pbc-empty-state__illus" aria-hidden>
                <EmptyCoursesIllustration />
              </span>
              <h3 className="pbc-empty-state__title">{t("pcNoCoursesYet")}</h3>
              <p className="pbc-empty-state__desc">
                {hasStaffAccess
                  ? t("pcNoCoursesStaffDesc")
                   : t("pcNoCoursesStudentDesc")}
              </p>
              <div className="pbc-empty-state__actions">
                <button type="button" className="pbc-btn pbc-btn--primary" onClick={onCreateCourse}>
                  {t("pcCreateCourse")}
                </button>
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onJoinCourse}>
                  {t("pcJoinCourse")}
                </button>
                <a href="/" className="pbc-btn pbc-btn--ghost">
                  {t("pcOpenIde")}
                </a>
              </div>
            </div>
          ) : (
            <div className="pbc-course-grid">
              {filtered.map((c) => {
                const role = normalizeCourseRole(c.my_course_role);
                const rb = role ? ROLE_BADGE[role] : null;
                const headerTone =
                  role === "teacher" ? "teacher" : role === "student" ? "student" : "neutral";
                return (
                  <Link
                    key={c.course_id}
                    to={`/dashboard/classes/${c.course_id}`}
                    className="pbc-course-card"
                  >
                    <div
                      className={`pbc-course-card__header pbc-course-card__header--${headerTone}`}
                      aria-hidden
                    >
                      <span className="pbc-course-card__header-icon">
                        {role === "teacher" ? "📘" : role === "student" ? "📗" : ""}
                      </span>
                    </div>
                    <div className="pbc-course-card__body">
                      <p className="pbc-course-card__title">{c.course_title}</p>
                      <p className="pbc-course-card__meta">{c.org_name || t("pcInstitution")}</p>
                      <div className="pbc-course-card__footer">
                        {rb ? (
                          <span className={`pbc-badge pbc-badge--${rb.variant}`}>{rb.label}</span>
                        ) : null}
                        {role === "teacher" && c.student_count > 0 ? (
                          <span className="pbc-course-card__stat">{c.student_count} {t("pcTabStudents")}</span>
                        ) : null}
                        {c.pending_grade_count > 0 ? (
                          <span className="pbc-course-card__stat">{c.pending_grade_count} {t("pcFilterToGrade")}</span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="pbc-home__aside">
        <div className="pbc-panel-card">
          <h3 className="pbc-panel-card__title">{t("pcMyAccount")}</h3>
          <div className="pbc-account-card__profile">
            {meta.avatar_url || meta.picture ? (
              <img
                src={meta.avatar_url || meta.picture}
                alt=""
                className="pbc-account-card__avatar"
                width={48}
                height={48}
              />
            ) : (
              <div className="pbc-account-card__avatar pbc-account-card__avatar--letter" aria-hidden>
                {firstName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <p className="pbc-account-card__name">{meta.full_name || meta.name || firstName}</p>
              <p className="pbc-account-card__email">{user?.email}</p>
              {primaryCountry ? (
                <p className="pbc-account-card__email">{countryNameByCode(primaryCountry)}</p>
              ) : null}
            </div>
          </div>
          <RoleBadges badges={badges} />
        </div>

        {orgMemberships.length > 0 ? (
          <div className="pbc-panel-card">
            <h3 className="pbc-panel-card__title">{t("pcInstitution")}</h3>
            <div className="pbc-institution-block">
              {orgMemberships.length === 1 ? (
                <p className="pbc-institution-block__name">{orgMemberships[0].name}</p>
              ) : (
                <p className="pbc-institution-block__name">{orgMemberships.length} {t("pcInstitutions")}</p>
              )}
              {primaryCountry ? (
                <p className="pbc-institution-block__meta">{countryNameByCode(primaryCountry)}</p>
              ) : null}
            </div>
            <Link to="/dashboard?tab=schools" className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-panel-card__action">
              {t("pcManage")}
            </Link>
          </div>
        ) : null}

        {summary.length > 0 ? (
          <div className="pbc-panel-card">
            <h3 className="pbc-panel-card__title">{t("pcQuickSummary")}</h3>
            <div className="pbc-stat-grid">
              {summary.map((s) => (
                <div
                  key={s.id}
                  className={`pbc-stat-chip${s.highlight ? " pbc-stat-chip--highlight" : ""}`}
                >
                  <span className="pbc-stat-chip__value">{s.value}</span>
                  <span className="pbc-stat-chip__label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pbc-panel-card pbc-panel-card--quick">
          <h3 className="pbc-panel-card__title">{t("pcGoogleClassroom")}</h3>
          <div
            className={`pbc-classroom-status pbc-classroom-status--panel${
              classroomLinked ? " pbc-classroom-status--on" : " pbc-classroom-status--off"
            }`}
          >
            <span className="pbc-classroom-status__icon" aria-hidden>
              <GoogleClassroomIcon />
            </span>
            <span className="pbc-classroom-status__meta">
              <span className="pbc-classroom-status__name">{t("pcStatus")}</span>
              <span className="pbc-classroom-status__state">
                <span className="pbc-classroom-status__dot" aria-hidden />
                {classroomStatusLabel}
              </span>
            </span>
          </div>
          <button type="button" className="pbc-btn pbc-btn--classroom" onClick={onClassroomConnect}>
            <span className="pbc-btn--classroom__icon" aria-hidden>
              <GoogleClassroomIcon />
            </span>
            {classroomLinked ? t("pcReauthorizeClassroom") : t("pcLinkClassroom")}
          </button>
          <p className="pbc-panel-card__hint">
            {hasStaffAccess
              ? t("pcClassroomAccountHintStaff")
               : t("pcClassroomAccountHintStudent")}
          </p>
        </div>
      </aside>
    </div>
  );
}