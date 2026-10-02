import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listSnapshotItems } from "../../platform/activityItemProgress.js";
import {
  buildStudentActivityLearningSummaries,
  fetchCourseLearningStatusOverview,
  formatEngagementDisplay,
  formatPerformanceDisplay,
  formatProgressDisplay,
} from "../../platform/learningStatus.js";
import {
  PbcEmpty,
  PbcLoading,
  PbcSection,
} from "./PyBotClassUi.jsx";

/**
 * Teacher overview: Progress · Active time · Performance (Point 6).
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
      const { overview: data, error, missingMigration } = await fetchCourseLearningStatusOverview(
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

  const selectedActivity = activities.find((a) => a.id === selectedActivityId) || activities[0];

  useEffect(() => {
    if (!selectedActivityId && activities[0]?.id) {
      setSelectedActivityId(activities[0].id);
    }
  }, [activities, selectedActivityId]);

  const studentSummaries = useMemo(() => {
    if (!selectedActivity) return [];
    const engagementAvailable =
      overview?.missingLearningStatusRpc !== true && overview?.engagementUnavailable !== true;
    return buildStudentActivityLearningSummaries({
      activity: selectedActivity,
      students,
      progressRows: overview?.progress || [],
      engagementRows: overview?.engagement || [],
      submissionRows: overview?.submissions || [],
      itemSubmissionRows: overview?.item_submissions || [],
      engagementAvailable,
    });
  }, [selectedActivity, students, overview]);

  const drillStudent = studentSummaries.find((s) => s.student.user_id === selectedStudentId);

  if (loading) return <PbcLoading label="Cargando progreso…" />;
  if (err) return <p className="pbc-alert pbc-alert--error">{err}</p>;
  if (!activities.length) {
    return (
      <PbcSection
        title="Progreso de contenido"
        description="Progreso, tiempo activo y rendimiento (dimensiones independientes)."
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
      description="Progreso · Tiempo activo · Rendimiento (no se infieren entre sí)."
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
          Promedio progreso:{" "}
          <strong>
            {(() => {
              const withReq = studentSummaries.filter(
                (s) => !s.learning.content.progress.emptyRequired,
              );
              if (!withReq.length) return "—";
              const avg =
                withReq.reduce((sum, s) => sum + (s.learning.content.progress.percent || 0), 0) /
                withReq.length;
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
              <th>Progreso</th>
              <th>Tiempo activo</th>
              <th>Rendimiento</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {studentSummaries.map(({ student, learning }) => (
              <tr key={student.user_id}>
                <td>{student.name}</td>
                <td>
                  {learning.content.progress.emptyRequired
                    ? "—"
                    : `${formatProgressDisplay(learning.content.progress)} (${learning.content.progress.completed}/${learning.content.progress.total})`}
                </td>
                <td>{formatEngagementDisplay(learning.content.engagement)}</td>
                <td>{formatPerformanceDisplay(learning.content.performance)}</td>
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
          <p className="auth-card__muted" style={{ marginTop: 0 }}>
            Progreso {formatProgressDisplay(drillStudent.learning.content.progress)}
            {" · "}
            Tiempo activo {formatEngagementDisplay(drillStudent.learning.content.engagement)}
            {" · "}
            Rendimiento {formatPerformanceDisplay(drillStudent.learning.content.performance)}
          </p>
          {Object.values(drillStudent.learning.units).map((u) => (
            <div key={u.unitId || "u"} className="pbc-content-reader__unit">
              <strong>
                {u.unitTitle || "Unidad"}
                {" — "}
                Progreso {formatProgressDisplay(u.progress)}
                {" · "}
                {formatEngagementDisplay(u.engagement)}
                {" · "}
                Rendimiento {formatPerformanceDisplay(u.performance)}
              </strong>
              <ul className="pbc-content-reader__lesson-list">
                {Object.values(drillStudent.learning.lessons)
                  .filter((l) => (l.unitId || null) === (u.unitId || null))
                  .map((l) => (
                    <li key={l.lessonId || l.lessonTitle}>
                      <span>
                        {l.lessonTitle || "Lección"}
                        {" — "}
                        Progreso {formatProgressDisplay(l.progress)}
                        {" · "}
                        {formatEngagementDisplay(l.engagement)}
                        {" · "}
                        Rendimiento {formatPerformanceDisplay(l.performance)}
                      </span>
                      <ul>
                        {Object.values(drillStudent.learning.items)
                          .filter((it) => it.lessonId === l.lessonId)
                          .map((it) => (
                            <li key={it.snapshotItemId}>
                              {it.title || it.snapshotItemId} · {it.type}
                              {" · "}
                              {it.progress.status}
                              {it.progress.required === false ? " (opcional)" : ""}
                              {" · "}
                              {formatEngagementDisplay(it.engagement)}
                              {" · "}
                              Rendimiento {formatPerformanceDisplay(it.performance)}
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
