import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createPybotclassActivity,
  formatDueDateEs,
  updatePybotclassActivity,
} from "../../platform/pybotClassApi.js";
import { fetchMySubmission } from "../../platform/activitySubmissions.js";
import {
  PbcEmpty,
  PbcFormPanel,
  PbcList,
  PbcListItem,
  PbcSection,
} from "./PyBotClassUi.jsx";

function ActivityForm({ initial, saving, err, onSubmit, onCancel, title }) {
  const [formTitle, setFormTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [pybotLessonId, setPybotLessonId] = useState(initial?.pybot_lesson_id || "");
  const [starterCode, setStarterCode] = useState(initial?.starter_code || "");
  const [dueAt, setDueAt] = useState(
    initial?.due_at ? String(initial.due_at).slice(0, 16) : "",
  );
  const [maxPoints, setMaxPoints] = useState(
    initial?.max_points != null ? String(initial.max_points) : "",
  );

  return (
    <form
      className="dash-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          title: formTitle,
          description,
          pybotLessonId,
          starterCode,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          maxPoints,
        });
      }}
    >
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      <label className="auth-org-label" htmlFor="act-title">
        Título
      </label>
      <input
        id="act-title"
        className="auth-org-input auth-org-input--block"
        value={formTitle}
        onChange={(e) => setFormTitle(e.target.value)}
        required
        disabled={saving}
      />
      <label className="auth-org-label" htmlFor="act-desc">
        Descripción
      </label>
      <textarea
        id="act-desc"
        className="auth-code-area"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={saving}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label className="auth-org-label" htmlFor="act-due">
            Fecha de entrega
          </label>
          <input
            id="act-due"
            type="datetime-local"
            className="auth-org-input auth-org-input--block"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label className="auth-org-label" htmlFor="act-points">
            Puntaje máximo
          </label>
          <input
            id="act-points"
            type="number"
            min="0"
            step="0.5"
            className="auth-org-input auth-org-input--block"
            value={maxPoints}
            onChange={(e) => setMaxPoints(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>
      <label className="auth-org-label" htmlFor="act-starter">
        Código inicial
      </label>
      <textarea
        id="act-starter"
        className="auth-code-area"
        rows={4}
        value={starterCode}
        onChange={(e) => setStarterCode(e.target.value)}
        disabled={saving}
      />
      <div className="auth-card__actions auth-card__actions--row">
        <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {onCancel ? (
          <button type="button" className="auth-btn auth-btn--ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}

function StudentActivityRow({ activity, userId }) {
  const [submission, setSubmission] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { submission: s } = await fetchMySubmission(activity.id, userId);
      if (!cancelled) {
        setSubmission(s);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activity.id, userId]);

  if (!loaded) return null;

  const status = submission?.status;
  const due = formatDueDateEs(activity.due_at);
  const statusLabel =
    status === "graded" || status === "returned"
      ? `Corregida · Nota ${submission?.grade ?? "—"}`
      : status === "submitted"
        ? "Entregada · Esperando corrección"
        : "Pendiente";

  return (
    <PbcListItem
      title={activity.title}
      meta={[statusLabel, due ? `Entrega ${due}` : null, submission?.feedback].filter(Boolean).join(" · ")}
      badges={
        <>
          {activity.content_lesson_id ? (
            <span className="pbc-pill pbc-pill--content">Mi Contenido</span>
          ) : null}
          {status === "graded" || status === "returned" ? (
            <span className="pbc-pill pbc-pill--ok">Corregida</span>
          ) : status === "submitted" ? (
            <span className="pbc-pill pbc-pill--warn">Entregada</span>
          ) : (
            <span className="pbc-pill pbc-pill--muted">Pendiente</span>
          )}
        </>
      }
      actions={
        <Link className="auth-btn auth-btn--primary auth-btn--sm" to={`/actividad/${activity.id}`}>
          Abrir
        </Link>
      }
    />
  );
}

export default function CourseActivitiesTab({
  activities,
  canTeach,
  isStudent,
  user,
  supabase,
  courseId,
  saving,
  err,
  onReload,
  onImportClassroom,
  importBusy,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [localErr, setLocalErr] = useState("");

  const handleCreate = async (fields) => {
    setLocalErr("");
    const { error } = await createPybotclassActivity(supabase, {
      courseId,
      createdBy: user.id,
      ...fields,
    });
    if (error) {
      setLocalErr(error);
      return;
    }
    setShowCreate(false);
    await onReload();
  };

  const handleUpdate = async (fields) => {
    if (!editing) return;
    setLocalErr("");
    const { error } = await updatePybotclassActivity(supabase, editing.id, fields);
    if (error) {
      setLocalErr(error);
      return;
    }
    setEditing(null);
    await onReload();
  };

  if (isStudent) {
    return (
      <PbcSection title="Actividades">
        {activities.length === 0 ? (
          <PbcEmpty title="Sin actividades" description="Tu docente todavía no publicó actividades en esta clase." />
        ) : (
          <PbcList>
            {activities.map((a) => (
              <StudentActivityRow key={a.id} activity={a} userId={user.id} />
            ))}
          </PbcList>
        )}
      </PbcSection>
    );
  }

  return (
    <>
      <PbcSection
        title="Actividades"
        description={`${activities.length} actividad${activities.length === 1 ? "" : "es"} en esta clase`}
        actions={
          <>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              onClick={() => {
                setShowCreate(true);
                setEditing(null);
              }}
            >
              + Nueva
            </button>
            {onImportClassroom ? (
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={importBusy}
                onClick={() => void onImportClassroom()}
              >
                {importBusy ? "Importando…" : "Importar Classroom"}
              </button>
            ) : null}
          </>
        }
      >
        {activities.length === 0 ? (
          <PbcEmpty
            title="Creá la primera actividad"
            description="Publicá una tarea para que los alumnos trabajen en PyBot y entreguen desde acá."
          />
        ) : (
          <PbcList>
            {activities.map((a) => (
              <PbcListItem
                key={a.id}
                title={a.title}
                meta={[
                  a.due_at ? `Entrega ${formatDueDateEs(a.due_at)}` : "Sin fecha",
                  a.max_points != null ? `${a.max_points} pts` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                badges={
                  <>
                    {a.content_lesson_id || a.content_snapshot || a.content_source_type ? (
                      <span className="pbc-pill pbc-pill--content">
                        {a.activity_kind === "exercise"
                          ? "Ejercicio"
                          : a.activity_kind === "task"
                            ? "Tarea"
                            : "Desde Mi Contenido"}
                      </span>
                    ) : null}
                    {a.classroom_coursework_id ? (
                      <span className="pbc-pill pbc-pill--classroom">Classroom</span>
                    ) : a.content_lesson_id || a.content_snapshot ? null : (
                      <span className="pbc-pill pbc-pill--muted">PyBotClass</span>
                    )}
                  </>
                }
                actions={
                  <>
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      onClick={() => {
                        setEditing(a);
                        setShowCreate(false);
                      }}
                    >
                      Editar
                    </button>
                    <Link className="auth-btn auth-btn--ghost auth-btn--sm" to={`/actividad/${a.id}`}>
                      Abrir
                    </Link>
                  </>
                }
              />
            ))}
          </PbcList>
        )}
      </PbcSection>

      {showCreate ? (
        <PbcFormPanel title="Nueva actividad" onCancel={() => setShowCreate(false)}>
          <ActivityForm
            saving={saving}
            err={localErr || err}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </PbcFormPanel>
      ) : null}

      {editing ? (
        <PbcFormPanel title="Editar actividad" onCancel={() => setEditing(null)}>
          <ActivityForm
            initial={editing}
            saving={saving}
            err={localErr || err}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
          />
        </PbcFormPanel>
      ) : null}
    </>
  );
}
