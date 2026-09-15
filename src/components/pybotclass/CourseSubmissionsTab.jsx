import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  deriveSubmissionOverviewStatus,
  fetchCourseSubmissionOverview,
  formatDateTimeEs,
} from "../../platform/pybotClassApi.js";
import {
  PbcAlert,
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

/**
 * Overview de entregas del curso.
 * La corrección vive solo en ActivityPage (código + nota + Classroom).
 */
export default function CourseSubmissionsTab({ courseId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("todas");

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

  if (loading) return <PbcLoading label="Cargando entregas…" />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  return (
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
                      <Link
                        className="auth-btn auth-btn--ghost auth-btn--sm"
                        to={`/actividad/${r.activity_id}?alumno=${encodeURIComponent(r.student_user_id)}`}
                      >
                        Revisar
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PbcSection>
  );
}
