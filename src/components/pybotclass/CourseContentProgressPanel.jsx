import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  deriveProgressAggregates,
  fetchCourseContentProgressOverview,
  listSnapshotItems,
  progressRowsToMap,
} from "../../platform/activityItemProgress.js";
import {
  PbcEmpty,
  PbcLoading,
  PbcSection,
} from "./PyBotClassUi.jsx";

/**
 * Teacher overview of Content assignment completion (progress ≠ Entregas/Notas).
 * Drill-down: activity → student → unit/lesson/item.
 */
export default function CourseContentProgressPanel({ courseId }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!courseId) return;
      setLoading(true);
      setErr("");
      const { overview: data, error, missingMigration } = await fetchCourseContentProgressOverview(
        courseId,
      );
      if (cancelled) return;
      if (missingMigration) {
        setOverview(null);
        setErr("");
        setLoading(false);
        return;
      }
      if (error) setErr(error);
      else setOverview(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const activities = useMemo(() => {
    const rows = overview?.activities || [];
    return rows.filter((a) => listSnapshotItems(a.content_snapshot).length > 0);
  }, [overview]);

  const students = overview?.students || [];
  const allProgress = overview?.progress || [];

  const selectedActivity = activities.find((a) => a.id === selectedActivityId) || activities[0];

  useEffect(() => {
    if (!selectedActivityId && activities[0]?.id) {
      setSelectedActivityId(activities[0].id);
    }
  }, [activities, selectedActivityId]);

  const studentSummaries = useMemo(() => {
    if (!selectedActivity) return [];
    const items = listSnapshotItems(selectedActivity.content_snapshot);
    const actProgress = allProgress.filter((p) => p.activity_id === selectedActivity.id);
    return students.map((s) => {
      const rows = actProgress.filter((p) => p.user_id === s.user_id);
      const map = progressRowsToMap(rows);
      const agg = deriveProgressAggregates(items, map);
      return { student: s, aggregates: agg, map, rows };
    });
  }, [selectedActivity, students, allProgress]);

  const drillStudent = studentSummaries.find((s) => s.student.user_id === selectedStudentId);

  if (loading) return <PbcLoading label="Cargando progreso…" />;
  if (err) return <p className="pbc-alert pbc-alert--error">{err}</p>;
  if (!activities.length) {
    return (
      <PbcSection
        title="Progreso de contenido"
        description="Completitud pedagógica (separado de Entregas y Notas)."
      >
        <PbcEmpty
          title="Sin asignaciones con ítems"
          description="Las asignaciones nuevas de Contenido con ítems mostrarán el progreso aquí."
        />
      </PbcSection>
    );
  }

  return (
    <PbcSection
      title="Progreso de contenido"
      description="Completitud por actividad asignada (no es Entregas ni Notas)."
    >
      <div className="pbc-form-grid" style={{ marginBottom: "0.75rem" }}>
        <div>
          <label className="auth-org-label" htmlFor="ccp-activity">
            Actividad
          </label>
          <select
            id="ccp-activity"
            className="auth-org-input auth-org-input--block"
            value={selectedActivity?.id || ""}
            onChange={(e) => {
              setSelectedActivityId(e.target.value);
              setSelectedStudentId("");
            }}
          >
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedActivity ? (
        <p className="auth-card__muted" style={{ marginTop: 0 }}>
          Promedio alumnos:{" "}
          <strong>
            {(() => {
              const withReq = studentSummaries.filter((s) => !s.aggregates.content.emptyRequired);
              if (!withReq.length) return "—";
              const avg =
                withReq.reduce((sum, s) => sum + s.aggregates.content.percent, 0) / withReq.length;
              return `${Math.round(avg * 10) / 10}%`;
            })()}
          </strong>
          {" · "}
          <Link className="pbc-btn pbc-btn--ghost pbc-btn--sm" to={`/actividad/${selectedActivity.id}`}>
            Abrir actividad
          </Link>
        </p>
      ) : null}

      <div className="pbc-table-wrap">
        <table className="pbc-table">
          <thead>
            <tr>
              <th>Alumno</th>
              <th>Completitud</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {studentSummaries.map(({ student, aggregates }) => (
              <tr key={student.user_id}>
                <td>{student.name}</td>
                <td>
                  {aggregates.content.emptyRequired
                    ? "—"
                    : `${aggregates.content.percent}% (${aggregates.content.completed}/${aggregates.content.total})`}
                </td>
                <td>
                  <button
                    type="button"
                    className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                    onClick={() => setSelectedStudentId(student.user_id)}
                  >
                    Detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drillStudent ? (
        <div className="pbc-stack" style={{ marginTop: "1rem" }}>
          <h3 className="pbc-section__title">
            Detalle: {drillStudent.student.name}
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm"
              style={{ marginLeft: "0.5rem" }}
              onClick={() => setSelectedStudentId("")}
            >
              Cerrar
            </button>
          </h3>
          {Object.values(drillStudent.aggregates.units).map((u) => (
            <div key={u.unitId || "u"} className="pbc-content-reader__unit">
              <strong>
                {u.unitTitle || "Unidad"}
                {!u.emptyRequired ? ` — ${u.percent}%` : ""}
              </strong>
              <ul className="pbc-content-reader__lesson-list">
                {Object.values(drillStudent.aggregates.lessons)
                  .filter((l) => (l.unitId || null) === (u.unitId || null))
                  .map((l) => (
                    <li key={l.lessonId || l.lessonTitle}>
                      <span>
                        {l.lessonTitle || "Lección"}
                        {!l.emptyRequired ? ` — ${l.percent}%` : ""}
                      </span>
                      <ul>
                        {Object.values(drillStudent.aggregates.items)
                          .filter((it) => it.lessonId === l.lessonId)
                          .map((it) => (
                            <li key={it.snapshotItemId}>
                              {it.title || it.snapshotItemId} · {it.type} · {it.status}
                              {it.required === false ? " (opcional)" : ""}
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </PbcSection>
  );
}
