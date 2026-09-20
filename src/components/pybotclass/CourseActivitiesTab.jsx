import { t } from "../../i18n.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createPybotclassActivity,
  updatePybotclassActivity,
} from "../../platform/pybotClassApi.js";
import { fetchMySubmission, submissionVersionLabel } from "../../platform/activitySubmissions.js";
import { deriveProcessStatus } from "../../platform/submissionWorkflow.js";
import { formatDueDate, processStatusLabel } from "./pyclassI18n.js";
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
  const [submissionCloseAt, setSubmissionCloseAt] = useState(
    initial?.submission_close_at ? String(initial.submission_close_at).slice(0, 16) : "",
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
          submissionCloseAt: submissionCloseAt
            ? new Date(submissionCloseAt).toISOString()
            : null,
          maxPoints,
        });
      }}
    >
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      <label className="auth-org-label" htmlFor="act-title">
        {t("pcTitle")}
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
        {t("pcDescription")}
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
            {t("pcDueDate")}
          </label>
          <input
            id="act-due"
            type="datetime-local"
            className="auth-org-input auth-org-input--block"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            disabled={saving}
          />
          <p className="auth-card__muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
            {t("pcDueDateHint")}
          </p>
        </div>
        <div>
          <label className="auth-org-label" htmlFor="act-close">
            {t("pcSubmissionClose")}
          </label>
          <input
            id="act-close"
            type="datetime-local"
            className="auth-org-input auth-org-input--block"
            value={submissionCloseAt}
            onChange={(e) => setSubmissionCloseAt(e.target.value)}
            disabled={saving}
          />
          <p className="auth-card__muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
            {t("pcSubmissionCloseHint")}
          </p>
        </div>
      </div>
      <div>
        <label className="auth-org-label" htmlFor="act-points">
          {t("pcMaxPoints")}
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
          placeholder="100"
        />
        <p className="auth-card__muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
          {t("pcMaxPointsHint")}
        </p>
      </div>
      <label className="auth-org-label" htmlFor="act-starter">
        {t("pcStarterCode")}
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
          {saving ? t("pcSaving") : t("pcSave")}
        </button>
        {onCancel ? (
          <button type="button" className="auth-btn auth-btn--ghost" onClick={onCancel} disabled={saving}>
            {t("pcCancel")}
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

  const process = deriveProcessStatus({
    status: submission?.status,
    version: submission?.version,
    hasSubmission: Boolean(submission),
  });
  const due = formatDueDate(activity.due_at);
  const close = formatDueDate(activity.submission_close_at);
  const ver = submissionVersionLabel(submission?.version);
  const statusLabel = [
    processStatusLabel(process),
    ver,
    process === "evaluado" || process === "cerrado"
      ? `${t("pcGradePrefix")} ${submission?.grade ?? "—"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PbcListItem
      title={activity.title}
      meta={[
        statusLabel,
        due ? `${t("pcDuePrefix")} ${due}` : null,
        close ? `${t("pcClosePrefix")} ${close}` : null,
        submission?.feedback,
      ]
        .filter(Boolean)
        .join(" · ")}
      badges={
        <>
          {activity.content_lesson_id ? (
            <span className="pbc-pill pbc-pill--content">{t("pcMyContent")}</span>
          ) : null}
          {process === "evaluado" || process === "cerrado" ? (
            <span className="pbc-pill pbc-pill--ok">{processStatusLabelEs(process)}</span>
          ) : process === "entregado" ||
            process === "reentregado" ||
            process === "revision_solicitada" ? (
            <span className="pbc-pill pbc-pill--warn">{processStatusLabelEs(process)}</span>
          ) : (
            <span className="pbc-pill pbc-pill--muted">{processStatusLabelEs(process)}</span>
          )}
        </>
      }
      actions={
        <Link className="auth-btn auth-btn--primary auth-btn--sm" to={`/actividad/${activity.id}`}>
          {t("pcOpen")}
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
    const { row, error } = await createPybotclassActivity(supabase, {
      courseId,
      createdBy: user.id,
      ...fields,
    });
    if (row) {
      setShowCreate(false);
      await onReload();
    }
    if (error) {
      setLocalErr(error);
      return;
    }
  };

  const handleUpdate = async (fields) => {
    if (!editing) return;
    setLocalErr("");
    const result = await updatePybotclassActivity(supabase, editing.id, fields);
    if (!result.ok) {
      setLocalErr(result.error || t("pcSaveActivityFail"));
      if (result.partial) await onReload();
      return;
    }
    setEditing(null);
    await onReload();
  };

  if (isStudent) {
    return (
      <PbcSection title={t("pcActivities")}>
        {activities.length === 0 ? (
          <PbcEmpty title={t("pcNoActivities")} description={t("pcNoActivitiesStudentDesc")} />
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
        title={t("pcActivities")}
        description={`${activities.length} ${t("pcActivities")}`}
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
              + {t("pcNew")}
            </button>
            {onImportClassroom ? (
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={importBusy}
                onClick={() => void onImportClassroom()}
              >
                {importBusy ? t("pcImporting") : t("pcImportClassroom")}
              </button>
            ) : null}
          </>
        }
      >
        {activities.length === 0 ? (
          <PbcEmpty
            title={t("pcCreateFirstActivity")}
            description={t("pcCreateFirstActivityDesc")}
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
                          ? t("pcExercise")
                          : a.activity_kind === "task"
                            ? t("pcTask")
                            : t("pcFromMyContent")}
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
                      {t("pcEdit")}
                    </button>
                    <Link className="auth-btn auth-btn--primary auth-btn--sm" to={`/actividad/${a.id}`}>
                      {t("pcReview")}
                    </Link>
                  </>
                }
              />
            ))}
          </PbcList>
        )}
      </PbcSection>

      {showCreate ? (
        <PbcFormPanel title={t("pcNewActivity")} onCancel={() => setShowCreate(false)}>
          <ActivityForm
            saving={saving}
            err={localErr || err}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </PbcFormPanel>
      ) : null}

      {editing ? (
        <PbcFormPanel title={t("pcEditActivity")} onCancel={() => setEditing(null)}>
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
