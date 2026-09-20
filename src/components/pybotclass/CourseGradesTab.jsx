import { t } from "../../i18n.js";
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

  const applicableSet = useMemo(() => {
    const set = new Set();
    for (const row of gradebook?.applicable || []) {
      set.add(`${row.user_id}:${row.activity_id}`);
    }
    return set;
  }, [gradebook]);

  if (loading) return <PbcLoading label={t("pcLoadingGrades")} />;
  if (err) return <PbcAlert variant="error">{err}</PbcAlert>;

  const students = gradebook?.students || [];
  const activities = gradebook?.activities || [];

  if (!students.length || !activities.length) {
    return (
      <PbcEmpty
        title={t("pcNoGrades")}
        description={t("pcNoGradesDesc")}
      />
    );
  }

  return (
    <PbcSection title={t("pcGradebook")} description={`${students.length} ${t("pcTabStudents")} · ${activities.length} ${t("pcActivities")}`}>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>{t("pcStudent")}</th>
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
                  const key = `${s.user_id}:${a.id}`;
                  const applies = !gradebook?.applicable || applicableSet.has(key);
                  if (!applies) {
                    return (
                      <td key={a.id} title={t("pcNotAssigned")}>
                        <span className="auth-card__muted">N/A</span>
                      </td>
                    );
                  }
                  const g = gradeMap.get(key);
                  const grade = g?.grade;
                  const synced = g?.classroom_grade_synced_at;
                  const pendingSync = grade != null && a.classroom_coursework_id && !synced;
                  return (
                    <td key={a.id}>
                      <strong>{grade != null ? grade : "—"}</strong>
                      {canTeach && synced ? (
                        <span className="pbc-pill pbc-pill--ok pbc-pill--sm" title={t("pcSynced")}>
                          {" "}
                          ✓
                        </span>
                      ) : null}
                      {canTeach && pendingSync ? (
                        <span className="pbc-pill pbc-pill--warn pbc-pill--sm" title={t("pcPendingClassroom")}>
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
