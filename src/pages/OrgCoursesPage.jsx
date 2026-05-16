import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listTeacherClassroomCourses } from "../classroom/classroomApi.js";
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

export default function OrgCoursesPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);

  const [orgName, setOrgName] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [myRole, setMyRole] = useState(null);

  const [invites, setInvites] = useState([]);
  const [inviteErr, setInviteErr] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);

  const [gcErr, setGcErr] = useState("");
  const [gcBusy, setGcBusy] = useState(false);
  const [gcCourses, setGcCourses] = useState([]);
  const [pickedGcId, setPickedGcId] = useState("");
  const [pickedCourseLinkId, setPickedCourseLinkId] = useState("");
  const [linkGcBusy, setLinkGcBusy] = useState(false);

  const staff = isStaffRole(myRole);

  const loadInvites = useCallback(async () => {
    if (!supabase || !orgId || !staff) {
      setInvites([]);
      return;
    }
    setInviteErr("");
    const { data, error } = await supabase
      .from("organization_invites")
      .select("id,code,role,max_uses,use_count,expires_at,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) setInviteErr(error.message);
    else setInvites(data ?? []);
  }, [supabase, orgId, staff]);

  const load = useCallback(async () => {
    if (!supabase || !orgId) return;
    setErr("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      try {
        const r = await fetchMyOrgRole(supabase, orgId, user.id);
        setMyRole(r);
      } catch {
        setMyRole(null);
      }
    } else {
      setMyRole(null);
    }

    const { data: org, error: e0 } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (e0 || !org) {
      setErr(e0?.message || "Colegio no encontrado o sin permiso.");
      setLoading(false);
      return;
    }
    setOrgName(org.name ?? "");
    const { data: rows, error: e1 } = await supabase
      .from("courses")
      .select("id,title,created_at,classroom_course_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (e1) setErr(e1.message);
    else setCourses(rows ?? []);
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate("/login", { replace: true });
    });
    void load();
  }, [supabase, load, navigate]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const joinUrlForCode = (code) => {
    const root = `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`.replace(/\/+$/, "");
    return `${root}/join?code=${encodeURIComponent(code)}`;
  };

  const createInviteLink = async (role, maxUses) => {
    if (!supabase || !orgId || !staff) return;
    setInviteSaving(true);
    setInviteErr("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setInviteSaving(false);
      navigate("/login", { replace: true });
      return;
    }
    const { error } = await supabase.from("organization_invites").insert({
      org_id: orgId,
      role,
      max_uses: maxUses,
      created_by: user.id,
    });
    setInviteSaving(false);
    if (error) setInviteErr(error.message);
    else await loadInvites();
  };

  const removeInvite = async (id) => {
    if (!supabase || !staff) return;
    setInviteErr("");
    const { error } = await supabase.from("organization_invites").delete().eq("id", id).eq("org_id", orgId);
    if (error) setInviteErr(error.message);
    else await loadInvites();
  };

  const createCourse = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving || !supabase || !staff) return;
    setSaving(true);
    setErr("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    const { error } = await supabase.from("courses").insert({
      org_id: orgId,
      title: t,
      created_by: user.id,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    await load();
  };

  const loadClassroomCourses = async () => {
    if (!supabase || !staff) return;
    setGcBusy(true);
    setGcErr("");
    setGcCourses([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.provider_token ?? null;
      const list = await listTeacherClassroomCourses(tok);
      setGcCourses(list);
      const firstWithId = list.find((c) => c?.id)?.id ?? "";
      setPickedGcId(firstWithId);
    } catch (ex) {
      const code = ex?.code;
      if (code === "missing_access_token" || ex?.status === 401) {
        setGcErr(
          "Sin token de Classroom. Volvé a /login y aceptá los permisos de Google (Classroom API activa en Google Cloud).",
        );
      } else {
        setGcErr(ex?.message || "No se pudo leer Google Classroom.");
      }
    } finally {
      setGcBusy(false);
    }
  };

  const createCourseFromClassroomSelection = async () => {
    if (!supabase || !staff || !pickedGcId) return;
    setLinkGcBusy(true);
    setGcErr("");
    const gc = gcCourses.find((c) => c.id === pickedGcId);
    const gcTitle =
      gc?.name && String(gc.name).trim() ? gc.name.trim() : gc?.descriptionHeading || gc?.id || "Curso Classroom";
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLinkGcBusy(false);
      return;
    }
    const { error } = await supabase.from("courses").insert({
      org_id: orgId,
      title: gcTitle,
      classroom_course_id: pickedGcId,
      created_by: user.id,
    });
    setLinkGcBusy(false);
    if (error) setGcErr(error.message);
    else await load();
  };

  const linkClassroomToExistingCourse = async () => {
    if (!supabase || !staff || !pickedGcId || !pickedCourseLinkId) return;
    setLinkGcBusy(true);
    setGcErr("");
    const { error } = await supabase
      .from("courses")
      .update({ classroom_course_id: pickedGcId })
      .eq("id", pickedCourseLinkId)
      .eq("org_id", orgId);
    setLinkGcBusy(false);
    if (error) setGcErr(error.message);
    else await load();
  };

  const copyGcInfo = gcCourses.find((c) => c.id === pickedGcId);

  if (loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando cursos…</p>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide auth-card--max">
        <p className="auth-breadcrumb">
          <Link to="/dashboard" className="auth-link">
            Panel
          </Link>
          <span aria-hidden> / </span>
          <span>{orgName || "Colegio"}</span>
        </p>
        <h1 className="auth-card__title">
          Cursos
          <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, opacity: 0.75, marginTop: "0.25rem" }}>
            Tu rol: {roleLabelEs(myRole)}
          </span>
        </h1>
        <p className="auth-card__muted">
          {staff
            ? "Creá cursos y actividades; los alumnos entran con invitación y rol «Alumno»."
            : "Accedé a los cursos de tu colegio. Las actividades las publica tu docente."}
        </p>
        {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
        {courses.length === 0 ? (
          <p className="auth-card__muted">
            {staff ? "No hay cursos todavía. Podés crear uno abajo o importar desde Classroom." : "Todavía no hay cursos publicados."}
          </p>
        ) : (
          <ul className="auth-org-list">
            {courses.map((c) => (
              <li key={c.id} className="auth-org-row auth-org-row--link">
                <Link className="auth-org-row__link" to={`/dashboard/org/${orgId}/course/${c.id}`}>
                  <span className="auth-org-row__name">{c.title}</span>
                  <span className="auth-org-row__meta">
                    Actividades
                    {c.classroom_course_id ? " · 🔗 Classroom" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {staff ? (
          <section className="auth-invites-block">
            <h2 className="auth-section__title">Invitar al equipo</h2>
            <p className="auth-card__muted auth-card__muted--tight">
              Generá un enlace; quien entre con sesión se suma como <strong>{roleLabelEs("student")}</strong> o{" "}
              <strong>{roleLabelEs("teacher")}</strong>.
            </p>
            {inviteErr ? <p className="auth-card__notice auth-card__notice--err">{inviteErr}</p> : null}
            <div className="auth-org-row__actions" style={{ marginBottom: "0.75rem" }}>
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={inviteSaving}
                onClick={() => void createInviteLink("student", 120)}
              >
                Enlace alumnos (120 usos)
              </button>
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={inviteSaving}
                onClick={() => void createInviteLink("teacher", 10)}
              >
                Enlace docentes (10 usos)
              </button>
            </div>
            {invites.length ? (
              <ul className="auth-org-list">
                {invites.map((inv) => (
                  <li key={inv.id} className="auth-org-row auth-org-row--split">
                    <div>
                      <span className="auth-org-row__name">
                        Código · {inv.code} ({roleLabelEs(inv.role)})
                      </span>
                      <span className="auth-org-row__meta">
                        Usos {inv.use_count}/{inv.max_uses}
                        {inv.expires_at ? ` · hasta ${inv.expires_at}` : ""}
                      </span>
                    </div>
                    <div className="auth-org-row__actions">
                      <button
                        type="button"
                        className="auth-btn auth-btn--ghost auth-btn--sm"
                        onClick={() => void navigator.clipboard.writeText(joinUrlForCode(inv.code))}
                      >
                        Copiar enlace /join
                      </button>
                      <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={() => void removeInvite(inv.id)}>
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="auth-card__muted auth-card__muted--tight">Todavía no generaste enlaces.</p>
            )}
          </section>
        ) : null}

        {staff ? (
          <section className="auth-classroom-block">
            <h2 className="auth-section__title">Google Classroom</h2>
            <p className="auth-card__muted auth-card__muted--tight">
              Listamos cursos donde sos docente (<code>teacherId=me</code>). Para producción tenés que activar Classroom API en
              Google Cloud y los scopes OAuth en pantalla de consentimiento.
            </p>
            {gcErr ? <p className="auth-card__notice auth-card__notice--err">{gcErr}</p> : null}
            <button type="button" className="auth-btn auth-btn--ghost" disabled={gcBusy} onClick={() => void loadClassroomCourses()}>
              {gcBusy ? "Cargando Classroom…" : "Cargar mis cursos (Classroom)"}
            </button>
            {gcCourses.length ? (
              <div className="auth-classroom-fields">
                <label className="auth-org-label" htmlFor="gc-pick">
                  Curso en Classroom
                </label>
                <select
                  id="gc-pick"
                  className="auth-org-input auth-org-input--block"
                  value={pickedGcId}
                  onChange={(e) => setPickedGcId(e.target.value)}
                  disabled={linkGcBusy}
                >
                  {gcCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.name || c.section || c.id).slice(0, 80)}
                    </option>
                  ))}
                </select>
                {copyGcInfo?.id ? (
                  <p className="auth-card__codehint">
                    Classroom id: <code>{copyGcInfo.id}</code>
                  </p>
                ) : null}
                <button
                  type="button"
                  className="auth-btn auth-btn--primary"
                  disabled={linkGcBusy || !pickedGcId}
                  onClick={() => void createCourseFromClassroomSelection()}
                >
                  Crear curso PyBot con este Classroom
                </button>
                {courses.length ? (
                  <div className="auth-classroom-link-row">
                    <label className="auth-org-label" htmlFor="link-existing-course">
                      O vincular a curso ya creado
                    </label>
                    <select
                      id="link-existing-course"
                      className="auth-org-input auth-org-input--block"
                      value={pickedCourseLinkId}
                      onChange={(e) => setPickedCourseLinkId(e.target.value)}
                      disabled={linkGcBusy}
                    >
                      <option value="">Elegí un curso PyBot…</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost"
                      disabled={linkGcBusy || !pickedGcId || !pickedCourseLinkId}
                      onClick={() => void linkClassroomToExistingCourse()}
                    >
                      Guardar Classroom id en ese curso
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {staff ? (
          <form className="auth-org-form" onSubmit={createCourse}>
            <label className="auth-org-label" htmlFor="course-title">
              Nuevo curso (solo docentes/gestión)
            </label>
            <div className="auth-org-form__row">
              <input
                id="course-title"
                className="auth-org-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Robótica 1A"
                maxLength={160}
                disabled={saving}
              />
              <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
                Crear
              </button>
            </div>
          </form>
        ) : null}

        <Link to="/" className="auth-link">
          Ir al IDE
        </Link>
      </div>
    </main>
  );
}
