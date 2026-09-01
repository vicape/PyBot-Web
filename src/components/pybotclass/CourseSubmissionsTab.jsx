import { useEffect, useMemo, useState } from "react";
import {
  deriveSubmissionOverviewStatus,
  fetchCourseSubmissionOverview,
  formatDateTimeEs,
} from "../../platform/pybotClassApi.js";
import { gradeSubmission } from "../../platform/activitySubmissions.js";
import {
  PbcAlert,
  PbcFormPanel,
  PbcLoading,
  PbcSection,
  PbcSubTabs,
} from "./PyBotClassUi.jsx";

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "no_entregadas", label: "No entregadas" },
  { id: "por_corregir", label: "Por corregir" },
  { id: "corregidas", label: "Corregidas" },
];

function statusPill(status) {
  if (status === "por_corregir") return <span className="pbc-pill pbc-pill--warn">Por corregir</span>;
  if (status === "corregida") return <span className="pbc-pill pbc-pill--ok">Corregida</span>;
  return <span className="pbc-pill pbc-pill--muted">No entregó</span>;
}

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

  if (loading) return <PbcLoading label="Cargando entregas…" />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  return (
    <>
      <PbcSection title="Entregas del curso" description={`${filtered.length} fila(s) con el filtro actual`}>
        <PbcSubTabs tabs={FILTERS} active={filter} onChange={setFilter} />

        {filtered.length === 0 ? (
          <p className="auth-card__muted">No hay entregas con este filtro.</p>
        ) : (
          <div className="dash-table-wrap">
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
                    <td>{statusPill(r.derivedStatus)}</td>
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
      </PbcSection>

      {selected ? (
        <PbcFormPanel title="Corregir entrega" onCancel={() => setSelected(null)}>
          <p className="auth-card__muted">
            {selected.student_name} · {selected.activity_title}
          </p>
          <p className="auth-card__muted">Entregada: {formatDateTimeEs(selected.submitted_at)}</p>
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
          {actionMsg ? <PbcAlert variant="info">{actionMsg}</PbcAlert> : null}
          <div className="auth-card__actions auth-card__actions--row">
            <button type="button" className="auth-btn auth-btn--primary" disabled={busy} onClick={() => void onGrade()}>
              {busy ? "Guardando…" : "Guardar corrección"}
            </button>
          </div>
        </PbcFormPanel>
      ) : null}
    </>
  );
}
