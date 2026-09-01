import { useEffect, useMemo, useState } from "react";
import { fetchPybotclassGradebook } from "../../platform/pybotClassApi.js";

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

  if (loading) return <p className="auth-card__muted">Cargando notas…</p>;
  if (err) return <p className="auth-card__notice auth-card__notice--err">{err}</p>;

  const students = gradebook?.students || [];
  const activities = gradebook?.activities || [];

  if (!students.length || !activities.length) {
    return <p className="auth-card__muted">Todavía no hay notas para mostrar.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
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
                    {grade != null ? grade : "—"}
                    {canTeach && synced ? (
                      <span className="dash-badge" title="Sincronizada con Classroom">
                        {" "}
                        ✓
                      </span>
                    ) : null}
                    {canTeach && pendingSync ? (
                      <span className="dash-badge dash-badge--muted" title="Pendiente de envío a Classroom">
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
  );
}
