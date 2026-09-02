import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ActionBtn,
  AdminFormRow,
  AdminTable,
  Field,
  SelectInput,
  TextArea,
  TextInput,
  fmtDate,
  useCrudMessage,
} from "../components/admin/adminUi.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  createAdminActivity,
  createAdminCourse,
  createAdminCourseMember,
  createAdminOrgMember,
  createAdminOrganization,
  deleteAdminActivity,
  deleteAdminCourse,
  deleteAdminCourseMember,
  deleteAdminOrganization,
  deleteAdminOrgMember,
  deleteAdminUsageSession,
  deleteAdminUserTelemetry,
  fetchAdminActivities,
  fetchAdminCourseMembers,
  fetchAdminCourses,
  fetchAdminOrgMembers,
  fetchAdminOrganizations,
  fetchAdminProfiles,
  fetchAdminUsageSessions,
  findProfileIdByEmail,
  updateAdminActivity,
  updateAdminCourse,
  updateAdminOrganization,
  updateAdminOrgMember,
  updateAdminProfile,
} from "../platform/adminApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { getSupabase } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import { roleLabelEs } from "../orgRole.js";

const ROLES_ORG = [
  { value: "owner", label: "Gestión" },
  { value: "teacher", label: "Docente" },
  { value: "student", label: "Alumno" },
];

