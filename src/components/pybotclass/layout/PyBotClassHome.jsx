import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { countryNameByCode } from "../../../data/countries.js";
import { computeAccountRoleBadges, computeQuickSummary } from "../../../platform/accountRoles.js";
import { connectGoogleClassroom } from "../../../platform/googleOAuth.js";
import RoleBadges from "./RoleBadges.jsx";

const ROLE_BADGE = {
  teacher: { label: "Docente", variant: "purple" },
  student: { label: "Alumno", variant: "teal" },
};

export default function PyBotClassHome({
  user,
  orgs = [],
  courses = [],
  isSuperAdmin = false,
  onCreateCourse,
  onJoinCourse,
}) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("");

  const meta = user?.user_metadata || {};
  const firstName =
    (meta.full_name || meta.name || user?.email?.split("@")[0] || "Usuario").split(" ")[0];

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
      }),
    [orgMemberships, courses, isSuperAdmin],
  );

  const summary = useMemo(() => computeQuickSummary({ courses, isSuperAdmin }), [courses, isSuperAdmin]);

  const filtered = useMemo(() => {
    let rows = courses;
    if (roleFilter === "teacher") rows = rows.filter((c) => c.my_course_role === "teacher");
    if (roleFilter === "student") rows = rows.filter((c) => c.my_course_role === "student");
    if (orgFilter) rows = rows.filter((c) => c.org_id === orgFilter);
    return rows;
  }, [courses, roleFilter, orgFilter]);

  const primaryCountry = orgMemberships.find((o) => o.country_code)?.country_code;

  return (
    <div className="pbc-home">
      <div className="pbc-home__main">
        <header className="pbc-hero-block">
          <h1 className="pbc-hero-block__title">Hola, {firstName} 👋</h1>
          <p className="pbc-hero-block__subtitle">Elegí cómo querés trabajar hoy</p>
        </header>

        <div className="pbc-action-grid">
          <button
            type="button"
            className="pbc-action-card pbc-action-card--courses"
            onClick={() => document.getElementById("mis-cursos")?.scrollIntoView({ behavior: "smooth" })}
          >
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__icon pbc-action-card__icon--blue" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M8 9h8M8 12.5h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">Mis cursos</span>
              <span className="pbc-action-card__desc">
                {courses.length} curso{courses.length === 1 ? "" : "s"} en total
              </span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <button type="button" className="pbc-action-card pbc-action-card--create" onClick={onCreateCourse}>
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__icon pbc-action-card__icon--teal" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M6 5.5h12A1.5 1.5 0 0 1 19.5 7v10A1.5 1.5 0 0 1 18 18.5H6A1.5 1.5 0 0 1 4.5 17V7A1.5 1.5 0 0 1 6 5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">Crear curso</span>
              <span className="pbc-action-card__desc">Para trabajar como docente</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <button type="button" className="pbc-action-card pbc-action-card--join" onClick={onJoinCourse}>
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__icon pbc-action-card__icon--violet" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9.5 10.5a3 3 0 1 1 0-4 3 3 0 0 1 0 4ZM16 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M6.5 17.5c.8-2.2 2.7-3.5 5-3.5s4.2 1.3 5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">Unirme a un curso</span>
              <span className="pbc-action-card__desc">Ingresá con código o enlace</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <a href="/" className="pbc-action-card pbc-action-card--ide">
            <span className="pbc-action-card__decor" aria-hidden />
            <span className="pbc-action-card__icon pbc-action-card__icon--indigo" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M8 7.5 4.5 12 8 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 7.5 19.5 12 16 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.5 6.5 10.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="pbc-action-card__body">
              <span className="pbc-action-card__title">Abrir IDE</span>
              <span className="pbc-action-card__desc">Proyectos y práctica en PyBot</span>
            </span>
            <span className="pbc-action-card__arrow" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3.5L9 7L5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </a>
        </div>

        <section id="mis-cursos">
          <div className="pbc-section-head">
            <h2 className="pbc-section-head__title">Mis cursos</h2>
            {orgMemberships.length > 1 ? (
              <select
                className="pbc-select"
                style={{ width: "auto", minWidth: "160px" }}
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                aria-label="Filtrar por institución"
              >
                <option value="">Todas las instituciones</option>
                {orgMemberships.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="pbc-filter-tabs" role="tablist" aria-label="Filtrar por rol">
            {[
              { id: "all", label: "Todos" },
              { id: "teacher", label: "Docente" },
              { id: "student", label: "Alumno" },
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
              <span className="pbc-empty-state__icon" aria-hidden>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
                  <rect x="6" y="10" width="28" height="20" rx="4" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M14 18h12M14 22.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M20 6v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <h3 className="pbc-empty-state__title">Todavía no participás en cursos</h3>
              <p className="pbc-empty-state__desc">
                Creá un curso, unite con un código o importá desde Google Classroom.
              </p>
              <div className="pbc-empty-state__actions">
                <button type="button" className="pbc-btn pbc-btn--primary" onClick={onCreateCourse}>
                  Crear curso
                </button>
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onJoinCourse}>
                  Unirme a un curso
                </button>
                <a href="/" className="pbc-btn pbc-btn--ghost">
                  Abrir IDE
                </a>
              </div>
            </div>
          ) : (
            <div className="pbc-course-grid">
              {filtered.map((c) => {
                const rb = ROLE_BADGE[c.my_course_role] || ROLE_BADGE.student;
                return (
                  <Link
                    key={c.course_id}
                    to={`/dashboard/classes/${c.course_id}`}
                    className="pbc-course-card"
                  >
                    <div
                      className={`pbc-course-card__header pbc-course-card__header--${c.my_course_role === "teacher" ? "teacher" : "student"}`}
                      aria-hidden
                    >
                      <span className="pbc-course-card__header-icon">
                        {c.my_course_role === "teacher" ? "📘" : "📗"}
                      </span>
                    </div>
                    <div className="pbc-course-card__body">
                      <p className="pbc-course-card__title">{c.course_title}</p>
                      <p className="pbc-course-card__meta">{c.org_name || "Institución"}</p>
                      <div className="pbc-course-card__footer">
                        <span className={`pbc-badge pbc-badge--${rb.variant}`}>{rb.label}</span>
                        {c.my_course_role === "teacher" && c.student_count > 0 ? (
                          <span className="pbc-course-card__stat">{c.student_count} alumnos</span>
                        ) : null}
                        {c.pending_grade_count > 0 ? (
                          <span className="pbc-course-card__stat">{c.pending_grade_count} por corregir</span>
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
          <h3 className="pbc-panel-card__title">Mi cuenta</h3>
          <div className="pbc-account-card__profile">
            {meta.avatar_url || meta.picture ? (
              <img
                src={meta.avatar_url || meta.picture}
                alt=""
                className="pbc-account-card__avatar"
                width={56}
                height={56}
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
            <h3 className="pbc-panel-card__title">Institución</h3>
            <div className="pbc-institution-block">
              {orgMemberships.length === 1 ? (
                <p className="pbc-institution-block__name">{orgMemberships[0].name}</p>
              ) : (
                <p className="pbc-institution-block__name">{orgMemberships.length} instituciones</p>
              )}
              {primaryCountry ? (
                <p className="pbc-institution-block__meta">{countryNameByCode(primaryCountry)}</p>
              ) : null}
            </div>
            <Link to="/dashboard?tab=schools" className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-panel-card__action">
              Gestionar
            </Link>
          </div>
        ) : null}

        {summary.length > 0 ? (
          <div className="pbc-panel-card">
            <h3 className="pbc-panel-card__title">Resumen rápido</h3>
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
          <h3 className="pbc-panel-card__title">Acceso rápido</h3>
          <button
            type="button"
            className="pbc-btn pbc-btn--classroom"
            onClick={() => void connectGoogleClassroom()}
          >
            <span className="pbc-btn--classroom__icon" aria-hidden>
              G
            </span>
            Conectar Google Classroom
          </button>
          <p className="pbc-panel-card__hint">
            Usá la misma cuenta Google con la que ingresaste a PyBotClass.
          </p>
        </div>
      </aside>
    </div>
  );
}