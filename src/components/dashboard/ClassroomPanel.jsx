import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listTeacherClassroomCourses } from "../../classroom/classroomApi.js";
import { connectGoogleClassroom } from "../../platform/googleOAuth.js";
import { fetchProfile, markClassroomLinked } from "../../platform/profileApi.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import { getSupabase } from "../../supabaseClient.js";
import { slugifyOrganizationName } from "../../slugify.js";

function classroomErrorEs(err) {
  const code = err?.code;
  if (code === "missing_access_token") {
    return "No hay token de Google Classroom. Usá «Conectar Classroom» y aceptá los permisos.";
  }
  if (err?.status === 403) {
    return "El token de Classroom expiró o no tiene permisos. Hacé clic en «Conectar Google Classroom» para renovarlo.";
  }
  return err?.message || "No se pudo comunicar con Classroom.";
}

export default function ClassroomPanel({ user, staffOrgId }) {
  const navigate = useNavigate();
  const [linkedAt, setLinkedAt] = useState(null);
  const [courses, setCourses] = useState([]);
  const [importedIds, setImportedIds] = useState(new Set());
  const [importing, setImporting] = useState(null); // classroom_course_id en curso
  const [importErr, setImportErr] = useState("");
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
      const tok = await getValidClassroomToken(user?.id);
      const list = await listTeacherClassroomCourses(tok);
      setCourses(list);
      if (user?.id) {
        const mark = await markClassroomLinked(user.id);
        if (mark.ok) setLinkedAt(new Date().toISOString());
      }
      setOkMsg(`Conectado: ${list.length} curso(s) activo(s) en Classroom.`);

      // Cargar qué cursos ya fueron importados en el colegio
      if (sb && staffOrgId) {
        const { data: existing } = await sb
          .from("courses")
          .select("classroom_course_id")
          .eq("org_id", staffOrgId)
          .not("classroom_course_id", "is", null);
        if (existing) {
          setImportedIds(new Set(existing.map((r) => r.classroom_course_id)));
        }
      }
    } catch (ex) {
      setCourses([]);
      setErr(classroomErrorEs(ex));
    } finally {
      setTesting(false);
    }
  }, [user?.id, staffOrgId]);

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

  const importCourse = async (classroomCourse) => {
    const sb = getSupabase();
    if (!sb || !user?.id || !staffOrgId) {
      setImportErr("Seleccioná un colegio antes de importar.");
      return;
    }
    setImporting(classroomCourse.id);
    setImportErr("");

    const title = classroomCourse.name || classroomCourse.section || `Curso ${classroomCourse.id}`;
    const slug = slugifyOrganizationName(title);

    const payload = {
      org_id: staffOrgId,
      title,
      slug,
      classroom_course_id: classroomCourse.id,
      created_by: user.id,
    };

    let { data: row, error } = await sb
      .from("courses")
      .insert(payload)
      .select("id")
      .maybeSingle();

    // Si falla por slug duplicado, intentar sin slug
    if (error?.message?.includes("slug") || error?.code === "23505") {
      ({ data: row, error } = await sb
        .from("courses")
        .insert({ ...payload, slug: undefined })
        .select("id")
        .maybeSingle());
    }

    setImporting(null);

    if (error) {
      setImportErr(`No se pudo importar "${title}": ${error.message}`);
      return;
    }

    setImportedIds((prev) => new Set([...prev, classroomCourse.id]));

    if (row?.id) {
      navigate(`/dashboard/org/${staffOrgId}/course/${row.id}`);
    }
  };

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

      {err ? (
        <p className="auth-card__notice auth-card__notice--err">
          {err}{" "}
          <button
            type="button"
            className="auth-link"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            onClick={() => void connectGoogleClassroom()}
          >
            Reconectar →
          </button>
        </p>
      ) : null}
      {okMsg ? <p className="auth-card__notice">{okMsg}</p> : null}
      {importErr ? <p className="auth-card__notice auth-card__notice--err">{importErr}</p> : null}

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

      {!staffOrgId ? (
        <p className="auth-card__notice">
          Creá un colegio en la pestaña{" "}
          <Link to="/dashboard?tab=schools">Colegios</Link> para poder importar cursos.
        </p>
      ) : null}

      {courses.length > 0 ? (
        <>
          <h3 className="auth-section__title">Tus cursos en Classroom</h3>
          {staffOrgId ? (
            <p className="auth-card__muted auth-card__muted--tight" style={{ marginBottom: "0.75rem" }}>
              Hacé clic en <strong>Importar</strong> para crear el curso en tu colegio PyBot.
            </p>
          ) : null}
          <ul className="auth-org-list">
            {courses.map((c) => {
              const alreadyImported = importedIds.has(c.id);
              const isImporting = importing === c.id;
              return (
                <li key={c.id} className="auth-org-row auth-org-row--split">
                  <div>
                    <span className="auth-org-row__name">{c.name || c.section || c.id}</span>
                    <span className="auth-org-row__meta">ID: {c.id}</span>
                  </div>
                  {staffOrgId ? (
                    alreadyImported ? (
                      <span className="dash-badge dash-badge--ok">Importado</span>
                    ) : (
                      <button
                        type="button"
                        className="auth-btn auth-btn--primary auth-btn--sm"
                        disabled={isImporting || !!importing}
                        onClick={() => void importCourse(c)}
                      >
                        {isImporting ? "Importando…" : "Importar"}
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
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
    </section>
  );
}
