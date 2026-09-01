import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createPybotclassActivity,
  formatDueDateEs,
  updatePybotclassActivity,
} from "../../platform/pybotClassApi.js";
import { submissionStatusLabelEs } from "../../platform/activitySubmissions.js";
import { fetchMySubmission } from "../../platform/activitySubmissions.js";

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
      className="auth-activity-form"
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
      <h2 className="auth-section__title">{title}</h2>
      {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
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
      <label className="auth-org-label" htmlFor="act-lesson">
        ID lección PyBot (opcional)
      </label>
      <input
        id="act-lesson"
        className="auth-org-input auth-org-input--block"
        value={pybotLessonId}
        onChange={(e) => setPybotLessonId(e.target.value)}
        disabled={saving}
      />
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

  return (
    <li className="auth-org-row auth-org-row--split">
      <div>
        <span className="auth-org-row__name">{activity.title}</span>
        <span className="auth-org-row__meta">
          {status === "graded" || status === "returned"
            ? `Corregida · Nota: ${submission?.grade ?? "—"}`
            : status === "submitted"
              ? "Entregada · Esperando corrección"
              : "Pendiente"}
          {due ? ` · Entrega: ${due}` : ""}
        </span>
        {submission?.feedback ? (
          <span className="auth-org-row__meta">{submission.feedback}</span>
        ) : null}
      </div>
      <Link className="auth-btn auth-btn--ghost auth-btn--sm" to={`/actividad/${activity.id}`}>
        Abrir
      </Link>
    </li>
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
      <>
        {activities.length === 0 ? (
          <p className="auth-card__muted">Todavía no hay actividades.</p>
        ) : (
          <ul className="auth-org-list">
            {activities.map((a) => (
              <StudentActivityRow key={a.id} activity={a} userId={user.id} />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <div className="auth-card__actions auth-card__actions--row" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="auth-btn auth-btn--primary auth-btn--sm"
          onClick={() => {
            setShowCreate(true);
            setEditing(null);
          }}
        >
          + Nueva actividad
        </button>
        {onImportClassroom ? (
          <button
            type="button"
            className="auth-btn auth-btn--ghost auth-btn--sm"
            disabled={importBusy}
            onClick={() => void onImportClassroom()}
          >
            {importBusy ? "Importando…" : "Importar desde Classroom"}
          </button>
        ) : null}
      </div>

      {activities.length === 0 ? (
        <p className="auth-card__muted">Todavía no hay actividades en esta clase.</p>
      ) : (
        <ul className="auth-org-list">
          {activities.map((a) => (
            <li key={a.id} className="auth-org-row auth-org-row--split">
              <div>
                <span className="auth-org-row__name">{a.title}</span>
                <span className="auth-org-row__meta">
                  {a.due_at ? `Entrega: ${formatDueDateEs(a.due_at)}` : "Sin fecha de entrega"}
                  {a.classroom_coursework_id ? " · Classroom ● sincronizada" : " · Solo PyBotClass"}
                  {a.max_points != null ? ` · ${a.max_points} pts` : ""}
                </span>
              </div>
              <div className="auth-org-row__actions">
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
              </div>
            </li>
          ))}
        </ul>
      )}

      {showCreate ? (
        <ActivityForm
          title="Nueva actividad"
          saving={saving}
          err={localErr || err}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

      {editing ? (
        <ActivityForm
          title="Editar actividad"
          initial={editing}
          saving={saving}
          err={localErr || err}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
