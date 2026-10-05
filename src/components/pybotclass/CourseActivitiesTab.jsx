import { t } from "../../i18n.js";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createPybotclassActivity,
  updatePybotclassActivity,
} from "../../platform/pybotClassApi.js";
import {
  applyRubricTemplateToActivity,
  clearActivityRubric,
  fetchActivityRubric,
  fetchMySubmission,
  getRubricTemplate,
  submissionVersionLabel,
  upsertActivityRubric,
} from "../../platform/activitySubmissions.js";
import { deriveProcessStatus } from "../../platform/submissionWorkflow.js";
import { COURSE_ACCESS_MODES } from "../../platform/courseRole.js";
import {
  criteriaPayloadFromEditor,
  emptyEvaluationSelection,
  evaluationBaselineKey,
  evaluationChanged,
  selectionFromActivityRubric,
} from "../../platform/activityEvaluation.js";
import { getSupabase } from "../../supabaseClient.js";
import { formatDueDate, processStatusLabel } from "./pyclassI18n.js";
import CourseContentProgressPanel from "./CourseContentProgressPanel.jsx";
import ActivityEvaluationSection from "./ActivityEvaluationSection.jsx";
import {
  PbcEmpty,
  PbcFormPanel,
  PbcList,
  PbcListItem,
  PbcSection,
} from "./PyBotClassUi.jsx";
import PbcOverflowMenu from "./PbcOverflowMenu.jsx";
import { UxIcon } from "./illustrations/UxIcons.jsx";

function activitiesSectionTitle() {
  return (
    <span className="pbc-section__title-with-icon">
      <span aria-hidden>
        <UxIcon name="checklist" size={40} />
      </span>
      <span>{t("pcActivities")}</span>
    </span>
  );
}

async function activityRubricHasPublishedEvaluations(rubricId) {
  const sb = getSupabase();
  if (!sb || !rubricId) return false;
  const { data: criteria, error } = await sb
    .from("activity_rubric_criteria")
    .select("id")
    .eq("rubric_id", rubricId);
  if (error || !criteria?.length) return false;
  const ids = criteria.map((c) => c.id);
  const { data: scores } = await sb
    .from("activity_submission_rubric_scores")
    .select("id")
    .in("criterion_id", ids)
    .limit(1);
  return Boolean(scores?.length);
}

async function loadEvaluationForActivity(activityId) {
  if (!activityId) {
    return {
      selection: emptyEvaluationSelection(),
      baselineKey: "none",
      hasEvaluations: false,
    };
  }
  const { rubric, criteria } = await fetchActivityRubric(activityId);
  if (!rubric) {
    return {
      selection: emptyEvaluationSelection(),
      baselineKey: "none",
      hasEvaluations: false,
    };
  }
  let templateName = null;
  if (rubric.source_template_id) {
    const { template } = await getRubricTemplate(rubric.source_template_id);
    templateName = template?.name || null;
  }
  const selection = selectionFromActivityRubric({ rubric, criteria, templateName });
  const hasEvaluations = await activityRubricHasPublishedEvaluations(rubric.id);
  return {
    selection,
    baselineKey: evaluationBaselineKey(selection),
    hasEvaluations,
  };
}

async function persistEvaluationSelection(activityId, selection, baselineKey) {
  if (!activityId) return { ok: false, error: "missing_args" };
  if (!evaluationChanged(baselineKey, selection)) {
    return { ok: true, skipped: true, error: null };
  }
  if (!selection || selection.mode === "none") {
    return clearActivityRubric(activityId);
  }
  if (selection.mode === "template" && selection.templateId) {
    return applyRubricTemplateToActivity(activityId, selection.templateId);
  }
  if (selection.mode === "oneoff") {
    const criteria = criteriaPayloadFromEditor(selection.criteria, selection.scoringMode);
    return upsertActivityRubric(activityId, criteria, selection.scoringMode);
  }
  return { ok: true, skipped: true, error: null };
}

