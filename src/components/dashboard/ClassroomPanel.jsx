import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listTeacherClassroomCourses } from "../../classroom/classroomApi.js";
import { connectGoogleClassroom } from "../../platform/googleOAuth.js";
import {
  classroomOrgAccountNotice,
  loadClassroomOrgHint,
  pickInitialClassroomOrgId,
  resolveImportOrgId,
  saveClassroomOrgHint,
} from "../../platform/classroomOrgContext.js";
import { disconnectClassroomIntegration } from "../../platform/disconnectClassroom.js";
import { fetchProfile, markClassroomLinked } from "../../platform/profileApi.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import {
  CLASSROOM_CONNECTION,
  classifyClassroomConnectionError,
  classroomConnectionBadge,
  shouldShowClassroomReconnect,
} from "../../platform/classifyClassroomConnection.js";
import { getSupabase } from "../../supabaseClient.js";
import { importClassroomCourseToOrg } from "../../platform/importClassroomCourse.js";
import { track } from "../../telemetry/index.js";

export default function ClassroomPanel({
  user,
  staffOrgId,
  staffOrgs = [],
  canUseClassroom = true,
}) {
  const navigate = useNavigate();
  const [selectedOrgId, setSelectedOrgId] = useState(() =>
    pickInitialClassroomOrgId({
      preferredOrgId: staffOrgId,
      lastHintOrgId: loadClassroomOrgHint(),
      staffOrgs,
    }),
  );
  const effectiveOrgId = resolveImportOrgId({ selectedOrgId, staffOrgs });
  const hasAnyStaffOrg = staffOrgs.length > 0;
  const orgNotice = useMemo(
    () =>
      classroomOrgAccountNotice({
        selectedOrgId: effectiveOrgId,
        hintOrgId: loadClassroomOrgHint(),
      }),
    [effectiveOrgId, selectedOrgId],
  );

  /** Metadata histórica (última conexión exitosa conocida). No define salud actual. */
  const [linkedAt, setLinkedAt] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(CLASSROOM_CONNECTION.CHECKING);
  const [courses, setCourses] = useState([]);
  const [importedIds, setImportedIds] = useState(new Set());
  const [importing, setImporting] = useState(null); // classroom_course_id en curso
  const [importErr, setImportErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!canUseClassroom) return;
    track("classroom_open", { feature: "classroom" });
  }, [canUseClassroom]);

  const refreshCourses = useCallback(async () => {
    if (!canUseClassroom) return;
    const sb = getSupabase();
    if (!sb) return;
    setTesting(true);
    setConnectionStatus(CLASSROOM_CONNECTION.CHECKING);
    setErr("");
    setOkMsg("");
    try {
      const tok = await getValidClassroomToken(user?.id, {
        mode: "teacher",
        orgId: effectiveOrgId || null,
      });
      if (!tok) {
        setCourses([]);
        setConnectionStatus(CLASSROOM_CONNECTION.NOT_CONNECTED);
        return;
      }
      const list = await listTeacherClassroomCourses(tok);
      setCourses(list);
      setConnectionStatus(CLASSROOM_CONNECTION.CONNECTED);
      if (user?.id) {
        const mark = await markClassroomLinked(user.id);
        if (mark.ok && !mark.skipped) setLinkedAt(new Date().toISOString());
      }
      setOkMsg(`Conectado: ${list.length} curso(s) activo(s) en Classroom.`);

      // Cargar qué cursos ya fueron importados en el colegio seleccionado
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
      } else {
        setImportedIds(new Set());
      }
    } catch (ex) {
      console.error("ClassroomPanel.refreshCourses:", ex);
      setCourses([]);
      setOkMsg("");
      const classified = classifyClassroomConnectionError(ex);
      setConnectionStatus(classified.status);
      if (classified.message) setErr(classified.message);
      try {
        track("error", {
          error_code: ex?.code || "classroom_error",
          feature: "classroom",
          http_status: ex?.status || null,
        });
      } catch {
        //
      }
    } finally {
      setTesting(false);
    }
  }, [user?.id, effectiveOrgId, canUseClassroom]);

  useEffect(() => {
    if (staffOrgs.length === 0) {
      setSelectedOrgId("");
      return;
    }
    setSelectedOrgId((prev) => {
      const next = pickInitialClassroomOrgId({
        preferredOrgId: prev || staffOrgId,
        lastHintOrgId: loadClassroomOrgHint(),
        staffOrgs,
      });
      return next;
    });
  }, [staffOrgs, staffOrgId]);

  useEffect(() => {
    if (!canUseClassroom) {
      setLoading(false);
      return;
    }
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      setConnectionStatus(CLASSROOM_CONNECTION.CHECKING);
      const { profile } = await fetchProfile(user.id);
      // Sólo historial; el estado operativo lo define refreshCourses().
      setLinkedAt(profile?.classroom_linked_at ?? null);
      setLoading(false);
      await refreshCourses();
    })();
  }, [user?.id, refreshCourses, canUseClassroom]);

  const onSelectOrg = (orgId) => {
    setSelectedOrgId(orgId);
    if (orgId) saveClassroomOrgHint(orgId);
    setImportedIds(new Set());
  };

  const onConnectClassroom = () => {
    void connectGoogleClassroom(undefined, {
      mode: "teacher",
      orgId: effectiveOrgId || null,
    });
  };

  const onDisconnectClassroom = async () => {
    if (!user?.id || disconnecting) return;
    const ok = window.confirm(
      "¿Desconectar Google Classroom" +
        (effectiveOrgId ? " de este colegio" : "") +
        "?\n\n" +
        "Se quita la autorización de Classroom" +
        (effectiveOrgId ? " solo para el colegio seleccionado" : "") +
        ".\n" +
        "No se cierra tu sesión de PyBotClass ni se borran cursos, actividades ni entregas.",
    );
    if (!ok) return;
    setDisconnecting(true);
    setErr("");
    setOkMsg("");
    try {
      const r = await disconnectClassroomIntegration({
        userId: user.id,
        mode: "teacher",
        orgId: effectiveOrgId || null,
      });
      if (!r.ok) {
        setErr(r.error || "No se pudo desconectar Google Classroom.");
        return;
      }
      setCourses([]);
      setImportedIds(new Set());
      setLinkedAt(null);
      setConnectionStatus(CLASSROOM_CONNECTION.NOT_CONNECTED);
      setOkMsg("Google Classroom desconectado. Tu sesión de PyBotClass sigue activa.");
    } catch (ex) {
      setErr(ex?.message || "No se pudo desconectar Google Classroom.");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!canUseClassroom) {
    return null;
  }

  const importCourse = async (classroomCourse) => {
    const sb = getSupabase();
    const targetOrgId = resolveImportOrgId({ selectedOrgId, staffOrgs });
    if (!sb || !user?.id || !targetOrgId) {
      setImportErr("Seleccioná un colegio antes de importar.");
      return;
    }
    setImporting(classroomCourse.id);
    setImportErr("");

    const result = await importClassroomCourseToOrg(sb, {
      orgId: targetOrgId,
      classroomCourse,
      userId: user.id,
    });

    setImporting(null);

    if (!result.ok) {
      const title =
        classroomCourse.name || classroomCourse.section || `Curso ${classroomCourse.id}`;
      console.error("importCourse:", result);
      setImportErr(result.message || `No se pudo importar "${title}".`);
      return;
    }

    setImportedIds((prev) => new Set([...prev, classroomCourse.id]));
    if (result.courseId) {
      navigate(`/dashboard/org/${targetOrgId}/course/${result.courseId}`);
    }
  };

  if (loading) {
    return <p className="auth-card__muted">Comprobando Classroom…</p>;
  }

  const badge = classroomConnectionBadge(connectionStatus);
  const badgeClass =
    badge.tone === "ok" ? "dash-badge dash-badge--ok" : "dash-badge dash-badge--muted";
  const showReconnect = shouldShowClassroomReconnect(connectionStatus);

  return (
    <section className="dash-panel">
      <h2 className="dash-panel__title">Google Classroom</h2>
      <p className="auth-card__muted auth-card__muted--tight">
        Como docente podés vincular tu cuenta de Google para listar cursos y enlazarlos a PyBot desde cada
        colegio.
      </p>

      {hasAnyStaffOrg ? (
        <label className="auth-org-label" style={{ display: "block", marginBottom: "0.75rem" }}>
          Importar en colegio:
          <select
            className="auth-org-input auth-org-input--block"
            value={effectiveOrgId || selectedOrgId || ""}
            onChange={(e) => onSelectOrg(e.target.value)}
            style={{ marginTop: "0.35rem" }}
          >
            {staffOrgs.length > 1 && !effectiveOrgId ? (
              <option value="">Elegí un colegio…</option>
            ) : null}
            {staffOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="auth-card__muted auth-card__muted--tight" style={{ marginBottom: "0.75rem" }}>
        {orgNotice.message}
      </p>

      <div className="dash-status-row">
        <span className={badgeClass}>{badge.label}</span>
        {linkedAt ? (
          <span className="auth-card__muted auth-card__muted--tight">
            Última conexión exitosa: {new Date(linkedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {err ? (
        <p className="auth-card__notice auth-card__notice--err">
          {err}{" "}
          {showReconnect ? (
            <button
              type="button"
              className="auth-link"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              onClick={onConnectClassroom}
            >
              Reconectar →
            </button>
          ) : null}
        </p>
      ) : null}
      {okMsg && connectionStatus === CLASSROOM_CONNECTION.CONNECTED ? (
        <p className="auth-card__notice">{okMsg}</p>
      ) : null}
      {importErr ? <p className="auth-card__notice auth-card__notice--err">{importErr}</p> : null}

      <div className="auth-org-row__actions" style={{ marginBottom: "1rem" }}>
        <p className="auth-card__muted" style={{ marginBottom: "0.5rem" }}>
          Vinculá la cuenta Google que usás para Classroom. Puede ser distinta de tu cuenta de
          PyBotClass.
        </p>
        <button
          type="button"
          className="auth-btn auth-btn--primary"
          onClick={onConnectClassroom}
        >
          {connectionStatus === CLASSROOM_CONNECTION.RECONNECT_REQUIRED ||
          connectionStatus === CLASSROOM_CONNECTION.INSUFFICIENT_PERMISSIONS
            ? "Reconectar Google Classroom"
            : "Conectar Google Classroom"}
        </button>
        <button
          type="button"
          className="auth-btn auth-btn--ghost"
          disabled={testing}
          onClick={() => void refreshCourses()}
        >
          {testing ? "Comprobando…" : "Probar conexión"}
        </button>
        {connectionStatus !== CLASSROOM_CONNECTION.NOT_CONNECTED &&
        connectionStatus !== CLASSROOM_CONNECTION.CHECKING ? (
          <button
            type="button"
            className="auth-btn auth-btn--ghost"
            disabled={disconnecting || testing}
            onClick={() => void onDisconnectClassroom()}
          >
            {disconnecting ? "Desconectando…" : "Desconectar Classroom"}
          </button>
        ) : null}
      </div>

      {!hasAnyStaffOrg ? (
        <p className="auth-card__notice">
          Creá un colegio en la pestaña{" "}
          <Link to="/dashboard?tab=schools">Colegios</Link> para poder importar cursos.
        </p>
      ) : null}

      {connectionStatus === CLASSROOM_CONNECTION.CONNECTED && courses.length > 0 ? (
        <>
          <h3 className="auth-section__title">Tus cursos en Classroom</h3>
          {effectiveOrgId ? (
            <p className="auth-card__muted auth-card__muted--tight" style={{ marginBottom: "0.75rem" }}>
              Hacé clic en <strong>Importar</strong> para crear el curso en el colegio seleccionado.
            </p>
          ) : (
            <p className="auth-card__notice" style={{ marginBottom: "0.75rem" }}>
              Seleccioná un colegio arriba antes de importar.
            </p>
          )}
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
                  {effectiveOrgId ? (
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
          {connectionStatus === CLASSROOM_CONNECTION.CONNECTED
            ? "No hay cursos activos donde seas docente en Classroom."
            : "Tras conectar, acá verás los cursos donde sos docente. Luego importalos en "}
          {connectionStatus !== CLASSROOM_CONNECTION.CONNECTED ? (
            effectiveOrgId ? (
              <Link to={`/dashboard/org/${effectiveOrgId}`}>Cursos del colegio</Link>
            ) : (
              "la sección Cursos de tu colegio"
            )
          ) : null}
          {connectionStatus !== CLASSROOM_CONNECTION.CONNECTED ? "." : null}
        </p>
      )}
    </section>
  );
}