const ROLES_COURSE = [
  { value: "teacher", label: "Docente" },
  { value: "student", label: "Alumno" },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [activeTab, setActiveTab] = useState("visits");
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPicture, setUserPicture] = useState("");

  const [sessions, setSessions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [courses, setCourses] = useState([]);
  const [activities, setActivities] = useState([]);
  const [members, setMembers] = useState([]);
  const [courseMembers, setCourseMembers] = useState([]);
  const [loadError, setLoadError] = useState("");

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const loadAll = useCallback(async () => {
    setLoadError("");
    const results = await Promise.all([
      fetchAdminUsageSessions(),
      fetchAdminProfiles(),
      fetchAdminOrganizations(),
      fetchAdminCourses(),
      fetchAdminActivities(),
      fetchAdminOrgMembers(),
      fetchAdminCourseMembers(),
    ]);
    const err = results.find((r) => r.error)?.error;
    if (err) setLoadError(err);
    setSessions(results[0].rows);
    setProfiles(results[1].rows);
    setOrgs(results[2].rows);
    setCourses(results[3].rows);
    setActivities(results[4].rows);
    setMembers(results[5].rows);
    setCourseMembers(results[6].rows);
  }, []);

  useEffect(() => {
    if (!supabase) {
      navigate("/dashboard", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data?.session?.user;
      if (!u) {
        navigate("/login?next=%2Fdashboard%2Fadmin", { replace: true });
        return;
      }
      const meta = u.user_metadata || {};
      setUserId(u.id);
      setUserEmail(u.email || "");
      setUserPicture(meta.avatar_url || meta.picture || "");
      const { profile, error: pErr } = await fetchProfile(u.id);
      if (cancelled) return;
      if (pErr || !isSuperAdmin(profile)) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setUserName(profile?.display_name || meta.full_name || u.email?.split("@")[0] || "Admin");
      await loadAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, navigate, loadAll]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <main className="dash-root dash-root--center">
        <p className="auth-card__lead">Cargando panel de administración…</p>
      </main>
    );
  }

  if (denied) {
    return (
      <main className="auth-root">
        <div className="auth-card auth-card--wide">
          <h1 className="auth-card__title">Acceso denegado</h1>
          <p className="auth-card__lead">No tenés permisos de super administrador.</p>
          <Link to="/dashboard/classes" className="auth-btn auth-btn--ghost">
            Volver a PyBotClass
          </Link>
        </div>
      </main>
    );
  }

  const tabs = [
    { id: "visits", label: `Visitas (${sessions.length})` },
    { id: "users", label: `Usuarios (${profiles.length})` },
    { id: "orgs", label: `Instituciones (${orgs.length})` },
    { id: "courses", label: `Cursos (${courses.length})` },
    { id: "activities", label: `Tareas (${activities.length})` },
    { id: "members", label: `Membresías (${members.length})` },
    { id: "course_members", label: `Inscripciones (${courseMembers.length})` },
  ];

  const layoutUser = {
    id: userId,
    email: userEmail,
    user_metadata: {
      full_name: userName,
      avatar_url: userPicture,
      picture: userPicture,
    },
  };

  return (
    <PyBotClassLayout user={layoutUser} showAdmin hideSearch onSignOut={signOut}>
      <div className="pbc-admin">
        <header className="pbc-hero-block" style={{ marginBottom: "1rem" }}>
          <h1 className="pbc-hero-block__title">Panel SuperAdmin</h1>
          <p className="pbc-hero-block__subtitle">
            Gestión global: usuarios, instituciones, cursos, tareas e inscripciones.
          </p>
        </header>

        <nav className="pbc-filter-tabs" aria-label="Secciones admin" style={{ marginBottom: "1rem" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pbc-filter-tab${activeTab === t.id ? " pbc-filter-tab--active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={() => void loadAll()}>
            Actualizar
          </button>
        </nav>

        {loadError ? <p className="pbc-alert pbc-alert--error">{loadError}</p> : null}

        <div className="pbc-admin__body">
          {activeTab === "visits" ? (
            <VisitsPanel sessions={sessions} profileById={profileById} onSaved={loadAll} />
          ) : null}

          {activeTab === "users" ? (
            <UsersPanel profiles={profiles} onSaved={loadAll} currentUserId={userId} />
          ) : null}
          {activeTab === "orgs" ? (
            <OrgsPanel orgs={orgs} createdBy={userId} onSaved={loadAll} />
          ) : null}
          {activeTab === "courses" ? (
            <CoursesPanel courses={courses} orgs={orgs} orgById={orgById} createdBy={userId} onSaved={loadAll} />
          ) : null}
          {activeTab === "activities" ? (
            <ActivitiesPanel
              activities={activities}
              courses={courses}
              courseById={courseById}
              createdBy={userId}
              onSaved={loadAll}
            />
          ) : null}
          {activeTab === "members" ? (
            <MembersPanel
              members={members}
              orgs={orgs}
              orgById={orgById}
              profileById={profileById}
              onSaved={loadAll}
            />
          ) : null}
          {activeTab === "course_members" ? (
            <CourseMembersPanel
              rows={courseMembers}
              courses={courses}
              courseById={courseById}
              profileById={profileById}
              onSaved={loadAll}
            />
          ) : null}
        </div>
      </div>
    </PyBotClassLayout>
  );
}

function VisitsPanel({ sessions, profileById, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();

  const remove = (id) => {
    if (!confirm("¿Eliminar esta visita y sus eventos de telemetría?")) return;
    void wrap(async () => {
      const r = await deleteAdminUsageSession(id);
      if (r.ok) await onSaved();
      return r;
    });
  };

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminTable
        rowKey={(r) => r.id}
        rows={sessions}
        columns={[
          { key: "started_at", label: "Entrada", render: (r) => fmtDate(r.started_at) },
          {
            key: "user",
            label: "Usuario",
            render: (r) =>
              profileById.get(r.user_id)?.email || (r.is_authenticated ? r.user_id?.slice(0, 8) : "Anónimo"),
          },
          { key: "ip", label: "IP", render: (r) => r.ip || r.ip_prefix || "—" },
          { key: "country", label: "País" },
          { key: "city", label: "Ciudad" },
          { key: "landing_path", label: "Página" },
          { key: "browser", label: "Navegador" },
          {
            key: "a",
            label: "",
            render: (r) => (
              <ActionBtn danger onClick={() => remove(r.id)}>
                Eliminar
              </ActionBtn>
            ),
          },
        ]}
      />
    </section>
  );
}

function UsersPanel({ profiles, onSaved, currentUserId }) {
  const { msg, err, wrap } = useCrudMessage();
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [pref, setPref] = useState("teacher");
  const [superFlag, setSuperFlag] = useState(false);

  const startEdit = (p) => {
    setEditId(p.id);
    setName(p.display_name || "");
    setPref(p.preferred_role || "teacher");
    setSuperFlag(!!p.is_super_admin);
  };

  const save = () =>
    wrap(async () => {
      const r = await updateAdminProfile(editId, {
        display_name: name,
        preferred_role: pref,
        is_super_admin: superFlag,
      });
      if (!r.error) {
        setEditId(null);
        await onSaved();
      }
      return r;
    });

  const wipeTelemetry = (userId) => {
    if (!confirm("¿Eliminar toda la telemetría de este usuario? No borra la cuenta ni datos académicos.")) {
      return;
    }
    void wrap(async () => {
      const r = await deleteAdminUserTelemetry(userId);
      if (r.ok) await onSaved();
      return r;
    });
  };

  return (
    <section>
      <p className="dash-muted admin-hint">
        No se pueden crear usuarios acá: deben entrar con Google primero. Podés editar nombre, preferencia y
        super admin.
      </p>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      {editId ? (
        <AdminFormRow onSubmit={save} onCancel={() => setEditId(null)}>
          <Field label="Nombre">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Preferencia onboarding">
            <SelectInput
              value={pref}
              onChange={(e) => setPref(e.target.value)}
              options={[
                { value: "teacher", label: "Docente" },
                { value: "student", label: "Alumno" },
              ]}
            />
          </Field>
          <Field label="Super admin">
            <SelectInput
              value={superFlag ? "1" : "0"}
              onChange={(e) => setSuperFlag(e.target.value === "1")}
              options={[
                { value: "0", label: "No" },
                { value: "1", label: "Sí" },
              ]}
            />
          </Field>
        </AdminFormRow>
      ) : null}
      <AdminTable
        rowKey={(r) => r.id}
        rows={profiles}
        columns={[
          { key: "email", label: "Email" },
          { key: "display_name", label: "Nombre" },
          { key: "preferred_role", label: "Preferencia" },
          { key: "is_super_admin", label: "Super admin", render: (r) => (r.is_super_admin ? "Sí" : "—") },
          {
            key: "actions",
            label: "",
            render: (r) => (
              <>
                <ActionBtn onClick={() => startEdit(r)} disabled={r.id === currentUserId && r.is_super_admin}>
                  Editar
                </ActionBtn>{" "}
                <ActionBtn danger onClick={() => wipeTelemetry(r.id)}>
                  Eliminar telemetría
                </ActionBtn>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function OrgsPanel({ orgs, createdBy, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const create = () =>
    wrap(async () => {
      const r = await createAdminOrganization({ name, slug, createdBy });
      if (!r.error) {
        setName("");
        setSlug("");
        await onSaved();
      }
      return r;
    });

  const save = () =>
    wrap(async () => {
      const r = await updateAdminOrganization(editId, { name: editName, slug: editSlug });
      if (r.ok) {
        setEditId(null);
        await onSaved();
      }
      return r;
    });

  const remove = (id) => {
    if (!confirm("¿Eliminar colegio y todo lo asociado?")) return;
    void wrap(async () => {
      const r = await deleteAdminOrganization(id);
      if (r.ok) await onSaved();
      return r;
    });
  };

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminFormRow onSubmit={create} submitLabel="Crear colegio">
        <Field label="Nombre">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Slug (opcional)">
          <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto" />
        </Field>
      </AdminFormRow>
      {editId ? (
        <AdminFormRow onSubmit={save} onCancel={() => setEditId(null)}>
          <Field label="Nombre">
            <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label="Slug">
            <TextInput value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
          </Field>
        </AdminFormRow>
      ) : null}
      <AdminTable
        rowKey={(r) => r.id}
        rows={orgs}
        columns={[
          { key: "name", label: "Nombre" },
          { key: "slug", label: "Slug" },
          { key: "created_at", label: "Creado", render: (r) => fmtDate(r.created_at) },
          {
            key: "a",
            label: "",
            render: (r) => (
              <>
                <ActionBtn
                  onClick={() => {
                    setEditId(r.id);
                    setEditName(r.name);
                    setEditSlug(r.slug);
                  }}
                >
                  Editar
                </ActionBtn>{" "}
                <ActionBtn danger onClick={() => remove(r.id)}>
                  Borrar
                </ActionBtn>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function CoursesPanel({ courses, orgs, orgById, createdBy, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();
  const [orgId, setOrgId] = useState(orgs[0]?.id || "");
  const [title, setTitle] = useState("");
  const [editId, setEditId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editOrgId, setEditOrgId] = useState("");

  const create = () =>
    wrap(async () => {
      const r = await createAdminCourse({ orgId, title, createdBy });
      if (!r.error) {
        setTitle("");
        await onSaved();
      }
      return r;
    });

  const save = () =>
    wrap(async () => {
      const r = await updateAdminCourse(editId, { title: editTitle, org_id: editOrgId });
      if (r.ok) {
        setEditId(null);
        await onSaved();
      }
      return r;
    });

  const remove = (id) => {
    if (!confirm("¿Eliminar curso y sus tareas?")) return;
    void wrap(async () => {
      const r = await deleteAdminCourse(id);
      if (r.ok) await onSaved();
      return r;
    });
  };

  const orgOptions = orgs.map((o) => ({ value: o.id, label: o.name }));

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminFormRow onSubmit={create} submitLabel="Crear curso">
        <Field label="Colegio">
          <SelectInput value={orgId} onChange={(e) => setOrgId(e.target.value)} options={orgOptions} />
        </Field>
        <Field label="Título">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
      </AdminFormRow>
      {editId ? (
        <AdminFormRow onSubmit={save} onCancel={() => setEditId(null)}>
          <Field label="Colegio">
            <SelectInput value={editOrgId} onChange={(e) => setEditOrgId(e.target.value)} options={orgOptions} />
          </Field>
          <Field label="Título">
            <TextInput value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Field>
        </AdminFormRow>
      ) : null}
      <AdminTable
        rowKey={(r) => r.id}
        rows={courses}
        columns={[
          { key: "title", label: "Curso" },
          { key: "org", label: "Colegio", render: (r) => orgById.get(r.org_id)?.name || r.org_id },
          { key: "created_at", label: "Creado", render: (r) => fmtDate(r.created_at) },
          {
            key: "a",
            label: "",
            render: (r) => (
              <>
                <ActionBtn
                  onClick={() => {
                    setEditId(r.id);
                    setEditTitle(r.title);
                    setEditOrgId(r.org_id);
                  }}
                >
                  Editar
                </ActionBtn>{" "}
                <ActionBtn danger onClick={() => remove(r.id)}>
                  Borrar
                </ActionBtn>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function ActivitiesPanel({ activities, courses, courseById, createdBy, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pybotLessonId, setPybotLessonId] = useState("");
  const [starter, setStarter] = useState("");
  const [editId, setEditId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCourseId, setEditCourseId] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPybotLessonId, setEditPybotLessonId] = useState("");
  const [editStarter, setEditStarter] = useState("");

  const courseOptions = courses.map((c) => ({
    value: c.id,
    label: c.title || c.id.slice(0, 8),
  }));

  const activityFields = (
    <>
      <Field label="Descripción (instrucciones para el alumno)">
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Lo que ve el alumno al abrir la actividad"
        />
      </Field>
      <Field label="ID lección PyBot (opcional)">
        <TextInput
          value={pybotLessonId}
          onChange={(e) => setPybotLessonId(e.target.value)}
          placeholder="Ej. U1 - T1"
        />
      </Field>
      <Field label="Código inicial (lo que ve el alumno al abrir PyBot)">
        <TextArea value={starter} onChange={(e) => setStarter(e.target.value)} />
      </Field>
    </>
  );

  const editActivityFields = (
    <>
      <Field label="Descripción (instrucciones para el alumno)">
        <TextArea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
      </Field>
      <Field label="ID lección PyBot (opcional)">
        <TextInput value={editPybotLessonId} onChange={(e) => setEditPybotLessonId(e.target.value)} />
      </Field>
      <Field label="Código inicial (lo que ve el alumno al abrir PyBot)">
        <TextArea value={editStarter} onChange={(e) => setEditStarter(e.target.value)} />
      </Field>
    </>
  );

  const create = () =>
    wrap(async () => {
      const r = await createAdminActivity({
        courseId,
        title,
        description,
        pybotLessonId,
        starterCode: starter,
        createdBy,
      });
      if (!r.error) {
        setTitle("");
        setDescription("");
        setPybotLessonId("");
        setStarter("");
        await onSaved();
      }
      return r;
    });

  const save = () =>
    wrap(async () => {
      const r = await updateAdminActivity(editId, {
        title: editTitle,
        course_id: editCourseId,
        description: editDescription,
        pybot_lesson_id: editPybotLessonId,
        starter_code: editStarter,
      });
      if (r.ok) {
        setEditId(null);
        await onSaved();
      }
      return r;
    });

  const remove = (id) => {
    if (!confirm("¿Eliminar tarea?")) return;
    void wrap(async () => {
      const r = await deleteAdminActivity(id);
      if (r.ok) await onSaved();
      return r;
    });
  };

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminFormRow onSubmit={create} submitLabel="Crear tarea">
        <Field label="Curso">
          <SelectInput value={courseId} onChange={(e) => setCourseId(e.target.value)} options={courseOptions} />
        </Field>
        <Field label="Título">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        {activityFields}
      </AdminFormRow>
      {editId ? (
        <AdminFormRow onSubmit={save} onCancel={() => setEditId(null)}>
          <Field label="Curso">
            <SelectInput
              value={editCourseId}
              onChange={(e) => setEditCourseId(e.target.value)}
              options={courseOptions}
            />
          </Field>
          <Field label="Título">
            <TextInput value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Field>
          {editActivityFields}
        </AdminFormRow>
      ) : null}
      <AdminTable
        rowKey={(r) => r.id}
        rows={activities}
        columns={[
          { key: "title", label: "Tarea" },
          { key: "course", label: "Curso", render: (r) => courseById.get(r.course_id)?.title || r.course_id },
          { key: "created_at", label: "Creado", render: (r) => fmtDate(r.created_at) },
          {
            key: "a",
            label: "",
            render: (r) => (
              <>
                <ActionBtn
                  onClick={() => {
                    setEditId(r.id);
                    setEditTitle(r.title);
                    setEditCourseId(r.course_id);
                    setEditDescription(r.description || "");
                    setEditPybotLessonId(r.pybot_lesson_id || "");
                    setEditStarter(r.starter_code || "");
                  }}
                >
                  Editar
                </ActionBtn>{" "}
                <ActionBtn danger onClick={() => remove(r.id)}>
                  Borrar
                </ActionBtn>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function MembersPanel({ members, orgs, orgById, profileById, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();
  const [orgId, setOrgId] = useState(orgs[0]?.id || "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("student");

  const orgOptions = orgs.map((o) => ({ value: o.id, label: o.name }));

  const create = () =>
    wrap(async () => {
      const found = await findProfileIdByEmail(email);
      if (found.error) return found;
      const r = await createAdminOrgMember({ orgId, userId: found.userId, role });
      if (r.ok) {
        setEmail("");
        await onSaved();
      }
      return r;
    });

  const changeRole = (m, newRole) =>
    wrap(async () => {
      const r = await updateAdminOrgMember({ orgId: m.org_id, userId: m.user_id, role: newRole });
      if (r.ok) await onSaved();
      return r;
    });

  const remove = (m) => {
    if (!confirm("¿Quitar membresía?")) return;
    void wrap(async () => {
      const r = await deleteAdminOrgMember({ orgId: m.org_id, userId: m.user_id });
      if (r.ok) await onSaved();
      return r;
    });
  };

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminFormRow onSubmit={create} submitLabel="Agregar a colegio">
        <Field label="Colegio">
          <SelectInput value={orgId} onChange={(e) => setOrgId(e.target.value)} options={orgOptions} />
        </Field>
        <Field label="Email del usuario">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Rol">
          <SelectInput value={role} onChange={(e) => setRole(e.target.value)} options={ROLES_ORG} />
        </Field>
      </AdminFormRow>
      <AdminTable
        rowKey={(r) => `${r.org_id}-${r.user_id}`}
        rows={members}
        columns={[
          { key: "org", label: "Colegio", render: (r) => orgById.get(r.org_id)?.name },
          { key: "email", label: "Usuario", render: (r) => profileById.get(r.user_id)?.email },
          { key: "role", label: "Rol", render: (r) => roleLabelEs(r.role) },
          {
            key: "a",
            label: "",
            render: (r) => (
              <>
                <SelectInput
                  value={r.role}
                  onChange={(e) => void changeRole(r, e.target.value)}
                  options={ROLES_ORG}
                />{" "}
                <ActionBtn danger onClick={() => remove(r)}>
                  Quitar
                </ActionBtn>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function CourseMembersPanel({ rows, courses, courseById, profileById, onSaved }) {
  const { msg, err, wrap } = useCrudMessage();
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("student");

  const courseOptions = courses.map((c) => ({ value: c.id, label: courseById.get(c.id)?.title || c.title }));

  const create = () =>
    wrap(async () => {
      const found = await findProfileIdByEmail(email);
      if (found.error) return found;
      const r = await createAdminCourseMember({ courseId, userId: found.userId, role });
      if (r.ok) {
        setEmail("");
        await onSaved();
      }
      return r;
    });

  const remove = (r) => {
    if (!confirm("¿Quitar del curso?")) return;
    void wrap(async () => {
      const res = await deleteAdminCourseMember({ courseId: r.course_id, userId: r.user_id });
      if (res.ok) await onSaved();
      return res;
    });
  };

  return (
    <section>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="dash-error">{err}</p> : null}
      <AdminFormRow onSubmit={create} submitLabel="Inscribir en curso">
        <Field label="Curso">
          <SelectInput value={courseId} onChange={(e) => setCourseId(e.target.value)} options={courseOptions} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Rol">
          <SelectInput value={role} onChange={(e) => setRole(e.target.value)} options={ROLES_COURSE} />
        </Field>
      </AdminFormRow>
      <AdminTable
        rowKey={(r) => `${r.course_id}-${r.user_id}`}
        rows={rows}
        columns={[
          { key: "course", label: "Curso", render: (r) => courseById.get(r.course_id)?.title },
          { key: "email", label: "Usuario", render: (r) => profileById.get(r.user_id)?.email },
          { key: "role", label: "Rol", render: (r) => roleLabelEs(r.role) },
          {
            key: "a",
            label: "",
            render: (r) => (
              <ActionBtn danger onClick={() => remove(r)}>
                Quitar
              </ActionBtn>
            ),
          },
        ]}
      />
    </section>
  );
}
