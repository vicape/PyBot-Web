import { useEffect, useMemo, useState } from "react";
import { fetchPybotclassGradebook } from "../../platform/pybotClassApi.js";
import { PbcAlert, PbcEmpty, PbcLoading, PbcSection } from "./PyBotClassUi.jsx";

export default function CourseGradesTab({ courseId, canTeach }) {
  const [gradebook, setGradebook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { gradebook: data, error } = await fetchPybotclassGradebook(courseId);
      if (cancelled) return;
      setGradebook(data);
      setErr(error || "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const gradeMap = useMemo(() => {
    const map = new Map();
    for (const g of gradebook?.grades || []) {
      map.set(`${g.user_id}:${g.activity_id}`, g);
    }
    return map;
  }, [gradebook]);

  if (loading) return <PbcLoading label="Cargando notas…" />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  const students = gradebook?.students || [];
  const activities = gradebook?.activities || [];

  if (!students.length || !activities.length) {
    return (
      <PbcEmpty
        title="Sin notas todavía"
        description="Cuando haya actividades y entregas corregidas, el cuadro de notas aparecerá acá."
      />
    );
  }

  return (
    <PbcSection title="Cuadro de notas" description={`${students.length} alumnos · ${activities.length} actividades`}>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Alumno</th>
              {activities.map((a) => (
                <th key={a.id}>{a.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.user_id}>
                <td>{s.name}</td>
                {activities.map((a) => {
                  const g = gradeMap.get(`${s.user_id}:${a.id}`);
                  const grade = g?.grade;
                  const synced = g?.classroom_grade_synced_at;
                  const pendingSync = grade != null && a.classroom_coursework_id && !synced;
                  return (
                    <td key={a.id}>
                      <strong>{grade != null ? grade : "—"}</strong>
                      {canTeach && synced ? (
                        <span className="pbc-pill pbc-pill--ok pbc-pill--sm" title="Sincronizada">
                          {" "}
                          ✓
                        </span>
                      ) : null}
                      {canTeach && pendingSync ? (
                        <span className="pbc-pill pbc-pill--warn pbc-pill--sm" title="Pendiente Classroom">
                          {" "}
                          ↻
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PbcSection>
  );
}
