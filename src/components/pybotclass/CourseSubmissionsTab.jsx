import { useEffect, useMemo, useState } from "react";
import {
  deriveSubmissionOverviewStatus,
  fetchCourseSubmissionOverview,
  formatDateTimeEs,
  submissionOverviewLabelEs,
} from "../../platform/pybotClassApi.js";
import { gradeSubmission } from "../../platform/activitySubmissions.js";

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "no_entregadas", label: "No entregadas" },
  { id: "por_corregir", label: "Por corregir" },
  { id: "corregidas", label: "Corregidas" },
];

export default function CourseSubmissionsTab({ courseId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("todas");
  const [selected, setSelected] = useState(null);
  const [gradeDraft, setGradeDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const load = async () => {
    setLoading(true);
    const { rows: data, error } = await fetchCourseSubmissionOverview(courseId);
    setErr(error || "");
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [courseId]);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        derivedStatus: deriveSubmissionOverviewStatus(r),
      })),
    [rows],
  );

  const filtered = useMemo(() => {
    if (filter === "todas") return enriched;
    if (filter === "no_entregadas") return enriched.filter((r) => r.derivedStatus === "no_entrego");
    if (filter === "por_corregir") return enriched.filter((r) => r.derivedStatus === "por_corregir");
    return enriched.filter((r) => r.derivedStatus === "corregida");
  }, [enriched, filter]);

  const openRow = (row) => {
    setSelected(row);
    setGradeDraft(row.grade != null ? String(row.grade) : "");
    setFeedbackDraft(row.feedback || "");
    setActionMsg("");
  };

  const onGrade = async () => {
    if (!selected?.submission_id) return;
    setBusy(true);
    setActionMsg("");
    const { ok, error } = await gradeSubmission(
      selected.submission_id,
      gradeDraft === "" ? null : Number(gradeDraft),
      feedbackDraft,
    );
    setBusy(false);
    if (!ok) {
      setActionMsg(error || "No se pudo guardar la corrección.");
      return;
    }
    setActionMsg("Corrección guardada.");
    await load();
    setSelected(null);
  };

  if (loading) return <p className="auth-card__muted">Cargando entregas…</p>;
  if (err) return <p className="auth-card__notice auth-card__notice--err">{err}</p>;

  return (
    <>
      <div className="auth-card__actions auth-card__actions--row" style={{ marginBottom: "1rem" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`auth-btn auth-btn--sm ${filter === f.id ? "auth-btn--primary" : "auth-btn--ghost"}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="auth-card__muted">No hay entregas con este filtro.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Actividad</th>
                <th>Estado</th>
                <th>Última actividad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.student_user_id}-${r.activity_id}`}>
                  <td>{r.student_name}</td>
                  <td>{r.activity_title}</td>
                  <td>{submissionOverviewLabelEs(r.derivedStatus)}</td>
                  <td>{formatDateTimeEs(r.progress_updated_at || r.submitted_at)}</td>
                  <td>
                    {r.submission_id ? (
                      <button
                        type="button"
                        className="auth-btn auth-btn--ghost auth-btn--sm"
                        onClick={() => openRow(r)}
                      >
                        Corregir
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="dash-panel" style={{ marginTop: "1rem", padding: "1rem" }}>
          <h3 className="auth-section__title">Corrección</h3>
          <p className="auth-card__muted">
            {selected.student_name} · {selected.activity_title}
          </p>
          <p className="auth-card__muted">
            Entregada: {formatDateTimeEs(selected.submitted_at)}
          </p>
          <label className="auth-org-label" htmlFor="grade">
            Nota
          </label>
          <input
            id="grade"
            type="number"
            className="auth-org-input auth-org-input--block"
            value={gradeDraft}
            onChange={(e) => setGradeDraft(e.target.value)}
            disabled={busy}
          />
          <label className="auth-org-label" htmlFor="feedback">
            Feedback
          </label>
          <textarea
            id="feedback"
            className="auth-code-area"
            rows={3}
            value={feedbackDraft}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            disabled={busy}
          />
          {actionMsg ? <p className="auth-card__notice">{actionMsg}</p> : null}
          <div className="auth-card__actions auth-card__actions--row">
            <button type="button" className="auth-btn auth-btn--primary" disabled={busy} onClick={() => void onGrade()}>
              {busy ? "Guardando…" : "Guardar corrección"}
            </button>
            <button type="button" className="auth-btn auth-btn--ghost" disabled={busy} onClick={() => setSelected(null)}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
