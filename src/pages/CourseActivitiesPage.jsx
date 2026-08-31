import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { listCourseStudents } from "../classroom/classroomApi.js";
import {
  classroomSyncErrorMessage,
  syncClassroomRosterToCourse,
} from "../classroom/classroomRosterSync.js";
import { getValidClassroomToken } from "../platform/classroomToken.js";
import { updateCourseActivity } from "../platform/courseActivityApi.js";
import DashboardSubpageShell from "../components/dashboard/DashboardSubpageShell.jsx";

// ─── Pestaña Actividades ─────────────────────────────────────────────────────

function ActivitiesTab({
  activities,
  staff,
  orgId,
  courseId,
  saving,
  err,
  onCreateActivity,
  onUpdateActivity,
}) {
  const activityUrl = (id) => `/actividad/${encodeURIComponent(id)}`;
  const [actTitle, setActTitle] = useState("");
  const [actDescription, setActDescription] = useState("");
  const [pybotLessonId, setPybotLessonId] = useState("");
  const [starterCode, setStarterCode] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPybotLessonId, setEditPybotLessonId] = useState("");
  const [editStarterCode, setEditStarterCode] = useState("");

  const startEdit = (a) => {
    setEditingId(a.id);
    setEditTitle(a.title || "");
    setEditDescription(a.description || "");
    setEditPybotLessonId(a.pybot_lesson_id || "");
    setEditStarterCode(a.starter_code || "");
  };

  const cancelEdit = () => setEditingId(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await onCreateActivity({
      title: actTitle,
      description: actDescription,
      pybotLessonId,
      starterCode,
    });
    if (ok) {
      setActTitle("");
      setActDescription("");
      setPybotLessonId("");
      setStarterCode("");
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    const ok = await onUpdateActivity(editingId, {
      title: editTitle,
      description: editDescription,
      pybotLessonId: editPybotLessonId,
      starterCode: editStarterCode,
    });
    if (ok) setEditingId(null);
  };

  return (
    <>
      {activities.length === 0 ? (
        <p className="auth-card__muted">Todavía no hay actividades en este curso.</p>
      ) : (
        <ul className="auth-org-list">
          {activities.map((a) => (
            <li key={a.id} className="auth-org-row auth-org-row--split">
              <div>
                <span className="auth-org-row__name">{a.title}</span>
                <span className="auth-org-row__meta">
                  {a.description ? a.description.slice(0, 80) : "Ver actividad"}
                </span>
              </div>
              <div className="auth-org-row__actions">
                {staff ? (
                  <button
                    type="button"
                    className="auth-btn auth-btn--ghost auth-btn--sm"
                    onClick={() => startEdit(a)}
                  >
                    Editar
                  </button>
                ) : null}
                <Link className="auth-btn auth-btn--ghost auth-btn--sm" to={activityUrl(a.id)}>
                  Abrir
                </Link>
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `${window.location.origin}${activityUrl(a.id)}`,
                    )
                  }
                >
                  Copiar enlace
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {staff && editingId ? (
        <form className="auth-activity-form" onSubmit={handleEditSubmit}>
          <h2 className="auth-section__title">Editar actividad</h2>
          {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
          <label className="auth-org-label" htmlFor="edit-act-title">
            Título
          </label>
          <input
            id="edit-act-title"
            className="auth-org-input auth-org-input--block"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            maxLength={160}
            disabled={saving}
            required
          />
          <label className="auth-org-label" htmlFor="edit-act-desc">
            Descripción
          </label>
          <textarea
            id="edit-act-desc"
            className="auth-code-area"
            rows={4}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Instrucciones para el alumno"
            disabled={saving}
          />
          <label className="auth-org-label" htmlFor="edit-act-lesson">
            ID lección PyBot (opcional)
          </label>
          <input
            id="edit-act-lesson"
            className="auth-org-input auth-org-input--block"
            value={editPybotLessonId}
            onChange={(e) => setEditPybotLessonId(e.target.value)}
            placeholder="Ej. U1 - T1"
            maxLength={120}
            disabled={saving}
          />
          <label className="auth-org-label" htmlFor="edit-act-starter">
            Código inicial (plantilla en el IDE, fase siguiente)
          </label>
          <textarea
            id="edit-act-starter"
            className="auth-code-area"
            rows={4}
            value={editStarterCode}
            onChange={(e) => setEditStarterCode(e.target.value)}
            disabled={saving}
          />
          <div className="auth-card__actions auth-card__actions--row">
            <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--ghost"
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {staff ? (
        <form className="auth-activity-form" onSubmit={handleSubmit}>
          <h2 className="auth-section__title">Nueva actividad</h2>
          {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
          <label className="auth-org-label" htmlFor="act-title">
            Título
          </label>
          <input
            id="act-title"
            className="auth-org-input auth-org-input--block"
            value={actTitle}
            onChange={(e) => setActTitle(e.target.value)}
            placeholder="Ej. Semáforo con wait"
            maxLength={160}
            disabled={saving}
          />
          <label className="auth-org-label" htmlFor="act-desc">
            Descripción
          </label>
          <textarea
            id="act-desc"
            className="auth-code-area"
            rows={4}
            value={actDescription}
            onChange={(e) => setActDescription(e.target.value)}
            placeholder="Instrucciones para el alumno"
            disabled={saving}
          />
          <label className="auth-org-label" htmlFor="act-lesson">
            ID lección PyBot (opcional)
          </label>
          <input
            id="act-lesson"
            className="auth-org-input auth-org-input--block"
            value={pybotLessonId}
            onChange={(e) => setPybotLessonId(e.target.value)}
            placeholder="Ej. U1 - T1"
            maxLength={120}
            disabled={saving}
          />
          <label className="auth-org-label" htmlFor="act-starter">
            Código inicial (plantilla en el IDE, fase siguiente)
          </label>
          <textarea
            id="act-starter"
            className="auth-code-area"
            rows={4}
            value={starterCode}
            onChange={(e) => setStarterCode(e.target.value)}
            disabled={saving}
          />
          <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
            {saving ? "Creando…" : "Crear actividad"}
          </button>
        </form>
      ) : (
        <p className="auth-card__muted">Tu docente publica las actividades nuevas.</p>
      )}
    </>
  );
}

// ─── Pestaña Alumnos ─────────────────────────────────────────────────────────

function StudentsTab({ orgId, courseId, classroomCourseId, user, staff }) {
  const sb = getSupabase();
  const [members, setMembers] = useState([]);
  const [pending, setPending] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [importState, setImportState] = useState(null); // null | 'loading' | 'done'
  const [importResults, setImportResults] = useState([]);
  const [importErr, setImportErr] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const loadMembers = useCallback(async () => {
    if (!sb || !courseId) {
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);

    const rpc = await sb.rpc("list_course_members", { p_course_id: courseId });
    if (rpc.error) {
      console.error("loadMembers.list_course_members:", rpc.error);
      setMembers([]);
    } else {
      const students = (rpc.data ?? []).filter((r) => r.role === "student");
      setMembers(
        students.map((r) => ({
          user_id: r.user_id,
          role: r.role,
          source: r.source,
          profiles: {
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            email: r.email,
          },
        })),
      );
    }

    const pendingRpc = await sb.rpc("list_course_roster_pending", { p_course_id: courseId });
    if (pendingRpc.error) {
      if (!/list_course_roster_pending|Could not find the function/i.test(pendingRpc.error.message || "")) {
        console.error("loadMembers.list_course_roster_pending:", pendingRpc.error);
      }
      setPending([]);
    } else {
      setPending(pendingRpc.data ?? []);
    }

    setLoadingMembers(false);
  }, [sb, courseId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const importFromClassroom = async () => {
    if (!sb || !classroomCourseId) {
      setImportErr("Este curso no tiene classroom_course_id vinculado.");
      return;
    }
    if (!orgId || !courseId) {
      setImportErr("Faltan datos del curso o del colegio.");
      return;
    }
    setImportState("loading");
    setImportErr("");
    setImportResults([]);

    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) {
        setImportErr(classroomSyncErrorMessage({ code: "missing_access_token" }));
        setImportState(null);
        return;
      }

      const classroomStudents = await listCourseStudents(tok, classroomCourseId);
      if (classroomStudents.length === 0) {
        setImportErr("No se encontraron alumnos en este curso de Classroom.");
        setImportState(null);
        return;
      }

      const sync = await syncClassroomRosterToCourse(sb, {
        courseId,
        orgId,
        classroomStudents,
      });

      if (!sync.ok) {
        const raw = sync.error || "";
        const missingRpc =
          /sync_classroom_course_roster|list_course_members|Could not find the function|schema cache/i.test(
            raw,
          );
        setImportErr(
          missingRpc
            ? "Falta aplicar en Supabase la migración 013 (course_members). Sin eso no se pueden guardar alumnos del curso."
            : classroomSyncErrorMessage({ message: raw, code: raw }),
        );
        setImportResults(sync.results ?? []);
        setImportState(sync.results?.length ? "done" : null);
        return;
      }

      setImportResults(sync.results);
      setImportState("done");

      // Mostrar pendientes de inmediato (nombre + email), aunque la DB aún no responda
      const pendingFromSync =
        sync.pendingRows ??
        (sync.results || [])
          .filter((r) => r.status === "no_registrado" && r.email)
          .map((r) => ({
            classroom_user_id: r.classroomUserId,
            email: r.email,
            display_name: r.name,
          }));
      if (pendingFromSync.length > 0) {
        setPending(pendingFromSync);
      }

      await loadMembers();

      // Si loadMembers no trajo pendientes (migración faltante), conservar los del import
      setPending((prev) => (prev.length > 0 ? prev : pendingFromSync));

      if (pendingFromSync.length > 0 && (sync.pendingUpserted ?? 0) === 0) {
        setImportErr(
          "Los alumnos se muestran abajo, pero falta aplicar en Supabase la migración 017 para guardarlos. Ejecutá 20260829000017_replace_course_roster_pending.sql",
        );
      }
    } catch (ex) {
      console.error("importFromClassroom:", ex);
      setImportErr(classroomSyncErrorMessage(ex));
      setImportState(null);
    }
  };

  const generateInvite = async () => {
    if (!sb || !user?.id || !courseId || generatingInvite) return;
    setGeneratingInvite(true);
    const { data, error } = await sb
      .from("organization_invites")
      .insert({
        org_id: orgId,
        course_id: courseId,
        role: "student",
        max_uses: 100,
        created_by: user.id,
      })
      .select("code")
      .maybeSingle();
    setGeneratingInvite(false);
    if (error || !data?.code) return;
    const code = data.code;
    setInviteCode(code);
    setInviteLink(`${window.location.origin}/join?code=${code}`);
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteLink || inviteCode);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const removeMember = async (userId) => {
    if (!sb || !courseId) return;
    setRemovingId(userId);
    const { data, error } = await sb.rpc("remove_course_member", {
      p_course_id: courseId,
      p_user_id: userId,
    });
    if (error) {
      console.error("removeMember:", error);
    } else if (!data?.ok) {
      console.error("removeMember:", data?.error || "sin_permisos");
    }
    setRemovingId(null);
    await loadMembers();
  };

  const noRegistered = importResults.filter((r) => r.status === "no_registrado");
  const imported = importResults.filter((r) => r.status === "importado");
  const updated = importResults.filter((r) => r.status === "actualizado");
  const sinEmail = importResults.filter((r) => r.status === "sin_email");

  return (
    <>
      {/* Lista de alumnos actuales + pendientes Classroom */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h3 className="auth-section__title">
          Alumnos del curso (
          {loadingMembers
            ? "…"
            : `${members.length} activo${members.length === 1 ? "" : "s"}${
                pending.length
                  ? ` · ${pending.length} pendiente${pending.length === 1 ? "" : "s"}`
                  : ""
              }`}
          )
        </h3>
        {loadingMembers ? (
          <p className="auth-card__muted">Cargando…</p>
        ) : members.length === 0 && pending.length === 0 ? (
          <p className="auth-card__muted">
            Todavía no hay alumnos en este curso. Sincronizalos desde Classroom (quedan pendientes hasta
            que inicien sesión) o compartí el código de invitación de este curso.
          </p>
        ) : (
          <ul className="auth-org-list">
            {members.map((m) => (
              <li key={m.user_id} className="auth-org-row auth-org-row--split">
                <div>
                  <span className="auth-org-row__name">
                    {m.profiles?.display_name || m.user_id}
                  </span>
                  <span className="auth-org-row__meta">{m.profiles?.email || ""}</span>
                </div>
                {staff ? (
                  <button
                    type="button"
                    className="auth-btn auth-btn--ghost auth-btn--sm"
                    disabled={removingId === m.user_id}
                    onClick={() => void removeMember(m.user_id)}
                  >
                    {removingId === m.user_id ? "…" : "Quitar"}
                  </button>
                ) : null}
              </li>
            ))}
            {pending.map((p) => (
              <li
                key={p.classroom_user_id || p.email}
                className="auth-org-row auth-org-row--split"
                style={{ opacity: 0.6 }}
              >
                <div>
                  <span className="auth-org-row__name">{p.display_name || "Sin nombre"}</span>
                  <span className="auth-org-row__meta">{p.email}</span>
                  <span className="auth-org-row__meta">
                    Incorporado al curso · aún no inició sesión en PyBot
                  </span>
                </div>
                <span className="dash-badge dash-badge--muted">Sin login</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {staff ? (
        <>
          {/* Importar desde Classroom */}
          {classroomCourseId ? (
            <div className="dash-panel" style={{ marginBottom: "1.25rem", padding: "1rem" }}>
              <h3 className="auth-section__title">Importar desde Google Classroom</h3>
              <p className="auth-card__muted auth-card__muted--tight">
                Sincroniza el roster de Classroom con este curso: agrega alumnos nuevos, actualiza los
                existentes y quita del curso a quienes ya no están en Classroom. Los que aún no tienen
                cuenta PyBot aparecen en la lista para invitarlos.
              </p>
              {importErr ? (
                <p className="auth-card__notice auth-card__notice--err">{importErr}</p>
              ) : null}
              <button
                type="button"
                className="auth-btn auth-btn--primary"
                disabled={importState === "loading"}
                onClick={() => void importFromClassroom()}
              >
                {importState === "loading" ? "Importando…" : "Importar alumnos de Classroom"}
              </button>

              {importState === "done" ? (
                <div style={{ marginTop: "1rem" }}>
                  <p className="auth-card__muted auth-card__muted--tight">
                    Resultado: {importResults.length} alumno(s) en Classroom · {imported.length}{" "}
                    agregados · {updated.length} actualizados · {noRegistered.length} sin cuenta
                    PyBot · {sinEmail.length} sin email
                  </p>
                  {imported.length === 0 && updated.length === 0 ? (
                    <p className="auth-card__notice auth-card__notice--warn">
                      Ninguno tenía cuenta PyBot todavía. Quedan como pendientes (grisados); al iniciar
                      sesión con ese email se activan solos. También podés usar el código de
                      invitación del curso.
                    </p>
                  ) : null}
                  {imported.length > 0 ? (
                    <p className="auth-card__notice">
                      ✓ {imported.length} alumno(s) agregados al curso.
                    </p>
                  ) : null}
                  {updated.length > 0 ? (
                    <p className="auth-card__muted auth-card__muted--tight">
                      {updated.length} alumno(s) ya estaban en el curso y se actualizaron.
                    </p>
                  ) : null}
                  {sinEmail.length > 0 ? (
                    <div>
                      <p className="auth-card__notice auth-card__notice--warn">
                        {sinEmail.length} sin email expuesto por Google. Reconectá Classroom (hace
                        falta el permiso de emails del perfil) o usá el código de invitación:
                      </p>
                      <ul className="auth-org-list" style={{ marginTop: "0.5rem" }}>
                        {sinEmail.map((r) => (
                          <li key={r.classroomUserId || r.name} className="auth-org-row">
                            <span className="auth-org-row__name">{r.name}</span>
                            <span className="auth-org-row__meta">sin email</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {noRegistered.length > 0 ? (
                    <div>
                      <p className="auth-card__notice auth-card__notice--warn">
                        {noRegistered.length} quedaron como pendientes (grisados). Cuando inicien
                        sesión en PyBot con ese mismo email, se activan solos en el curso.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="auth-card__muted auth-card__muted--tight" style={{ marginBottom: "1rem" }}>
              Este curso no está vinculado a un curso de Classroom. Importalo desde el{" "}
              <Link to="/dashboard?tab=classroom">panel → Classroom</Link>.
            </p>
          )}

          {/* Código de invitación */}
          <div className="dash-panel" style={{ padding: "1rem" }}>
            <h3 className="auth-section__title">Código de invitación</h3>
            <p className="auth-card__muted auth-card__muted--tight">
              Generá un link que los alumnos pueden usar para unirse a este curso sin que vos tengas
              que agregarlos manualmente.
            </p>
            {inviteLink ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <code
                  className="auth-card__codehint"
                  style={{ userSelect: "all", wordBreak: "break-all" }}
                >
                  {inviteLink}
                </code>
                <button
                  type="button"
                  className="auth-btn auth-btn--primary auth-btn--sm"
                  onClick={() => void copyInvite()}
                >
                  {copiedInvite ? "¡Copiado!" : "Copiar link"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="auth-btn auth-btn--ghost"
                disabled={generatingInvite}
                onClick={() => void generateInvite()}
              >
                {generatingInvite ? "Generando…" : "Generar código de invitación"}
              </button>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function CourseActivitiesPage() {
  const { orgId, courseId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const loginPath = `/dashboard/org/${orgId}/course/${courseId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [courseTitle, setCourseTitle] = useState("");
  const [classroomCourseId, setClassroomCourseId] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [myRole, setMyRole] = useState(null);

  const staff = isStaffRole(myRole);
  const activeTab =
    staff && searchParams.get("tab") === "alumnos" ? "alumnos" : "actividades";
  const setTab = (t) =>
    setSearchParams(t === "actividades" ? {} : { tab: t }, { replace: true });

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut:", error);
    }
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const shell = (body) => (
    <DashboardSubpageShell user={user} myRole={myRole} onSignOut={() => void signOut()}>
      {body}
    </DashboardSubpageShell>
  );

  const load = useCallback(async () => {
    if (!supabase || !courseId || !user) return;
    setErr("");
    setLoading(true);

    const { data: course, error: e0 } = await supabase
      .from("courses")
      .select("title, org_id, classroom_course_id")
      .eq("id", courseId)
      .maybeSingle();

    if (e0 || !course) {
      setErr(e0?.message || "Curso no encontrado.");
      setLoading(false);
      return;
    }

    setCourseTitle(course.title ?? "");
    setClassroomCourseId(course.classroom_course_id ?? null);

    try {
      const r = await fetchMyOrgRole(supabase, course.org_id, user.id);
      setMyRole(r);
    } catch {
      setMyRole(null);
    }

    if (course.org_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", course.org_id)
        .maybeSingle();
      setOrgName(org?.name ?? "");
    }

    let { data: rows, error: e1 } = await supabase
      .from("activities")
      .select("id,title,description,pybot_lesson_id,starter_code,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });

    if (e1) {
      const fb = await supabase
        .from("activities")
        .select("id,title,description,pybot_lesson_id,created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });
      if (fb.error) setErr(fb.error.message);
      else setActivities(fb.data ?? []);
    } else {
      setActivities(rows ?? []);
    }

    setLoading(false);
  }, [supabase, courseId, user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const createActivity = async ({ title, description, pybotLessonId, starterCode }) => {
    const t = title.trim();
    if (!t || saving || !supabase || !staff || !user) return false;
    setSaving(true);
    setErr("");

    const base = { course_id: courseId, title: t, created_by: user.id };
    const full = {
      ...base,
      description: description.trim(),
      pybot_lesson_id: pybotLessonId.trim() || null,
      starter_code: starterCode?.trim() ?? "",
    };

    let { error } = await supabase.from("activities").insert(full);

    if (error?.message?.includes("starter_code")) {
      const { starter_code: _omitStarter, ...withoutStarter } = full;
      ({ error } = await supabase.from("activities").insert(withoutStarter));
    }

    if (
      error &&
      (error.message?.includes("description") || error.message?.includes("pybot_lesson"))
    ) {
      ({ error } = await supabase.from("activities").insert(base));
    }

    setSaving(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    await load();
    return true;
  };

  const updateActivity = async (activityId, { title, description, pybotLessonId, starterCode }) => {
    if (saving || !supabase || !staff || !activityId) return false;
    setSaving(true);
    setErr("");

    const result = await updateCourseActivity(supabase, activityId, {
      title,
      description,
      pybotLessonId,
      starterCode,
    });

    setSaving(false);
    if (!result.ok) {
      setErr(result.error || "No se pudo guardar la actividad.");
      return false;
    }
    await load();
    return true;
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p className="auth-card__muted">Cargando…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return shell(
    <>
        <p className="auth-breadcrumb">
          <Link to="/dashboard" className="auth-link">Inicio</Link>
          <span aria-hidden> / </span>
          {staff ? (
            <>
              <Link to="/dashboard?tab=schools" className="auth-link">Colegios</Link>
              <span aria-hidden> / </span>
              <Link to={`/dashboard/org/${orgId}`} className="auth-link">{orgName || "Colegio"}</Link>
              <span aria-hidden> / </span>
            </>
          ) : (
            <>
              <Link to="/dashboard?tab=courses" className="auth-link">Mis cursos</Link>
              <span aria-hidden> / </span>
            </>
          )}
          <span>{courseTitle || "Curso"}</span>
        </p>

        <h1 className="auth-card__title">
          {courseTitle || "Curso"}
          <span
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 500,
              opacity: 0.75,
              marginTop: "0.25rem",
            }}
          >
            Tu rol: {roleLabelEs(myRole)}
          </span>
        </h1>

        {profileError ? (
          <p className="auth-card__notice auth-card__notice--err">{profileError}</p>
        ) : null}

        {/* Pestañas */}
        <nav className="course-tabs" aria-label="Secciones del curso">
          <button
            type="button"
            className={`course-tab${activeTab === "actividades" ? " course-tab--active" : ""}`}
            onClick={() => setTab("actividades")}
          >
            Actividades
            {activities.length > 0 ? (
              <span className="course-tab__count">{activities.length}</span>
            ) : null}
          </button>
          {staff ? (
            <button
              type="button"
              className={`course-tab${activeTab === "alumnos" ? " course-tab--active" : ""}`}
              onClick={() => setTab("alumnos")}
            >
              Alumnos
            </button>
          ) : null}
        </nav>

        {activeTab === "actividades" ? (
          <ActivitiesTab
            activities={activities}
            staff={staff}
            orgId={orgId}
            courseId={courseId}
            saving={saving}
            err={err}
            onCreateActivity={createActivity}
            onUpdateActivity={updateActivity}
          />
        ) : (
          <StudentsTab
            orgId={orgId}
            courseId={courseId}
            classroomCourseId={classroomCourseId}
            user={user}
            staff={staff}
          />
        )}

        <div style={{ marginTop: "1.5rem" }}>
          <Link to="/" className="auth-link">Ir al IDE (anónimo)</Link>
        </div>
    </>,
  );
}
