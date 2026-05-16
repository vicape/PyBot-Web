import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTeacherClassroomCourses } from "../../classroom/classroomApi.js";
import { connectGoogleClassroom } from "../../platform/googleOAuth.js";
import { fetchProfile, markClassroomLinked } from "../../platform/profileApi.js";
import { getSupabase } from "../../supabaseClient.js";

function classroomErrorEs(err) {
  const code = err?.code;
  if (code === "missing_access_token") {
    return "No hay token de Google Classroom. Usá «Conectar Classroom» y aceptá los permisos.";
  }
  if (err?.status === 403) {
    return "Google rechazó el acceso. Activá Classroom API en Google Cloud y los scopes en la pantalla de consentimiento.";
  }
  return err?.message || "No se pudo comunicar con Classroom.";
}

export default function ClassroomPanel({ user, staffOrgId }) {
  const [linkedAt, setLinkedAt] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const refreshCourses = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setTesting(true);
    setErr("");
    setOkMsg("");
    try {
      const { data: { session } } = await sb.auth.getSession();
      const tok = session?.provider_token;
      const list = await listTeacherClassroomCourses(tok);
      setCourses(list);
      if (user?.id) {
        const mark = await markClassroomLinked(user.id);
        if (mark.ok) setLinkedAt(new Date().toISOString());
      }
      setOkMsg(`Conectado: ${list.length} curso(s) activo(s) en Classroom.`);
    } catch (ex) {
      setCourses([]);
      setErr(classroomErrorEs(ex));
    } finally {
      setTesting(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      const { profile } = await fetchProfile(user.id);
      setLinkedAt(profile?.classroom_linked_at ?? null);
      setLoading(false);
      if (profile?.classroom_linked_at) {
        await refreshCourses();
      }
    })();
  }, [user?.id, refreshCourses]);

  if (loading) {
    return <p className="auth-card__muted">Cargando Classroom…</p>;
  }

  return (
    <section className="dash-panel">
      <h2 className="dash-panel__title">Google Classroom</h2>
      <p className="auth-card__muted auth-card__muted--tight">
        Como docente podés vincular tu cuenta de Google para listar cursos y enlazarlos a PyBot desde cada
        colegio.
      </p>

      <div className="dash-status-row">
        <span
          className={`dash-badge ${linkedAt && courses.length >= 0 && !err ? "dash-badge--ok" : "dash-badge--muted"}`}
        >
          {linkedAt ? "Vinculado" : "Sin vincular"}
        </span>
        {linkedAt ? (
          <span className="auth-card__muted auth-card__muted--tight">
            Última conexión: {new Date(linkedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
      {okMsg ? <p className="auth-card__notice">{okMsg}</p> : null}

      <div className="auth-org-row__actions" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="auth-btn auth-btn--primary"
          onClick={() => void connectGoogleClassroom()}
        >
          Conectar Google Classroom
        </button>
        <button
          type="button"
          className="auth-btn auth-btn--ghost"
          disabled={testing}
          onClick={() => void refreshCourses()}
        >
          {testing ? "Comprobando…" : "Probar conexión"}
        </button>
      </div>

      {courses.length > 0 ? (
        <>
          <h3 className="auth-section__title">Tus cursos en Classroom</h3>
          <ul className="auth-org-list">
            {courses.map((c) => (
              <li key={c.id} className="auth-org-row">
                <span className="auth-org-row__name">{c.name || c.section || c.id}</span>
                <span className="auth-org-row__meta">ID: {c.id}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="auth-card__muted">
          Tras conectar, acá verás los cursos donde sos docente. Luego importalos en{" "}
          {staffOrgId ? (
            <Link to={`/dashboard/org/${staffOrgId}`}>Cursos del colegio</Link>
          ) : (
            "la sección Cursos de tu colegio"
          )}
          .
        </p>
      )}

      <p className="auth-card__codehint">
        Requiere Classroom API activa en Google Cloud y scopes de lectura en el consentimiento OAuth.
      </p>
    </section>
  );
}
