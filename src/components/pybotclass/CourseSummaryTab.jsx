import { useEffect, useState } from "react";
import {
  fetchPybotclassCourseSummary,
  fetchPybotclassStudentSummary,
} from "../../platform/pybotClassApi.js";
import {
  PbcAlert,
  PbcList,
  PbcListItem,
  PbcLoading,
  PbcSection,
  PbcStatGrid,
} from "./PyBotClassUi.jsx";

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

  if (loading) return <PbcLoading label="Cargando resumen…" />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  if (!canTeach) {
    return (
      <PbcSection title="Tu progreso">
        <PbcStatGrid
          items={[
            { label: "Pendientes", value: summary?.pending_count ?? 0, warn: true },
            { label: "Esperando corrección", value: summary?.waiting_grade_count ?? 0 },
          ]}
        />
        {(summary?.graded_recent || []).length > 0 ? (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 className="pbc-section__title">Corregidas recientemente</h3>
            <PbcList>
              {(summary.graded_recent || []).map((a) => (
                <PbcListItem
                  key={a.activity_id}
                  title={a.title}
                  meta={a.feedback || undefined}
                  badges={<span className="pbc-pill pbc-pill--ok">Nota {a.grade ?? "—"}</span>}
                />
              ))}
            </PbcList>
          </div>
        ) : null}
      </PbcSection>
    );
  }

  const recent = summary?.recent_activities || [];

  return (
    <PbcSection
      title="Resumen de la clase"
      actions={
        onGoSubmissions ? (
          <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={onGoSubmissions}>
            Ver entregas
          </button>
        ) : null
      }
    >
      <PbcStatGrid
        items={[
          { label: "Alumnos", value: summary?.student_count ?? 0, highlight: true },
          { label: "Actividades", value: summary?.activity_count ?? 0 },
          { label: "Entregas", value: summary?.submission_count ?? 0 },
          { label: "Por corregir", value: summary?.pending_grade_count ?? 0, warn: true },
          { label: "Sin entregar", value: summary?.not_submitted_count ?? 0 },
        ]}
      />

      {recent.length > 0 ? (
        <div style={{ marginTop: "1.25rem" }}>
          <h3 className="pbc-section__title">Actividad reciente</h3>
          <PbcList>
            {recent.map((a) => (
              <PbcListItem
                key={a.activity_id}
                title={a.activity_title}
                meta={`${a.submitted_count ?? 0} entregaron · ${a.graded_count ?? 0} corregidas · ${a.pending_count ?? 0} por corregir`}
              />
            ))}
          </PbcList>
        </div>
      ) : (
        <p className="auth-card__muted" style={{ marginTop: "1rem" }}>
          Todavía no hay actividades en esta clase.
        </p>
      )}
    </PbcSection>
  );
}
