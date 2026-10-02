import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  RubricTemplateAuthoringForm,
  defaultRubricEditorState,
} from "../components/pybotclass/ActivityRubricPanels.jsx";
import { UxIcon } from "../components/pybotclass/illustrations/UxIcons.jsx";
import {
  IconAssign,
  IconCopy,
  IconEdit,
  IconMore,
  IconTrash,
} from "../components/pybotclass/illustrations/ActionIcons.jsx";
import {
  applyRubricTemplateToActivity,
  deleteRubricTemplate,
  getRubricTemplate,
  listMyRubricTemplates,
  upsertRubricTemplate,
} from "../platform/activitySubmissions.js";
import { rubricDuplicateName, rubricPointsCeiling } from "../platform/rubrics.js";
import { normalizeCourseRole } from "../platform/courseRole.js";
import {
  fetchCourseActivities,
  listPybotclassMyCourses,
} from "../platform/pybotClassApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import { t } from "../i18n.js";

function formatModified(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function scoringModeLabel(mode) {
  return mode === "qualitative" ? t("pcRubricModeQualitative") : t("pcRubricModePoints");
}

function criteriaPayloadFromEditor(criteria, scoringMode) {
  return (criteria || [])
    .filter((c) => String(c.name || "").trim())
    .map((c) => ({
      name: String(c.name).trim(),
      description: c.description || null,
      levels: (c.levels || [])
        .filter((lv) => String(lv.name || "").trim())
        .map((lv) => ({
          name: String(lv.name).trim(),
          descriptor: lv.descriptor || null,
          points:
            scoringMode === "points" && lv.points !== "" && lv.points != null
              ? Number(lv.points)
              : null,
        })),
    }));
}

function editorFromTemplate(template) {
  const mode = template?.scoring_mode === "qualitative" ? "qualitative" : "points";
  return {
    scoringMode: mode,
    name: template?.name || "",
    description: template?.description || "",
    criteria: (template?.criteria || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      description: c.description || "",
      levels: (c.levels || []).map((lv) => ({
        id: lv.id,
        name: lv.name || "",
        descriptor: lv.descriptor || "",
        points: mode === "points" && lv.points != null ? String(lv.points) : "",
      })),
    })),
  };
}

function canTeachCourseRow(row) {
  return normalizeCourseRole(row?.my_course_role) === "teacher";
}

/**
 * PyBotClass reusable P9 rubric templates library.
 * Authoring/reuse only — grading stays on ActivityPage.
 */
