import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCourseSubmissionOverview,
  formatDateTimeEs,
  submissionOverviewLabelEs,
} from "../../platform/pybotClassApi.js";
import { reopenSubmissionForStudent } from "../../platform/activitySubmissions.js";
import {
  INBOX_FILTERS,
  deriveInboxFilterId,
  deriveSubmissionWindow,
  deriveTimeliness,
  timelinessLabelEs,
} from "../../platform/submissionWorkflow.js";
import {
  PbcAlert,
  PbcLoading,
  PbcSection,
  PbcSubTabs,
} from "./PyBotClassUi.jsx";

function statusPill(filterId) {
  const label = submissionOverviewLabelEs(filterId);
  if (filterId === "por_corregir" || filterId === "reentregadas") {
    return <span className="pbc-pill pbc-pill--warn">{label}</span>;
  }
  if (filterId === "revision_solicitada") {
    return <span className="pbc-pill pbc-pill--warn">{label}</span>;
  }
  if (filterId === "evaluadas" || filterId === "cerradas") {
    return <span className="pbc-pill pbc-pill--ok">{label}</span>;
  }
  return <span className="pbc-pill pbc-pill--muted">{label}</span>;
}

/**
 * Overview de entregas del curso.
 * La corrección vive solo en ActivityPage (código + nota + Classroom).
 */
export default function CourseSubmissionsTab({ courseId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("todas");
  const [busyId, setBusyId] = useState("");
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
      rows.map((r) => {
        const derivedStatus = deriveInboxFilterId(r);
        const late =
          r.is_late === true ||
          deriveTimeliness({
            submittedAt: r.submitted_at,
            dueAt: r.activity_due_at,
          }) === "tarde";
        const windowClosed =
          deriveSubmissionWindow({ closeAt: r.activity_close_at }) === "cerrada";
        return { ...r, derivedStatus, late, windowClosed };
      }),
    [rows],
  );

  const filtered = useMemo(() => {
    if (filter === "todas") return enriched;
    return enriched.filter((r) => r.derivedStatus === filter);
  }, [enriched, filter]);

  const onReopenRow = async (r) => {
    const key = `${r.activity_id}:${r.student_user_id}`;
    setBusyId(key);
    setActionMsg("");
    const out = await reopenSubmissionForStudent(r.activity_id, r.student_user_id);
    setBusyId("");
    if (!out.ok) {
      setErr(out.error || "No se pudo reabrir.");
      return;
    }
    setActionMsg(`Reabierto: ${r.student_name} · ${r.activity_title}`);
    await load();
  };

  if (loading) return <PbcLoading label="Cargando entregas…" />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  return (
    <PbcSection title="Entregas del curso" description={`${filtered.length} fila(s) con el filtro actual`}>
      {actionMsg ? <PbcAlert variant="info">{actionMsg}</PbcAlert> : null}
      <PbcSubTabs tabs={INBOX_FILTERS} active={filter} onChange={setFilter} />

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
                <th>Puntualidad</th>
                <th>Última actividad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const key = `${r.activity_id}:${r.student_user_id}`;
                const showReopen =
                  r.reopen_active !== true &&
                  (r.submission_status === "closed" ||
                    r.submission_status === "graded" ||
                    r.windowClosed);
                return (
                  <tr key={key}>
                    <td>{r.student_name}</td>
                    <td>{r.activity_title}</td>
                    <td>{statusPill(r.derivedStatus)}</td>
                    <td>
                      {r.late ? (
                        <span className="pbc-pill pbc-pill--warn">{timelinessLabelEs("tarde")}</span>
                      ) : r.submitted_at ? (
                        <span className="pbc-pill pbc-pill--muted">
                          {timelinessLabelEs("a_tiempo") || "—"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDateTimeEs(r.progress_updated_at || r.submitted_at)}</td>
                    <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {r.submission_id ? (
                        <Link
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          to={`/actividad/${r.activity_id}?alumno=${encodeURIComponent(r.student_user_id)}`}
                        >
                          Revisar
                        </Link>
                      ) : (
                        <Link
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          to={`/actividad/${r.activity_id}?alumno=${encodeURIComponent(r.student_user_id)}`}
                        >
                          Abrir
                        </Link>
                      )}
                      {showReopen ? (
                        <button
                          type="button"
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          disabled={busyId === key}
                          onClick={() => void onReopenRow(r)}
                        >
                          Reabrir
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PbcSection>
  );
}
