import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  RubricTemplateAuthoringForm,
  defaultRubricEditorState,
} from "../components/pybotclass/ActivityRubricPanels.jsx";
import { UxIcon } from "../components/pybotclass/illustrations/UxIcons.jsx";
import {
  deleteRubricTemplate,
  getRubricTemplate,
  listMyRubricTemplates,
  upsertRubricTemplate,
} from "../platform/activitySubmissions.js";
import { rubricDuplicateName } from "../platform/rubrics.js";
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
              // list_my_rubric_templates has no criteria count — do not invent it.
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
                  <div className="pbc-content-card__direct-actions">
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost"
                      disabled={busy}
                      onClick={() => void openEdit(row)}
                    >
                      {t("pcEdit")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost"
                      disabled={busy}
                      onClick={() => void handleDuplicate(row)}
                    >
                      {t("pcDuplicate")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost"
                      disabled={busy}
                      onClick={() => {
                        setDeleteErr("");
                        setDeleting(row);
                      }}
                    >
                      {t("pcDelete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