export default function MyRubricsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(
    "/dashboard/rubrics",
  );
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [feedback, setFeedback] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formMode, setFormMode] = useState("qualitative");
  const [formCriteria, setFormCriteria] = useState(() => defaultRubricEditorState("qualitative").criteria);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [menuOpenId, setMenuOpenId] = useState(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState(null);
  const [applyCourses, setApplyCourses] = useState([]);
  const [applyCourseId, setApplyCourseId] = useState("");
  const [applyActivities, setApplyActivities] = useState([]);
  const [applyActivityId, setApplyActivityId] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyErr, setApplyErr] = useState("");
  const [applyMismatch, setApplyMismatch] = useState(null);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");
    const [{ templates: rows, error }, { profile }] = await Promise.all([
      listMyRubricTemplates(),
      fetchProfile(user.id),
    ]);
    setSuperAdmin(isSuperAdmin(profile));
    if (error) {
      setErr(error);
      setTemplates([]);
      setLoading(false);
      return;
    }
    setTemplates(rows || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  useEffect(() => {
    if (!menuOpenId) return undefined;
    const onDoc = () => setMenuOpenId(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpenId]);

  const openCreate = () => {
    const seed = defaultRubricEditorState("qualitative");
    setEditingId(null);
    setFormName("");
    setFormDescription("");
    setFormMode("qualitative");
    setFormCriteria(seed.criteria);
    setErr("");
    setFeedback("");
    setEditorOpen(true);
  };

  const openEdit = async (row) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    setFeedback("");
    const { template, error } = await getRubricTemplate(row.id);
    setBusy(false);
    if (error || !template) {
      setErr(error || t("pcRubricLoadFail"));
      return;
    }
    const editor = editorFromTemplate(template);
    setEditingId(template.id);
    setFormName(editor.name);
    setFormDescription(editor.description);
    setFormMode(editor.scoringMode);
    setFormCriteria(
      editor.criteria.length ? editor.criteria : defaultRubricEditorState(editor.scoringMode).criteria,
    );
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    setFeedback("");
    const criteria = criteriaPayloadFromEditor(formCriteria, formMode);
    const r = await upsertRubricTemplate({
      templateId: editingId || null,
      name: formName.trim(),
      description: formDescription.trim() || null,
      scoringMode: formMode,
      criteria,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || t("pcRubricSaveFail"));
      return;
    }
    setEditorOpen(false);
    setFeedback(editingId ? t("pcRubricUpdated") : t("pcRubricCreated"));
    await load();
  };

  const handleDuplicate = async (row) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    setFeedback("");
    setMenuOpenId(null);
    const { template, error } = await getRubricTemplate(row.id);
    if (error || !template) {
      setBusy(false);
      setErr(error || t("pcRubricLoadFail"));
      return;
    }
    const criteria = (template.criteria || []).map((c) => ({
      name: c.name,
      description: c.description || null,
      levels: (c.levels || []).map((lv) => ({
        name: lv.name,
        descriptor: lv.descriptor || null,
        points: template.scoring_mode === "points" ? lv.points : null,
      })),
    }));
    const r = await upsertRubricTemplate({
      templateId: null,
      name: rubricDuplicateName(template.name, t("pcRubricUntitled")),
      description: template.description || null,
      scoringMode: template.scoring_mode,
      criteria,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || t("pcRubricDuplicateFail"));
      return;
    }
    setFeedback(t("pcRubricDuplicated"));
    await load();
  };

  const confirmDelete = async () => {
    if (!deleting?.id || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteErr("");
    const r = await deleteRubricTemplate(deleting.id);
    setDeleteBusy(false);
    if (!r.ok) {
      setDeleteErr(r.error || t("pcRubricDeleteFail"));
      return;
    }
    setDeleting(null);
    setFeedback(t("pcRubricDeleted"));
    await load();
  };

  const openUseModal = async (row) => {
    if (busy || applyBusy) return;
    setApplyErr("");
    setApplyMismatch(null);
    setApplyActivityId("");
    setApplyCourseId("");
    setApplyActivities([]);
    setApplyBusy(true);
    const { template, error } = await getRubricTemplate(row.id);
    if (error || !template) {
      setApplyBusy(false);
      setErr(error || t("pcRubricLoadFail"));
      return;
    }
    const { rows, error: courseErr } = await listPybotclassMyCourses(null);
    setApplyBusy(false);
    if (courseErr) {
      setErr(courseErr);
      return;
    }
    const teacherCourses = (rows || []).filter(canTeachCourseRow);
    setApplyTemplate(template);
    setApplyCourses(teacherCourses);
    setApplyOpen(true);
  };

  const onSelectApplyCourse = async (courseId) => {
    setApplyCourseId(courseId);
    setApplyActivityId("");
    setApplyMismatch(null);
    setApplyErr("");
    if (!courseId) {
      setApplyActivities([]);
      return;
    }
    setApplyBusy(true);
    const { rows, error } = await fetchCourseActivities(courseId);
    setApplyBusy(false);
    if (error) {
      setApplyErr(error);
      setApplyActivities([]);
      return;
    }
    setApplyActivities(rows || []);
  };

  const onSelectApplyActivity = (activityId) => {
    setApplyActivityId(activityId);
    setApplyMismatch(null);
    setApplyErr("");
    if (!activityId || !applyTemplate) return;
    const activity = applyActivities.find((a) => a.id === activityId);
    if (!activity) return;
    if (applyTemplate.scoring_mode === "qualitative") return;
    const ceiling = rubricPointsCeiling(applyTemplate.criteria || []);
    const max = activity.max_points != null ? Number(activity.max_points) : null;
    if (ceiling != null && max != null && Math.abs(ceiling - max) > 0.0001) {
      setApplyMismatch({ ceiling, max, activityId, courseId: applyCourseId });
    }
  };

  const handleApplyRubric = async () => {
    if (!applyTemplate?.id || !applyActivityId || applyBusy || applyMismatch) return;
    setApplyBusy(true);
    setApplyErr("");
    const r = await applyRubricTemplateToActivity(applyActivityId, applyTemplate.id);
    setApplyBusy(false);
    if (!r.ok) {
      if (r.error === "rubric_max_mismatch") {
        const detail = r.detail || {};
        setApplyMismatch({
          ceiling: detail.rubric_sum,
          max: detail.max_points,
          activityId: applyActivityId,
          courseId: applyCourseId,
        });
        return;
      }
      setApplyErr(
        r.error === "rubric_has_evaluations"
          ? t("pcRubricHasEvaluationsLocked")
          : r.error || t("pcRubricApplyFail"),
      );
      return;
    }
    setApplyOpen(false);
    setApplyTemplate(null);
    setFeedback(t("pcRubricApplyOk"));
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center" role="status">
        <p>{t("pcLoadingGeneric")}</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
      {profileError ? (
        <div className="pbc-alert pbc-alert--error" role="alert">
          {profileError}
        </div>
      ) : null}
      {err ? (
        <div className="pbc-alert pbc-alert--error" role="alert">
          {err}
        </div>
      ) : null}
      {feedback ? (
        <p className="pbc-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="pbc-content-page pbc-rubrics-page">
        <header className="pbc-hero-block pbc-content-page__head">
          <div className="pbc-hero-block__identity">
            <span aria-hidden>
              <UxIcon name="checklist" size={48} />
            </span>
            <div className="pbc-hero-block__text">
              <h1 className="pbc-hero-block__title">{t("pcMyRubrics")}</h1>
              <p className="pbc-hero-block__subtitle">{t("pcRubricsPageLead")}</p>
            </div>
          </div>
          <div className="pbc-hero-block__actions">
            {!editorOpen ? (
              <button type="button" className="pbc-btn pbc-btn--primary" onClick={openCreate}>
                {t("pcNewRubric")}
              </button>
            ) : null}
          </div>
        </header>

        {editorOpen ? (
          <section className="pbc-rubric-library-editor" aria-labelledby="rubric-editor-title">
            <h2 id="rubric-editor-title" className="pbc-rubric-library-editor__title">
              {editingId ? t("pcEditRubric") : t("pcNewRubric")}
            </h2>
            <RubricTemplateAuthoringForm
              name={formName}
              onNameChange={setFormName}
              description={formDescription}
              onDescriptionChange={setFormDescription}
              scoringMode={formMode}
              onScoringModeChange={(mode) => {
                setFormMode(mode);
                setFormCriteria((prev) =>
                  prev.map((c) => ({
                    ...c,
                    levels: (c.levels || []).map((lv) => ({
                      ...lv,
                      points: mode === "points" ? lv.points ?? "" : null,
                    })),
                  })),
                );
              }}
              criteria={formCriteria}
              onCriteriaChange={setFormCriteria}
              busy={busy}
              onSave={() => void handleSave()}
              onCancel={() => setEditorOpen(false)}
              saveLabel={editingId ? t("pcSave") : t("pcCreateRubric")}
            />
          </section>
        ) : templates.length === 0 ? (
          <div className="pbc-empty-state pbc-empty-state--content">
            <h3 className="pbc-empty-state__title">{t("pcRubricsEmptyTitle")}</h3>
            <p className="pbc-empty-state__desc">{t("pcRubricsEmptyDesc")}</p>
            <div className="pbc-empty-state__actions">
              <button type="button" className="pbc-btn pbc-btn--primary" onClick={openCreate}>
                {t("pcCreateRubric")}
              </button>
            </div>
          </div>
        ) : (
          <ul className="pbc-content-grid pbc-rubrics-grid">
            {templates.map((row) => {
              const modified = formatModified(row.updated_at);
              const count =
                typeof row.criteria_count === "number"
                  ? row.criteria_count
                  : Array.isArray(row.criteria)
                    ? row.criteria.length
                    : null;
              return (
                <li key={row.id} className="pbc-content-card pbc-rubric-card">
                  <div className="pbc-content-card__header">
                    <h3 className="pbc-content-card__title">{row.name}</h3>
                  </div>
                  <p className="pbc-content-card__meta">
                    <span>{scoringModeLabel(row.scoring_mode)}</span>
                    {typeof count === "number" ? (
                      <span>
                        {" · "}
                        {t("pcRubricCriteriaCount").replace("{n}", String(count))}
                      </span>
                    ) : null}
                    {modified ? (
                      <span>
                        {" · "}
                        {t("pcModified")}: {modified}
                      </span>
                    ) : null}
                  </p>
                  {row.description ? (
                    <p className="pbc-content-card__desc">{row.description}</p>
                  ) : null}
                  <div className="pbc-rubric-card__actions">
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-eval-btn-with-icon"
                      disabled={busy || applyBusy}
                      onClick={() => void openUseModal(row)}
                    >
                      <IconAssign size={18} />
                      <span>{t("pcUse")}</span>
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                      disabled={busy}
                      onClick={() => void openEdit(row)}
                    >
                      <IconEdit size={18} />
                      <span>{t("pcEdit")}</span>
                    </button>
                    <div className="pbc-rubric-card__more">
                      <button
                        type="button"
                        className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                        disabled={busy}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId((id) => (id === row.id ? null : row.id));
                        }}
                      >
                        <IconMore size={18} />
                        <span>{t("pcMore")}</span>
                      </button>
                      {menuOpenId === row.id ? (
                        <div className="pbc-rubric-card__menu" role="menu">
                          <button
                            type="button"
                            className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => void handleDuplicate(row)}
                          >
                            <IconCopy size={18} />
                            <span>{t("pcDuplicate")}</span>
                          </button>
                          <button
                            type="button"
                            className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              setMenuOpenId(null);
                              setDeleteErr("");
                              setDeleting(row);
                            }}
                          >
                            <IconTrash size={18} />
                            <span>{t("pcDelete")}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {applyOpen && applyTemplate ? (
        <div
          className="pbc-modal-backdrop pbc-modal-backdrop--create-content"
          role="presentation"
          onClick={() => !applyBusy && setApplyOpen(false)}
        >
          <div
            className="pbc-modal pbc-modal--create-content"
            role="dialog"
            aria-labelledby="apply-rubric-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="apply-rubric-title" className="pbc-modal__title">
              {t("pcUse")} · {applyTemplate.name}
            </h2>
            {applyCourses.length === 0 ? (
              <p className="pbc-modal--create-content__subtitle">{t("pcNoTeacherCourses")}</p>
            ) : (
              <>
                <label className="pbc-rubric-apply-modal__field">
                  <span className="auth-org-label">{t("pcSelectCourse")}</span>
                  <select
                    className="auth-org-input auth-org-input--block"
                    value={applyCourseId}
                    disabled={applyBusy}
                    onChange={(e) => void onSelectApplyCourse(e.target.value)}
                  >
                    <option value="">—</option>
                    {applyCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title || c.name || c.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pbc-rubric-apply-modal__field">
                  <span className="auth-org-label">{t("pcSelectActivity")}</span>
                  <select
                    className="auth-org-input auth-org-input--block"
                    value={applyActivityId}
                    disabled={applyBusy || !applyCourseId}
                    onChange={(e) => onSelectApplyActivity(e.target.value)}
                  >
                    <option value="">—</option>
                    {applyActivities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                        {a.max_points != null ? ` (${a.max_points})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {applyCourseId && applyActivities.length === 0 && !applyBusy ? (
                  <p className="auth-card__muted">{t("pcNoCourseActivities")}</p>
                ) : null}
              </>
            )}
            {applyMismatch ? (
              <div className="pbc-rubric-apply-modal__mismatch" role="alert">
                <p>
                  {t("pcRubricPointsMismatch")
                    .replace("{activity}", String(applyMismatch.max))
                    .replace("{rubric}", String(applyMismatch.ceiling))}
                </p>
                <Link
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                  to={`/actividad/${applyMismatch.activityId}`}
                >
                  {t("pcEditActivity")}
                </Link>
              </div>
            ) : null}
            {applyErr ? (
              <p className="pbc-alert pbc-alert--error" role="alert">
                {applyErr}
              </p>
            ) : null}
            <div className="pbc-modal__actions">
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost"
                disabled={applyBusy}
                onClick={() => setApplyOpen(false)}
              >
                {t("pcCancel")}
              </button>
              <button
                type="button"
                className="pbc-btn pbc-btn--primary"
                disabled={
                  applyBusy ||
                  !applyActivityId ||
                  Boolean(applyMismatch) ||
                  applyCourses.length === 0
                }
                onClick={() => void handleApplyRubric()}
              >
                {applyBusy ? t("pcSaving") : t("pcApplyRubric")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <div
          className="pbc-modal-backdrop pbc-modal-backdrop--create-content"
          role="presentation"
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="pbc-modal pbc-modal--create-content"
            role="dialog"
            aria-labelledby="delete-rubric-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-rubric-title" className="pbc-modal__title">
              {t("pcDeleteRubric")}
            </h2>
            <p className="pbc-modal--create-content__subtitle">
              {t("pcDeleteRubricQuestion")} «{deleting.name}»?
            </p>
            <p className="pbc-modal--create-content__subtitle">{t("pcDeleteRubricFrozenSafe")}</p>
            <p className="pbc-modal--create-content__subtitle pbc-modal--create-content__subtitle--warn">
              {t("pcCannotUndo")}
            </p>
            {deleteErr ? (
              <p className="pbc-alert pbc-alert--error" role="alert">
                {deleteErr}
              </p>
            ) : null}
            <div className="pbc-modal__actions">
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
              >
                {t("pcCancel")}
              </button>
              <button
                type="button"
                className="pbc-btn pbc-btn--danger"
                onClick={() => void confirmDelete()}
                disabled={deleteBusy}
              >
                {deleteBusy ? t("pcDeleting") : t("pcDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PyBotClassLayout>
  );
}
