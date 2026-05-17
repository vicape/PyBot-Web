import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { listCourseStudents } from "../classroom/classroomApi.js";
import { getValidClassroomToken } from "../platform/classroomToken.js";

// ─── Pestaña Actividades ─────────────────────────────────────────────────────

function ActivitiesTab({ activities, staff, orgId, courseId, saving, err, onCreateActivity }) {
  const activityUrl = (id) => `/actividad/${encodeURIComponent(id)}`;
  const [actTitle, setActTitle] = useState("");
  const [actDescription, setActDescription] = useState("");
  const [pybotLessonId, setPybotLessonId] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await onCreateActivity({ title: actTitle, description: actDescription, pybotLessonId });
    if (ok) {
      setActTitle("");
      setActDescription("");
      setPybotLessonId("");
    }
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
            placeholder="Ej. modulo-1-leccion-3"
            maxLength={120}
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
    if (!sb || !orgId) {
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);

    // 1) Traer membresías (estudiantes)
    const { data: rows, error: e1 } = await sb
      .from("organization_members")
      .select("user_id, role")
      .eq("org_id", orgId)
      .eq("role", "student");

    if (e1) {
      console.error("loadMembers:", e1);
      setMembers([]);
      setLoadingMembers(false);
      return;
    }

    const userIds = (rows ?? []).map((r) => r.user_id);
    if (userIds.length === 0) {
      setMembers([]);
      setLoadingMembers(false);
      return;
    }

    // 2) Traer perfiles (puede fallar parcialmente por RLS; lo manejamos)
    const { data: profs } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url, email")
      .in("id", userIds);

    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const merged = (rows ?? []).map((r) => ({
      user_id: r.user_id,
      role: r.role,
      profiles: profMap.get(r.user_id) ?? null,
    }));

    setMembers(merged);
    setLoadingMembers(false);
  }, [sb, orgId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const importFromClassroom = async () => {
    if (!sb || !classroomCourseId) return;
    setImportState("loading");
    setImportErr("");
    setImportResults([]);

    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) {
        setImportErr(
          "No hay token de Classroom. Andá al panel → Classroom y hacé clic en «Conectar Google Classroom».",
        );
        setImportState(null);
        return;
      }

      const classroomStudents = await listCourseStudents(tok, classroomCourseId);
      if (classroomStudents.length === 0) {
        setImportErr("No se encontraron alumnos en este curso de Classroom.");
        setImportState(null);
        return;
      }

      const results = [];
      for (const s of classroomStudents) {
        const email = s.profile?.emailAddress;
        const name = s.profile?.name?.fullName || email || s.userId;

        if (!email) {
          results.push({ name, email: null, status: "sin_email" });
          continue;
        }

        // Buscar perfil PyBot por email (usa función security definer)
        const { data: profileRows } = await sb.rpc("find_profile_by_email", { p_email: email });
        const profile = Array.isArray(profileRows) ? profileRows[0] : null;

        if (!profile?.id) {
          results.push({ name, email, status: "no_registrado" });
          continue;
        }

        // Verificar si ya es miembro
        const { data: existing } = await sb
          .from("organization_members")
          .select("role")
          .eq("org_id", orgId)
          .eq("user_id", profile.id)
          .maybeSingle();

        if (existing) {
          results.push({ name, email, status: "ya_miembro", role: existing.role });
          continue;
        }

        // Agregar al colegio
        const { error: insErr } = await sb.from("organization_members").insert({
          org_id: orgId,
          user_id: profile.id,
          role: "student",
        });

        if (insErr) {
          results.push({ name, email, status: "error", error: insErr.message });
        } else {
          results.push({ name, email, status: "importado" });
        }
      }

      setImportResults(results);
      setImportState("done");
      await loadMembers();
    } catch (ex) {
      setImportErr(
        ex?.status === 403
          ? "Token de Classroom sin permisos. Reconectá Classroom desde el panel."
          : ex?.message || "Error al importar alumnos.",
      );
      setImportState(null);
    }
  };

  const generateInvite = async () => {
    if (!sb || !user?.id || generatingInvite) return;
    setGeneratingInvite(true);
    const { data, error } = await sb
      .from("organization_invites")
      .insert({
        org_id: orgId,
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
    if (!sb || !orgId) return;
    setRemovingId(userId);
    await sb.from("organization_members").delete().eq("org_id", orgId).eq("user_id", userId);
    setRemovingId(null);
    await loadMembers();
  };

  const noRegistered = importResults.filter((r) => r.status === "no_registrado");
  const imported = importResults.filter((r) => r.status === "importado");

  return (
    <>
      {/* Lista de alumnos actuales */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h3 className="auth-section__title">
          Alumnos en el colegio ({loadingMembers ? "…" : members.length})
        </h3>
        {loadingMembers ? (
          <p className="auth-card__muted">Cargando…</p>
        ) : members.length === 0 ? (
          <p className="auth-card__muted">Todavía no hay alumnos. Importalos o compartí el código de invitación.</p>
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
                Busca los emails de los alumnos de Classroom en PyBot y los agrega automáticamente.
                Los que aún no tienen cuenta van a aparecer en una lista para compartirles el link.
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

              {importState === "done" && importResults.length > 0 ? (
                <div style={{ marginTop: "1rem" }}>
                  {imported.length > 0 ? (
                    <p className="auth-card__notice">
                      ✓ {imported.length} alumno(s) importados correctamente.
                    </p>
                  ) : null}
                  {importResults.filter((r) => r.status === "ya_miembro").length > 0 ? (
                    <p className="auth-card__muted auth-card__muted--tight">
                      {importResults.filter((r) => r.status === "ya_miembro").length} ya eran miembros.
                    </p>
                  ) : null}
                  {noRegistered.length > 0 ? (
                    <div>
                      <p className="auth-card__notice auth-card__notice--warn">
                        {noRegistered.length} alumno(s) aún no tienen cuenta en PyBot. Compartiles el
                        código de invitación para que se registren:
                      </p>
                      <ul className="auth-org-list" style={{ marginTop: "0.5rem" }}>
                        {noRegistered.map((r) => (
                          <li key={r.email} className="auth-org-row">
                            <span className="auth-org-row__name">{r.name}</span>
                            <span className="auth-org-row__meta">{r.email}</span>
                          </li>
                        ))}
                      </ul>
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
              Generá un link que los alumnos pueden usar para unirse al colegio sin que vos tengas
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
  const activeTab = searchParams.get("tab") === "alumnos" ? "alumnos" : "actividades";
  const setTab = (t) =>
    setSearchParams(t === "actividades" ? {} : { tab: t }, { replace: true });

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
      .select("id,title,description,pybot_lesson_id,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });

    if (e1) {
      const fb = await supabase
        .from("activities")
        .select("id,title,created_at")
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

  const createActivity = async ({ title, description, pybotLessonId }) => {
    const t = title.trim();
    if (!t || saving || !supabase || !staff || !user) return false;
    setSaving(true);
    setErr("");

    const base = { course_id: courseId, title: t, created_by: user.id };
    const full = {
      ...base,
      description: description.trim(),
      pybot_lesson_id: pybotLessonId.trim() || null,
      starter_code: "",
    };

    let { error } = await supabase.from("activities").insert(full);
    if (error?.message?.includes("description") || error?.message?.includes("pybot_lesson")) {
      ({ error } = await supabase
        .from("activities")
        .insert({ ...base, starter_code: description.trim() || "" }));
    }

    setSaving(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    await load();
    return true;
  };

  if (authLoading || loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide auth-card--max">
        <p className="auth-breadcrumb">
          <Link to="/dashboard" className="auth-link">Panel</Link>
          <span aria-hidden> / </span>
          <Link to={`/dashboard/org/${orgId}`} className="auth-link">{orgName || "Colegio"}</Link>
          <span aria-hidden> / </span>
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
          <button
            type="button"
            className={`course-tab${activeTab === "alumnos" ? " course-tab--active" : ""}`}
            onClick={() => setTab("alumnos")}
          >
            Alumnos
          </button>
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
      </div>
    </main>
  );
}
