import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listTeacherClassroomCourses } from "../../classroom/classroomApi.js";
import { connectGoogleClassroom } from "../../platform/googleOAuth.js";
import { fetchProfile, markClassroomLinked } from "../../platform/profileApi.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import { getSupabase } from "../../supabaseClient.js";
import { slugifyOrganizationName } from "../../slugify.js";
import { track } from "../../telemetry/index.js";

function classroomErrorEs(err) {
  const code = err?.code;
  // missing_access_token se muestra como UI vacía (no error), no como mensaje de error
  if (code === "missing_access_token") return null;
  if (err?.status === 403) {
    return "El token de Classroom expiró o no tiene permisos. Hacé clic en «Conectar Google Classroom» para renovarlo.";
  }
  return err?.message || "No se pudo comunicar con Classroom.";
}

export default function ClassroomPanel({ user, staffOrgId, staffOrgs = [] }) {
  const navigate = useNavigate();
  const [selectedOrgId, setSelectedOrgId] = useState(staffOrgId || staffOrgs[0]?.id || "");
  const effectiveOrgId = selectedOrgId || staffOrgId || "";
  const [linkedAt, setLinkedAt] = useState(null);
  const [courses, setCourses] = useState([]);
  const [importedIds, setImportedIds] = useState(new Set());
  const [importing, setImporting] = useState(null); // classroom_course_id en curso
  const [importErr, setImportErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    track("classroom_open", { feature: "classroom" });
  }, []);

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
      if (sb && effectiveOrgId) {
        const { data: existing, error: eEx } = await sb
          .from("courses")
          .select("classroom_course_id")
          .eq("org_id", effectiveOrgId)
          .not("classroom_course_id", "is", null);
        if (eEx) {
          console.error("ClassroomPanel.loadImported:", eEx);
        } else if (existing) {
          setImportedIds(new Set(existing.map((r) => r.classroom_course_id)));
        }
      }
    } catch (ex) {
      console.error("ClassroomPanel.refreshCourses:", ex);
      setCourses([]);
      const msg = classroomErrorEs(ex);
      if (msg) setErr(msg);
      try {
        track("error", {
          error_code: ex?.code || "classroom_error",
          feature: "classroom",
          http_status: ex?.status || null,
        });
      } catch {
        //
      }
      // si msg es null (missing_access_token) no mostramos error, solo el botón conectar
    } finally {
      setTesting(false);
    }
  }, [user?.id, effectiveOrgId]);

  useEffect(() => {
    if (staffOrgId && !selectedOrgId) setSelectedOrgId(staffOrgId);
  }, [staffOrgId, selectedOrgId]);

  useEffect(() => {
    if (staffOrgs.length === 1 && staffOrgs[0]?.id) {
      setSelectedOrgId(staffOrgs[0].id);
    }
  }, [staffOrgs]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      const { profile } = await fetchProfile(user.id);
      setLinkedAt(profile?.classroom_linked_at ?? null);
      setLoading(false);
      // Intentar cargar cursos siempre — si no hay token, refreshCourses lo maneja silenciosamente
      await refreshCourses();
    })();
  }, [user?.id, refreshCourses]);

  const importCourse = async (classroomCourse) => {
    const sb = getSupabase();
    if (!sb || !user?.id || !effectiveOrgId) {
      setImportErr("Seleccioná un colegio antes de importar.");
      return;
    }
    setImporting(classroomCourse.id);
    setImportErr("");

    const title = classroomCourse.name || classroomCourse.section || `Curso ${classroomCourse.id}`;
    const slug = slugifyOrganizationName(title);

    // 1) Chequear si ya existe un curso con este classroom_course_id en este colegio
    const { data: existing } = await sb
      .from("courses")
      .select("id")
      .eq("org_id", effectiveOrgId)
      .eq("classroom_course_id", classroomCourse.id)
      .maybeSingle();

    if (existing?.id) {
      setImporting(null);
      setImportedIds((prev) => new Set([...prev, classroomCourse.id]));
      navigate(`/dashboard/org/${effectiveOrgId}/course/${existing.id}`);
      return;
    }

    const payload = {
      org_id: effectiveOrgId,
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

    // Si falla por slug/columna, reintento progresivos
    if (error?.message?.includes("slug")) {
      const { slug: _omitSlug, ...withoutSlug } = payload;
      ({ data: row, error } = await sb
        .from("courses")
        .insert(withoutSlug)
        .select("id")
        .maybeSingle());
    }
    if (error?.message?.includes("classroom_course_id")) {
      const { classroom_course_id: _omitCl, ...withoutCl } = payload;
      ({ data: row, error } = await sb
        .from("courses")
        .insert(withoutCl)
        .select("id")
        .maybeSingle());
    }

    setImporting(null);

    if (error) {
      console.error("importCourse:", error);
      setImportErr(`No se pudo importar "${title}": ${error.message}`);
      return;
    }

    setImportedIds((prev) => new Set([...prev, classroomCourse.id]));

    if (row?.id) {
      navigate(`/dashboard/org/${effectiveOrgId}/course/${row.id}`);
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

      {staffOrgs.length >= 2 ? (
        <label className="auth-org-label" style={{ display: "block", marginBottom: "0.75rem" }}>
          Importar en colegio:
          <select
            className="auth-org-input auth-org-input--block"
            value={effectiveOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            style={{ marginTop: "0.35rem" }}
          >
            {staffOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