function ActivityForm({
  initial,
  saving,
  err,
  onSubmit,
  onCancel,
  title,
  evaluation,
  onEvaluationChange,
  onMaxPointsEffect,
  hasEvaluations = false,
  maxLocked = false,
  maxHint = null,
}) {
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

  useEffect(() => {
    if (!initial) return;
    setFormTitle(initial.title || "");
    setDescription(initial.description || "");
    setPybotLessonId(initial.pybot_lesson_id || "");
    setStarterCode(initial.starter_code || "");
    setDueAt(initial.due_at ? String(initial.due_at).slice(0, 16) : "");
    setSubmissionCloseAt(
      initial.submission_close_at ? String(initial.submission_close_at).slice(0, 16) : "",
    );
    setMaxPoints(initial.max_points != null ? String(initial.max_points) : "");
  }, [initial]);

  const handleMaxEffect = useCallback(
    (effect) => {
      onMaxPointsEffect?.(effect);
      if (effect?.kind === "points" && effect.lockMax && effect.ceiling != null) {
        setMaxPoints(String(effect.ceiling));
      }
      // qualitative: never invent 0 / never auto-erase existing max_points
      // none: keep current value (unlock handled by parent flag)
    },
    [onMaxPointsEffect],
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
          evaluation,
        });
      }}
    >
      {title ? <h3 className="pbc-form-panel__visually-hidden">{title}</h3> : null}
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
      <div className="pbc-form-grid">
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
          <p className="pbc-field-hint">{t("pcDueDateHint")}</p>
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
          <p className="pbc-field-hint">{t("pcSubmissionCloseHint")}</p>
        </div>
      </div>

      <ActivityEvaluationSection
        value={evaluation}
        onChange={onEvaluationChange}
        onMaxPointsEffect={handleMaxEffect}
        disabled={saving}
        hasEvaluations={hasEvaluations}
        showMaxPointsField
        maxPoints={maxPoints}
        onMaxPointsChange={setMaxPoints}
        maxLocked={maxLocked}
        maxHint={maxHint}
      />

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
      <div className="pbc-form-actions">
        <button type="submit" className="pbc-btn pbc-btn--primary" disabled={saving}>
          {saving ? t("pcSaving") : t("pcSave")}
        </button>
        {onCancel ? (
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onCancel} disabled={saving}>
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
            <span className="pbc-pill pbc-pill--ok">{processStatusLabel(process)}</span>
          ) : process === "entregado" ||
            process === "reentregado" ||
            process === "revision_solicitada" ? (
            <span className="pbc-pill pbc-pill--warn">{processStatusLabel(process)}</span>
          ) : (
            <span className="pbc-pill pbc-pill--muted">{processStatusLabel(process)}</span>
          )}
        </>
      }
      actions={
        <Link className="pbc-btn pbc-btn--primary pbc-btn--sm" to={`/actividad/${activity.id}`}>
          {t("pcOpen")}
        </Link>
      }
    />
  );
}

