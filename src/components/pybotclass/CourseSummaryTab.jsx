import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPybotclassCourseSummary,
  fetchPybotclassStudentSummary,
} from "../../platform/pybotClassApi.js";

export default function CourseSummaryTab({ courseId, canTeach, onGoSubmissions }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      const fn = canTeach ? fetchPybotclassCourseSummary : fetchPybotclassStudentSummary;
      const { summary: data, error } = await fn(courseId);
      if (cancelled) return;
      if (error) setErr(error);
      else setSummary(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, canTeach]);

  if (loading) return <p className="auth-card__muted">Cargando resumen…</p>;
  if (err) return <p className="auth-card__notice auth-card__notice--err">{err}</p>;

  if (!canTeach) {
    return (
      <div className="dash-panel" style={{ padding: "1rem" }}>
        <div className="auth-org-list" style={{ display: "grid", gap: "0.75rem" }}>
          <div className="auth-org-row">
            <span className="auth-org-row__name">Actividades pendientes</span>
            <span className="auth-org-row__meta">{summary?.pending_count ?? 0}</span>
          </div>
          <div className="auth-org-row">
            <span className="auth-org-row__name">Esperando corrección</span>
            <span className="auth-org-row__meta">{summary?.waiting_grade_count ?? 0}</span>
          </div>
        </div>
        {(summary?.graded_recent || []).length > 0 ? (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 className="auth-section__title">Corregidas recientemente</h3>
            <ul className="auth-org-list">
              {(summary.graded_recent || []).map((a) => (
                <li key={a.activity_id} className="auth-org-row auth-org-row--split">
                  <div>
                    <span className="auth-org-row__name">{a.title}</span>
                    {a.feedback ? (
                      <span className="auth-org-row__meta">{a.feedback}</span>
                    ) : null}
                  </div>
                  <span className="dash-badge">Nota: {a.grade ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const recent = summary?.recent_activities || [];

  return (
    <div className="dash-panel" style={{ padding: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "1rem",
          marginBottom: "1.25rem",
        }}
      >
        <div>
          <div className="auth-card__muted">Alumnos</div>
          <strong style={{ fontSize: "1.5rem" }}>{summary?.student_count ?? 0}</strong>
        </div>
        <div>
          <div className="auth-card__muted">Actividades</div>
          <strong style={{ fontSize: "1.5rem" }}>{summary?.activity_count ?? 0}</strong>
        </div>
        <div>
          <div className="auth-card__muted">Entregas</div>
          <strong style={{ fontSize: "1.5rem" }}>{summary?.submission_count ?? 0}</strong>
        </div>
        <div>
          <div className="auth-card__muted">Por corregir</div>
          <strong style={{ fontSize: "1.5rem" }}>{summary?.pending_grade_count ?? 0}</strong>
        </div>
        <div>
          <div className="auth-card__muted">Pendientes</div>
          <strong style={{ fontSize: "1.5rem" }}>{summary?.not_submitted_count ?? 0}</strong>
        </div>
      </div>

      {recent.length > 0 ? (
        <>
          <h3 className="auth-section__title">Actividad reciente</h3>
          <ul className="auth-org-list">
            {recent.map((a) => (
              <li key={a.activity_id} className="auth-org-row auth-org-row--split">
                <div>
                  <span className="auth-org-row__name">{a.activity_title}</span>
                  <span className="auth-org-row__meta">
                    {a.submitted_count ?? 0} entregaron · {a.graded_count ?? 0} corregidas ·{" "}
                    {a.pending_count ?? 0} por corregir
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="auth-card__muted">Todavía no hay actividades en esta clase.</p>
      )}

      {onGoSubmissions ? (
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={onGoSubmissions}>
            Ver entregas
          </button>
        </div>
      ) : null}
    </div>
  );
}
