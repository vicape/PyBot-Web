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
          <h1 className="pbc-hero-block__title">Hola, {firstName}</h1>
          <p className="pbc-hero-block__subtitle">
            Bienvenido a tu espacio de aprendizaje y enseñanza
          </p>
        </header>

        <div className="pbc-action-grid">
          <button type="button" className="pbc-action-card" onClick={() => document.getElementById("mis-cursos")?.scrollIntoView({ behavior: "smooth" })}>
            <span className="pbc-action-card__icon pbc-action-card__icon--purple" aria-hidden>
              ▤
            </span>
            <span className="pbc-action-card__title">Mis cursos</span>
            <span className="pbc-action-card__desc">
              {courses.length} curso{courses.length === 1 ? "" : "s"} en total
            </span>
          </button>

          <button type="button" className="pbc-action-card" onClick={onCreateCourse}>
            <span className="pbc-action-card__icon pbc-action-card__icon--blue" aria-hidden>
              +
            </span>
            <span className="pbc-action-card__title">Crear curso</span>
            <span className="pbc-action-card__desc">Para trabajar como docente</span>
          </button>

          <button type="button" className="pbc-action-card" onClick={onJoinCourse}>
            <span className="pbc-action-card__icon pbc-action-card__icon--teal" aria-hidden>
              ⧉
            </span>
            <span className="pbc-action-card__title">Unirme a un curso</span>
            <span className="pbc-action-card__desc">Ingresá con código o enlace</span>
          </button>

          <a href="/" className="pbc-action-card">
            <span className="pbc-action-card__icon pbc-action-card__icon--slate" aria-hidden>
              {"</>"}
            </span>
            <span className="pbc-action-card__title">Abrir IDE</span>
            <span className="pbc-action-card__desc">Proyectos y práctica en PyBot</span>
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
            <div className="pbc-course-list">
              {filtered.map((c) => {
                const rb = ROLE_BADGE[c.my_course_role] || ROLE_BADGE.student;
                return (
                  <Link
                    key={c.course_id}
                    to={`/dashboard/classes/${c.course_id}`}
                    className="pbc-course-row"
                  >
                    <span className="pbc-course-row__icon" aria-hidden>
                      {c.my_course_role === "teacher" ? "📘" : "📗"}
                    </span>
                    <div className="pbc-course-row__body">
                      <p className="pbc-course-row__title">{c.course_title}</p>
                      <p className="pbc-course-row__meta">{c.org_name || "Institución"}</p>
                    </div>
                    <div className="pbc-course-row__stats">
                      <span className={`pbc-badge pbc-badge--${rb.variant}`}>{rb.label}</span>
                      {c.my_course_role === "teacher" && c.student_count > 0 ? (
                        <span className="pbc-course-row__stat">{c.student_count} alumnos</span>
                      ) : null}
                      {c.pending_grade_count > 0 ? (
                        <span className="pbc-course-row__stat">{c.pending_grade_count} por corregir</span>
                      ) : null}
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
            <h3 className="pbc-panel-card__title">Institución</h3>
            {orgMemberships.length === 1 ? (
              <p>{orgMemberships[0].name}</p>
            ) : (
              <p>{orgMemberships.length} instituciones</p>
            )}
            <Link to="/dashboard?tab=schools" className="pbc-btn pbc-btn--ghost pbc-btn--sm" style={{ marginTop: "0.5rem" }}>
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

        <div className="pbc-panel-card">
          <h3 className="pbc-panel-card__title">Acceso rápido</h3>
          <button
            type="button"
            className="pbc-btn pbc-btn--ghost pbc-btn--sm"
            style={{ width: "100%", marginBottom: "0.5rem" }}
            onClick={() => void connectGoogleClassroom()}
          >
            Conectar Google Classroom
          </button>
          <p className="pbc-account-card__email" style={{ margin: 0 }}>
            Usá la misma cuenta Google con la que ingresaste a PyBotClass.
          </p>
        </div>
      </aside>
    </div>
  );
}