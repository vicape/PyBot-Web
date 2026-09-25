import { t } from "../../i18n.js";
import { Link } from "react-router-dom";
import { normalizeCourseRole } from "../../platform/courseRole.js";

export function PbcPage({ children }) {
  return <div className="pbc-page">{children}</div>;
}

export function PbcHero({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="pbc-hero">
      <div className="pbc-hero__text">
        {eyebrow ? <p className="pbc-hero__eyebrow">{eyebrow}</p> : null}
        <h1 className="pbc-hero__title">{title}</h1>
        {subtitle ? <p className="pbc-hero__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="pbc-hero__actions">{actions}</div> : null}
    </header>
  );
}

export function PbcToolbar({ children }) {
  return <div className="pbc-toolbar">{children}</div>;
}

export function PbcSelect({ label, value, onChange, children, id }) {
  return (
    <label className="pbc-field pbc-field--inline" htmlFor={id}>
      {label ? <span className="pbc-field__label">{label}</span> : null}
      <select id={id} className="pbc-select" value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  );
}

export function PbcAlert({ variant = "error", children }) {
  return <div className={`pbc-alert pbc-alert--${variant}`} role="alert">{children}</div>;
}

export function PbcEmpty({ title, description, action, actions }) {
  const actionNode = actions || action;
  return (
    <div className="pbc-empty">
      <div className="pbc-empty__icon" aria-hidden>
        ◫
      </div>
      <h2 className="pbc-empty__title">{title}</h2>
      {description ? <p className="pbc-empty__desc">{description}</p> : null}
      {actionNode ? <div className="pbc-empty__action">{actionNode}</div> : null}
    </div>
  );
}

export function PbcLoading({ label = t("pcLoadingGeneric") }) {
  return (
    <div className="pbc-loading" role="status">
      <span className="pbc-loading__spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function PbcClassGrid({ children }) {
  return <div className="pbc-class-grid">{children}</div>;
}

export function PbcClassCard({ course, showOrg }) {
  const pending = course.pending_grade_count ?? 0;
  const role = normalizeCourseRole(course.my_course_role);
  return (
    <Link to={`/dashboard/classes/${course.course_id}`} className="pbc-class-card">
      <div className="pbc-class-card__top">
        <div>
          <h2 className="pbc-class-card__title">{course.course_title}</h2>
          {showOrg && course.org_name ? (
            <p className="pbc-class-card__org">{course.org_name}</p>
          ) : null}
        </div>
        <span className="pbc-class-card__arrow" aria-hidden>
          →
        </span>
      </div>
      <div className="pbc-class-card__stats">
        <span className="pbc-class-card__stat">
          <strong>{course.student_count ?? 0}</strong> {t("pcTabStudents")}
        </span>
        <span className="pbc-class-card__stat">
          <strong>{course.activity_count ?? 0}</strong> {t("pcActivities")}
        </span>
        {pending > 0 ? (
          <span className="pbc-class-card__stat pbc-class-card__stat--warn">
            <strong>{pending}</strong> {t("pcFilterToGrade")}
          </span>
        ) : null}
      </div>
      <div className="pbc-class-card__footer">
        {course.classroom_course_id ? (
          <span className="pbc-pill pbc-pill--classroom">Classroom</span>
        ) : (
          <span className="pbc-pill pbc-pill--muted">PyBotClass</span>
        )}
        {role === "student" ? (
          <span className="pbc-pill pbc-pill--muted">{t("pcStudent")}</span>
        ) : role === "teacher" ? (
          <span className="pbc-pill pbc-pill--role">{t("pcTeacher")}</span>
        ) : null}
      </div>
    </Link>
  );
}

export function PbcCourseHeader({
  title,
  orgName,
  roleLabel,
  classroomLinked,
  badges,
  actions,
  backTo,
  backLabel,
}) {
  return (
    <header className="pbc-course-header">
      {backTo ? (
        <Link to={backTo} className="pbc-course-header__back">
          {backLabel || t("pcMyClassesBack")}
        </Link>
      ) : null}
      <div className="pbc-course-header__row">
        <div className="pbc-course-header__main">
          <h1 className="pbc-course-header__title">{title}</h1>
          <div className="pbc-course-header__meta">
            {orgName ? <span className="pbc-course-header__meta-item">{orgName}</span> : null}
            {roleLabel ? <span className="pbc-pill pbc-pill--role">{roleLabel}</span> : null}
            {classroomLinked ? (
              <span className="pbc-pill pbc-pill--classroom">Classroom</span>
            ) : null}
            {badges}
          </div>
        </div>
        {actions ? <div className="pbc-course-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PbcTabs({ tabs, activeTab, onTabChange }) {
  const onKeyDown = (event, index) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    const target = tabs[next];
    if (!target) return;
    onTabChange(target.id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`pbc-tab-${target.id}`);
      el?.focus();
      el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    });
  };

  return (
    <div className="pbc-tabs-wrap">
      <nav className="pbc-tabs" role="tablist" aria-label={t("pcClassSections")}>
        {tabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`pbc-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`pbc-tab${selected ? " pbc-tab--active" : ""}`}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
              {tab.count != null ? <span className="pbc-tab__count">{tab.count}</span> : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function PbcSection({ title, description, actions, children, className = "" }) {
  return (
    <section className={`pbc-section ${className}`.trim()}>
      {(title || actions) && (
        <div className="pbc-section__head">
          <div>
            {title ? <h2 className="pbc-section__title">{title}</h2> : null}
            {description ? <p className="pbc-section__desc">{description}</p> : null}
          </div>
          {actions ? <div className="pbc-section__actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function PbcStatGrid({ items }) {
  return (
    <div className="pbc-stat-grid">
      {items.map((item) => (
        <div
          key={item.label}
          className={`pbc-stat${item.highlight ? " pbc-stat--highlight" : ""}${item.warn ? " pbc-stat--warn" : ""}`}
        >
          <span className="pbc-stat__value">{item.value}</span>
          <span className="pbc-stat__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function PbcList({ children, empty }) {
  if (empty) return null;
  return <ul className="pbc-list">{children}</ul>;
}

export function PbcListItem({ title, meta, badges, actions, children }) {
  return (
    <li className="pbc-list-item">
      <div className="pbc-list-item__main">
        <div className="pbc-list-item__text">
          <span className="pbc-list-item__title">{title}</span>
          {meta ? <span className="pbc-list-item__meta">{meta}</span> : null}
          {children}
        </div>
        {badges ? <div className="pbc-list-item__badges">{badges}</div> : null}
      </div>
      {actions ? <div className="pbc-list-item__actions">{actions}</div> : null}
    </li>
  );
}

export function PbcBreadcrumb({ items }) {
  return (
    <nav className="pbc-breadcrumb" aria-label={t("pcRoute")}>
      <Link to="/dashboard/classes">{t("pcCourses")}</Link>
      {items.map((item, i) => (
        <span key={item.href || item.label || i}>
          <span className="pbc-breadcrumb__sep" aria-hidden>
            /
          </span>
          {item.href ? <Link to={item.href}>{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PbcFormPanel({ title, onCancel, children }) {
  return (
    <div className="pbc-form-panel">
      <div className="pbc-form-panel__head">
        <h3 className="pbc-form-panel__title">{title}</h3>
        {onCancel ? (
          <button type="button" className="pbc-icon-btn" onClick={onCancel} aria-label={t("pcClose")}>
            ×
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function PbcSubTabs({ tabs, active, onChange }) {
  return (
    <nav className="pbc-subtabs" role="tablist">
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`pbc-subtab${selected ? " pbc-subtab--active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