function activityListMeta(activity) {
  return [
    activity.due_at ? `${t("pcDuePrefix")} ${formatDueDate(activity.due_at)}` : t("pcNoDate"),
    activity.max_points != null ? `${activity.max_points} pts` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function activityListBadges(activity) {
  return (
    <>
      {activity.content_lesson_id || activity.content_snapshot || activity.content_source_type ? (
        <span className="pbc-pill pbc-pill--content">
          {activity.activity_kind === "exercise"
            ? t("pcExercise")
            : activity.activity_kind === "task"
              ? t("pcTask")
              : t("pcFromMyContent")}
        </span>
      ) : null}
      {activity.classroom_coursework_id ? (
        <span className="pbc-pill pbc-pill--classroom">Classroom</span>
      ) : activity.content_lesson_id || activity.content_snapshot ? null : (
        <span className="pbc-pill pbc-pill--muted">PyBotClass</span>
      )}
    </>
  );
}

export default function CourseActivitiesTab({
  activities,
  mode,
  user,
  supabase,
  courseId,
  saving,
  err,
  onReload,
  onImportClassroom,
  importBusy,
  openCreate = false,
  onCreateOpened,
  onAssignContent,
  editActivityId = null,
  onEditOpened,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [localErr, setLocalErr] = useState("");
  const [feedback, setFeedback] = useState("");
  const [evaluation, setEvaluation] = useState(() => emptyEvaluationSelection());
  const [baselineKey, setBaselineKey] = useState("none");
  const [hasEvaluations, setHasEvaluations] = useState(false);
  const [maxLocked, setMaxLocked] = useState(false);
  const [maxHint, setMaxHint] = useState(null);
  const [partialCreate, setPartialCreate] = useState(null);
  const [rubricBusy, setRubricBusy] = useState(false);

  useEffect(() => {
    if (!openCreate) return;
    setShowCreate(true);
    setEditing(() => null);
    setEvaluation(emptyEvaluationSelection());
    setBaselineKey("none");
    setHasEvaluations(false);
    setMaxLocked(false);
    setMaxHint(null);
    setPartialCreate(null);
    onCreateOpened?.();
  }, [openCreate, onCreateOpened]);

  const openEdit = useCallback(async (activity) => {
    setShowCreate(false);
    setPartialCreate(null);
    setLocalErr("");
    setEditing(activity);
    const loaded = await loadEvaluationForActivity(activity.id);
    setEvaluation(loaded.selection);
    setBaselineKey(loaded.baselineKey);
    setHasEvaluations(loaded.hasEvaluations);
    if (loaded.selection.mode !== "none" && loaded.selection.scoringMode === "points") {
      setMaxLocked(true);
      setMaxHint(t("pcMaxDefinedByRubric"));
    } else if (loaded.selection.scoringMode === "qualitative" && loaded.selection.mode !== "none") {
      setMaxLocked(false);
      setMaxHint(t("pcRubricNoNumericGrade"));
    } else {
      setMaxLocked(false);
      setMaxHint(null);
    }
  }, []);

  useEffect(() => {
    if (!editActivityId || mode !== COURSE_ACCESS_MODES.TEACHING) return;
    const target = (activities || []).find((a) => a.id === editActivityId);
    if (!target) return;
    void openEdit(target);
    onEditOpened?.();
  }, [editActivityId, activities, mode, openEdit, onEditOpened]);

  const handleMaxPointsEffect = useCallback((effect) => {
    if (effect?.kind === "points" && effect.lockMax) {
      setMaxLocked(true);
      setMaxHint(t("pcMaxDefinedByRubric"));
      return;
    }
    if (effect?.kind === "qualitative") {
      setMaxLocked(false);
      setMaxHint(t("pcRubricNoNumericGrade"));
      return;
    }
    setMaxLocked(false);
    setMaxHint(null);
  }, []);

  const resetFormState = () => {
    setEvaluation(emptyEvaluationSelection());
    setBaselineKey("none");
    setHasEvaluations(false);
    setMaxLocked(false);
    setMaxHint(null);
    setPartialCreate(null);
  };

  const handleCreate = async (fields) => {
    setLocalErr("");
    const { evaluation: stagedEval, ...activityFields } = fields;
    const { row, error } = await createPybotclassActivity(supabase, {
      courseId,
      createdBy: user.id,
      ...activityFields,
    });
    if (error && !row) {
      setLocalErr(error);
      return;
    }
    if (!row?.id) {
      setLocalErr(error || t("pcSaveActivityFail"));
      return;
    }

    const rubricResult = await persistEvaluationSelection(row.id, stagedEval, "none");
    if (!rubricResult.ok) {
      setPartialCreate({
        activityId: row.id,
        selection: stagedEval,
        error: rubricResult.error,
      });
      setLocalErr(t("pcActivityCreatedRubricFail"));
      await onReload();
      return;
    }

    setShowCreate(false);
    resetFormState();
    setFeedback(t("pcActivityCreated"));
    await onReload();
    if (error) {
      // Activity created with a non-fatal warning (e.g. missing close column).
      setLocalErr(error);
    }
  };

  const handleUpdate = async (fields) => {
    if (!editing) return;
    setLocalErr("");
    const { evaluation: stagedEval, ...activityFields } = fields;
    const result = await updatePybotclassActivity(supabase, editing.id, activityFields);
    if (!result.ok) {
      setLocalErr(result.error || t("pcSaveActivityFail"));
      if (result.partial) await onReload();
      return;
    }

    const rubricResult = await persistEvaluationSelection(
      editing.id,
      stagedEval,
      baselineKey,
    );
    if (!rubricResult.ok) {
      const msg =
        rubricResult.error === "rubric_has_evaluations"
          ? t("pcRubricHasEvaluationsLocked")
          : rubricResult.error || t("pcRubricApplyFail");
      setLocalErr(msg);
      await onReload();
      return;
    }

    setEditing(null);
    resetFormState();
    await onReload();
  };

  const retryApplyRubric = async () => {
    if (!partialCreate?.activityId || rubricBusy) return;
    setRubricBusy(true);
    setLocalErr("");
    const r = await persistEvaluationSelection(
      partialCreate.activityId,
      partialCreate.selection,
      "none",
    );
    setRubricBusy(false);
    if (!r.ok) {
      setLocalErr(t("pcActivityCreatedRubricFail"));
      return;
    }
    setShowCreate(false);
    resetFormState();
    setFeedback(t("pcActivityCreated"));
    await onReload();
  };

  const continueWithoutRubric = async () => {
    setShowCreate(false);
    resetFormState();
    setFeedback(t("pcActivityCreated"));
    await onReload();
  };

  if (mode === COURSE_ACCESS_MODES.NONE || !mode) {
    return <PbcEmpty title={t("pcNoCourseAccess")} />;
  }

  if (mode === COURSE_ACCESS_MODES.STUDYING) {
    return (
      <PbcSection title={activitiesSectionTitle()}>
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

  if (mode === COURSE_ACCESS_MODES.ADMIN) {
    return (
      <PbcSection
        title={activitiesSectionTitle()}
        description={t("pcAdminReadOnly")}
      >
        {activities.length === 0 ? (
          <PbcEmpty title={t("pcNoActivities")} />
        ) : (
          <PbcList>
            {activities.map((a) => (
              <PbcListItem
                key={a.id}
                title={a.title}
                meta={activityListMeta(a)}
                badges={activityListBadges(a)}
              />
            ))}
          </PbcList>
        )}
      </PbcSection>
    );
  }

  // teaching — controles docentes existentes
  return (
    <>
      <PbcSection
        title={activitiesSectionTitle()}
        description={`${activities.length} ${t("pcActivities")}`}
        actions={
          <>
            <button
              type="button"
              className="pbc-btn pbc-btn--primary pbc-btn--sm"
              onClick={() => {
                setShowCreate(true);
                setEditing(null);
                resetFormState();
              }}
            >
              + {t("pcCreateActivity")}
            </button>
            {onAssignContent || onImportClassroom ? (
              <PbcOverflowMenu>
                {onAssignContent ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="pbc-overflow-menu__item"
                    onClick={onAssignContent}
                  >
                    {t("pcAssignContent")}
                  </button>
                ) : null}
                {onImportClassroom ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="pbc-overflow-menu__item"
                    disabled={importBusy}
                    onClick={() => void onImportClassroom()}
                  >
                    {importBusy ? t("pcImporting") : t("pcImportClassroom")}
                  </button>
                ) : null}
              </PbcOverflowMenu>
            ) : null}
          </>
        }
      >
        {feedback ? <p className="pbc-feedback" role="status">{feedback}</p> : null}
        {activities.length === 0 ? (
          <PbcEmpty
            title={t("pcActivitiesEmptyTitle")}
            description={t("pcActivitiesEmptyDesc")}
            actions={
              <div className="pbc-empty__actions-row">
                <button
                  type="button"
                  className="pbc-btn pbc-btn--primary pbc-btn--sm"
                  onClick={() => {
                    setShowCreate(true);
                    setEditing(null);
                    resetFormState();
                  }}
                >
                  {t("pcCreateActivity")}
                </button>
              </div>
            }
          />
        ) : (
          <PbcList>
            {activities.map((a) => (
              <PbcListItem
                key={a.id}
                title={a.title}
                meta={activityListMeta(a)}
                badges={activityListBadges(a)}
                actions={
                  <>
                    <Link className="pbc-btn pbc-btn--primary pbc-btn--sm" to={`/actividad/${a.id}`}>
                      {t("pcReview")}
                    </Link>
                    <PbcOverflowMenu>
                      <button
                        type="button"
                        role="menuitem"
                        className="pbc-overflow-menu__item"
                        onClick={() => void openEdit(a)}
                      >
                        {t("pcEdit")}
                      </button>
                    </PbcOverflowMenu>
                  </>
                }
              />
            ))}
          </PbcList>
        )}
      </PbcSection>

      {showCreate ? (
        <PbcFormPanel
          title={t("pcNewActivity")}
          onCancel={() => {
            if (partialCreate) return;
            setShowCreate(false);
            resetFormState();
          }}
        >
          {partialCreate ? (
            <div className="pbc-eval-partial" role="alert">
              <p>{t("pcActivityCreatedRubricFail")}</p>
              <div className="pbc-eval-partial__actions">
                <button
                  type="button"
                  className="pbc-btn pbc-btn--primary pbc-btn--sm"
                  disabled={rubricBusy}
                  onClick={() => void retryApplyRubric()}
                >
                  {t("pcRetryApplyRubric")}
                </button>
                <button
                  type="button"
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                  disabled={rubricBusy}
                  onClick={() => void continueWithoutRubric()}
                >
                  {t("pcContinueWithoutRubric")}
                </button>
              </div>
            </div>
          ) : (
            <ActivityForm
              saving={saving || rubricBusy}
              err={localErr || err}
              onSubmit={handleCreate}
              onCancel={() => {
                setShowCreate(false);
                resetFormState();
              }}
              evaluation={evaluation}
              onEvaluationChange={setEvaluation}
              onMaxPointsEffect={handleMaxPointsEffect}
              hasEvaluations={false}
              maxLocked={maxLocked}
              maxHint={maxHint}
            />
          )}
        </PbcFormPanel>
      ) : null}

      {editing ? (
        <PbcFormPanel
          title={t("pcEditActivity")}
          onCancel={() => {
            setEditing(null);
            resetFormState();
          }}
        >
          <ActivityForm
            initial={editing}
            saving={saving || rubricBusy}
            err={localErr || err}
            onSubmit={handleUpdate}
            onCancel={() => {
              setEditing(null);
              resetFormState();
            }}
            evaluation={evaluation}
            onEvaluationChange={setEvaluation}
            onMaxPointsEffect={handleMaxPointsEffect}
            hasEvaluations={hasEvaluations}
            maxLocked={maxLocked}
            maxHint={maxHint}
          />
        </PbcFormPanel>
      ) : null}

      <CourseContentProgressPanel courseId={courseId} />
    </>
  );
}
