import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";
import ShareContentModal from "../components/content-editor/ShareContentModal.jsx";
import ContentMetaChips from "../components/pybotclass/content/ContentMetaChips.jsx";
import ContentTableOfContents from "../components/pybotclass/content/ContentTableOfContents.jsx";
import TitleTypeDialog from "../components/pybotclass/content/TitleTypeDialog.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { t } from "../i18n.js";
import {
  UNIT_TYPES,
  UNIT_DIRECT_CREATE_TYPES,
  LESSON_CHILD_CREATE_TYPES,
  itemTypeOptionsForEdit,
  createContentUnit,
  createLesson,
  deleteContentUnit,
  deleteLesson,
  getContent,
  listContentUnits,
  listLessonChildren,
  listUnitLessons,
  moveContentUnit,
  moveLesson,
  updateContentUnit,
  updateLesson,
  copyLearningContent,
} from "../platform/contentApi.js";
import { listTeacherCoursesForAssign } from "../platform/contentAssignApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

function PencilIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 16.5V20h3.5L17.8 9.7l-3.5-3.5L4 16.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 5.3l3.5 3.5 1.8-1.8a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0l-1.8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ItemTypeIcon({ itemType, size = 18 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true };
  switch (itemType) {
    case "video":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
        </svg>
      );
    case "exercise":
      return <PencilIcon size={size} />;
    case "quiz":
    case "test":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 12.5l1.8 1.8 3.7-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "assignment":
      return (
        <svg {...common}>
          <path
            d="M8 4.75h8A1.25 1.25 0 0 1 17.25 6v14L12 17.5 6.75 20V6A1.25 1.25 0 0 1 8 4.75Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "project":
      return (
        <svg {...common}>
          <path
            d="M3.75 8.5V18A1.25 1.25 0 0 0 5 19.25h14A1.25 1.25 0 0 0 20.25 18V9.75H10.5L8.75 7.5H5A1.25 1.25 0 0 0 3.75 8.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "resource":
      return (
        <svg {...common}>
          <path
            d="M7 4.75h7.5L19 9.25V19.5A.75.75 0 0 1 18.25 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 11h6M9 14.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path
            d="M7 3.75h7.5L19 8.25V20a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 20V5A1.25 1.25 0 0 1 7 3.75Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M14.5 3.75V8.5H19" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9 12.5h6M9 16h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}

export default function ContentEditorPage() {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/content/${contentId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [content, setContent] = useState(null);
  const [units, setUnits] = useState([]);
  const [lessonsByUnit, setLessonsByUnit] = useState({});
  const [itemsByLesson, setItemsByLesson] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [canAssign, setCanAssign] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [titleTypeDialog, setTitleTypeDialog] = useState(null);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user || !contentId) return;
    setLoading(true);
    setErr("");

    const [{ content: c, error: cErr }, { rows: unitRows, error: uErr }, { profile }, teacherCourses] =
      await Promise.all([
        getContent(contentId),
        listContentUnits(contentId),
        fetchProfile(user.id),
        listTeacherCoursesForAssign(),
      ]);

    setSuperAdmin(isSuperAdmin(profile));
    setCanAssign((teacherCourses.rows || []).length > 0);

    if (cErr || !c) {
      setErr(cErr || "Contenido no encontrado.");
      setLoading(false);
      return;
    }

    const owner = c.owner_id === user.id;
    setIsOwner(owner);
    if (!owner) {
      navigate(`/dashboard/community/${contentId}`, { replace: true });
      return;
    }

    if (uErr) setErr(uErr);

    const ownerName = profile?.display_name || profile?.email || null;
    const nameIds = [
      c.original_owner_id,
      c.original_creator_id,
      c.first_community_published_by_id,
    ].filter((id) => id && id !== user.id);
    const nameMap = {};
    if (nameIds.length && supabase) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", nameIds);
      for (const p of profs ?? []) {
        nameMap[p.id] = p.display_name || p.email || null;
      }
    }
    const resolveName = (id) => {
      if (!id) return null;
      if (id === user.id) return ownerName;
      return nameMap[id] || null;
    };

    const lessonMap = {};
    const childMap = {};
    await Promise.all(
      unitRows.map(async (unit) => {
        const { rows } = await listUnitLessons(unit.id);
        lessonMap[unit.id] = rows;
        const lessonContainers = rows.filter((r) => (r.item_type || "lesson") === "lesson");
        await Promise.all(
          lessonContainers.map(async (lesson) => {
            const { rows: children, error: childErr } = await listLessonChildren(lesson.id);
            // Missing V3 schema: no children; do not blank the editor.
            childMap[lesson.id] = childErr ? [] : children;
          }),
        );
      }),
    );

    setContent({
      ...c,
      owner_name: ownerName,
      original_owner_name: resolveName(c.original_owner_id),
      original_creator_name: resolveName(c.original_creator_id),
      first_community_published_by_name: resolveName(c.first_community_published_by_id),
    });
    setUnits(unitRows);
    setLessonsByUnit(lessonMap);
    setItemsByLesson(childMap);
    setLoading(false);
  }, [user, contentId, navigate, supabase]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const openCreateUnit = () => {
    if (busy) return;
    setTitleTypeDialog({
      kind: "unit",
      mode: "create",
      initialTitle: "",
      initialType: "unit",
    });
  };

  const openEditUnit = (unit) => {
    setTitleTypeDialog({
      kind: "unit",
      mode: "edit",
      target: unit,
      initialTitle: unit.title || "",
      initialType: unit.unit_type || "unit",
    });
  };

  const openCreateItem = (unitId) => {
    if (busy) return;
    setTitleTypeDialog({
      kind: "item",
      mode: "create",
      context: "unit",
      unitId,
      parentLessonId: null,
      initialTitle: "",
      initialType: "lesson",
      typeOptions: [...UNIT_DIRECT_CREATE_TYPES],
    });
  };

  const openCreateChildItem = (unitId, lesson) => {
    if (busy) return;
    setTitleTypeDialog({
      kind: "item",
      mode: "create",
      context: "lesson",
      unitId,
      parentLessonId: lesson.id,
      initialTitle: "",
      initialType: "reading",
      typeOptions: [...LESSON_CHILD_CREATE_TYPES],
    });
  };

  const openEditItem = (lesson) => {
    const parentLessonId = lesson.parent_lesson_id ?? null;
    setTitleTypeDialog({
      kind: "item",
      mode: "edit",
      target: lesson,
      parentLessonId,
      initialTitle: lesson.title || "",
      initialType: lesson.item_type || "lesson",
      typeOptions: itemTypeOptionsForEdit({
        itemType: lesson.item_type || "lesson",
        parentLessonId,
      }),
    });
  };

  const closeTitleTypeDialog = () => setTitleTypeDialog(null);

  const submitTitleTypeDialog = async ({ title, type }) => {
    if (!titleTypeDialog) return { error: t("pcUnexpectedError") };
    const { kind, mode, target, unitId, parentLessonId } = titleTypeDialog;

    if (kind === "unit" && mode === "create") {
      setBusy(true);
      const { unit, error } = await createContentUnit(contentId, {
        title,
        unitType: type,
      });
      setBusy(false);
      if (error || !unit) {
        return { error: error || "No se pudo crear la unidad." };
      }
      void load();
      return {};
    }

    if (kind === "unit" && mode === "edit") {
      const unit = target;
      const prevType = unit.unit_type || "unit";
      if (title === unit.title && type === prevType) return {};
      setBusy(true);
      const { error } = await updateContentUnit(unit.id, {
        title,
        unitType: type,
      });
      setBusy(false);
      if (error) return { error };
      void load();
      return {};
    }

    if (kind === "item" && mode === "create") {
      setBusy(true);
      const { lesson, error } = await createLesson(unitId, {
        title,
        itemType: type,
        parentLessonId: parentLessonId || null,
      });
      setBusy(false);
      if (error || !lesson) {
        return { error: error || "No se pudo crear la lección." };
      }
      navigate(`/dashboard/content/${contentId}/lessons/${lesson.id}`);
      return {};
    }

    if (kind === "item" && mode === "edit") {
      const lesson = target;
      const prevType = lesson.item_type || "lesson";
      if (title === lesson.title && type === prevType) return {};
      setBusy(true);
      const { error } = await updateLesson(lesson.id, {
        title,
        itemType: type,
      });
      setBusy(false);
      if (error) return { error };
      void load();
      return {};
    }

    return { error: t("pcUnexpectedError") };
  };

  const removeUnit = async (unit) => {
    if (!window.confirm(`¿Eliminar la unidad «${unit.title}» y todas sus lecciones?`)) return;
    setBusy(true);
    const { error } = await deleteContentUnit(unit.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const removeLesson = async (lesson) => {
    const isContainer =
      (lesson.item_type || "lesson") === "lesson" && (itemsByLesson[lesson.id]?.length ?? 0) > 0;
    const msg = isContainer
      ? t("pcDeleteLessonWithChildren").replace("{title}", lesson.title)
      : `¿Eliminar «${lesson.title}»?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    const { error } = await deleteLesson(lesson.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const moveUnit = async (unitId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveContentUnit(unitId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const moveLessonItem = async (lessonId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveLesson(lessonId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const handleCopy = async () => {
    if (busy || !contentId) return;
    setBusy(true);
    setErr("");
    const { content: copy, error } = await copyLearningContent(contentId);
    setBusy(false);
    if (error || !copy) {
      setErr(error || t("pcCopyFail"));
      return;
    }
    navigate(`/dashboard/content/${copy.id}`);
  };

  const onTocNavigate = (entry) => {
    if (entry.type === "unit") {
      const el = document.getElementById(`unit-${entry.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (entry.type === "item" || entry.type === "lesson") {
      navigate(`/dashboard/content/${contentId}/lessons/${entry.id}`);
    }
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center" role="status">
        <p>{t("pcLoadingGeneric")}</p>
      </main>
    );
  }
  if (!user || !content || !isOwner) return null;

  const dialogIsUnit = titleTypeDialog?.kind === "unit";
  const dialogIsCreate = titleTypeDialog?.mode === "create";
  const dialogTypeOptions = dialogIsUnit
    ? UNIT_TYPES
    : titleTypeDialog?.typeOptions || [...UNIT_DIRECT_CREATE_TYPES];
  const dialogTitle = dialogIsCreate
    ? dialogIsUnit
      ? t("pcNewUnit")
      : titleTypeDialog?.context === "lesson"
        ? t("pcAddToLesson")
        : t("pcNewItem")
    : t("pcEdit");

  const renderItemRow = ({
    lesson,
    lessonIndex,
    siblingCount,
    unitId,
    numberLabel,
    depth = 0,
  }) => {
    const itemType = lesson.item_type || "lesson";
    const isLessonContainer = itemType === "lesson" && depth === 0;
    const children = isLessonContainer ? itemsByLesson[lesson.id] ?? [] : [];

    return (
      <li
        key={lesson.id}
        id={`lesson-${lesson.id}`}
        className={`pbc-lesson-row${depth > 0 ? " pbc-lesson-row--child" : ""}`}
      >
        <Link
          to={`/dashboard/content/${contentId}/lessons/${lesson.id}`}
          className="pbc-lesson-row__main"
          aria-label={t("pcWriteContentOf").replace("{title}", lesson.title)}
        >
          <span className="pbc-lesson-row__icon" aria-hidden>
            <ItemTypeIcon itemType={itemType} />
          </span>
          <span className="pbc-lesson-row__copy">
            <span className="pbc-lesson-row__title">
              <span className="pbc-type-badge">{t(`pcItemType_${itemType}`)}</span>{" "}
              {numberLabel} — {lesson.title}
            </span>
            <span className="pbc-lesson-row__subtitle">{t("pcTapToWrite")}</span>
          </span>
          <span className="pbc-lesson-row__cta">
            <PencilIcon size={15} />
            {t("pcWriteContent")}
          </span>
        </Link>
        <div className="pbc-lesson-row__actions">
          <div className="pbc-order-btns">
            <button
              type="button"
              className="pbc-order-btn"
              onClick={() => void moveLessonItem(lesson.id, "up")}
              disabled={busy || lessonIndex === 0}
              aria-label={t("pcMoveItemUp")}
            >
              ↑
            </button>
            <button
              type="button"
              className="pbc-order-btn"
              onClick={() => void moveLessonItem(lesson.id, "down")}
              disabled={busy || lessonIndex === siblingCount - 1}
              aria-label={t("pcMoveItemDown")}
            >
              ↓
            </button>
          </div>
          {canAssign && depth === 0 ? (
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm"
              onClick={() =>
                setAssignTarget({
                  sourceType: "lesson",
                  sourceId: lesson.id,
                  defaultTitle: lesson.title,
                  contextLabel: "lección",
                })
              }
            >
              {t("pcAssign")}
            </button>
          ) : null}
          <button
            type="button"
            className="pbc-btn pbc-btn--ghost pbc-btn--sm"
            onClick={() => openEditItem(lesson)}
          >
            {t("pcEdit")}
          </button>
          <button
            type="button"
            className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-btn--danger-ghost"
            onClick={() => void removeLesson(lesson)}
          >
            {t("pcDelete")}
          </button>
        </div>
        {isLessonContainer ? (
          <>
            {children.length > 0 ? (
              <ul className="pbc-lesson-list pbc-lesson-list--nested">
                {children.map((child, childIndex) =>
                  renderItemRow({
                    lesson: child,
                    lessonIndex: childIndex,
                    siblingCount: children.length,
                    unitId,
                    numberLabel: `${numberLabel}.${childIndex + 1}`,
                    depth: 1,
                  }),
                )}
              </ul>
            ) : null}
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-lesson-row__add-child"
              onClick={() => openCreateChildItem(unitId, lesson)}
              disabled={busy}
            >
              <PencilIcon size={14} />
              {t("pcAddToLesson")}
            </button>
          </>
        ) : null}
      </li>
    );
  };

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

      <div className="pbc-content-editor">
        <nav className="pbc-content-breadcrumb" aria-label={t("pcRoute")}>
          <Link to="/dashboard/content">{t("pcMyContent")}</Link>
          <span aria-hidden> / </span>
          <span>{content.title}</span>
        </nav>

        <header className="pbc-content-editor__head">
          <h1 className="pbc-hero-block__title">{content.title}</h1>
          {content.description ? <p className="pbc-content-editor__description">{content.description}</p> : null}
          <ContentMetaChips content={content} showAuthor={Boolean(content.owner_name)} />
          <p className="pbc-content-editor__hint">{t("pcEditorStructureHint")}</p>
        </header>

        <div className="pbc-content-editor__actions">
          <button type="button" className="pbc-btn pbc-btn--primary" onClick={openCreateUnit} disabled={busy}>
            + {t("pcNewUnit")}
          </button>
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={() => setShareOpen(true)} disabled={busy}>
            {t("pcShare")}
          </button>
          {canAssign ? (
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost"
              onClick={() =>
                setAssignTarget({
                  sourceType: "content",
                  sourceId: content.id,
                  defaultTitle: content.title,
                  contextLabel: "contenido",
                })
              }
              disabled={busy}
            >
              {t("pcAssign")}
            </button>
          ) : null}
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={() => void handleCopy()} disabled={busy}>
            {busy ? t("pcCopying") : t("pcCreateCopy")}
          </button>
        </div>

        <ContentTableOfContents
          units={units}
          lessonsByUnit={lessonsByUnit}
          itemsByLesson={itemsByLesson}
          onNavigate={onTocNavigate}
        />

        {units.length === 0 ? (
          <div className="pbc-content-editor__empty" role="status">
            <p>{t("pcNoUnitsYet")}</p>
          </div>
        ) : (
          <div className="pbc-unit-list">
            {units.map((unit, unitIndex) => (
              <section key={unit.id} id={`unit-${unit.id}`} className="pbc-unit-card">
                <div className="pbc-unit-card__head">
                  <div className="pbc-unit-card__title-row">
                    <h2 className="pbc-unit-card__title">
                      <span className="pbc-type-badge">{t(`pcUnitType_${unit.unit_type || "unit"}`)}</span>{" "}
                      {unitIndex + 1} — {unit.title}
                    </h2>
                    <div className="pbc-order-btns">
                      <button
                        type="button"
                        className="pbc-order-btn"
                        onClick={() => void moveUnit(unit.id, "up")}
                        disabled={busy || unitIndex === 0}
                        aria-label={t("pcMoveUnitUp")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="pbc-order-btn"
                        onClick={() => void moveUnit(unit.id, "down")}
                        disabled={busy || unitIndex === units.length - 1}
                        aria-label={t("pcMoveUnitDown")}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <div className="pbc-unit-card__actions">
                    {canAssign ? (
                      <button
                        type="button"
                        className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                        onClick={() =>
                          setAssignTarget({
                            sourceType: "unit",
                            sourceId: unit.id,
                            defaultTitle: unit.title,
                            contextLabel: "unidad",
                          })
                        }
                      >
                        {t("pcAssign")}
                      </button>
                    ) : null}
                    <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={() => openEditUnit(unit)}>
                      {t("pcEdit")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-btn--danger-ghost"
                      onClick={() => void removeUnit(unit)}
                    >
                      {t("pcDelete")}
                    </button>
                  </div>
                </div>

                {(lessonsByUnit[unit.id] ?? []).length === 0 ? (
                  <div className="pbc-unit-card__empty">
                    <p className="pbc-unit-card__empty-title">{t("pcNoItemsYet")}</p>
                    <p className="pbc-unit-card__empty-text">{t("pcNoItemsYetDesc")}</p>
                  </div>
                ) : (
                  <ul className="pbc-lesson-list">
                    {(lessonsByUnit[unit.id] ?? []).map((lesson, lessonIndex) =>
                      renderItemRow({
                        lesson,
                        lessonIndex,
                        siblingCount: lessonsByUnit[unit.id]?.length ?? 0,
                        unitId: unit.id,
                        numberLabel: `${unitIndex + 1}.${lessonIndex + 1}`,
                        depth: 0,
                      }),
                    )}
                  </ul>
                )}

                <button
                  type="button"
                  className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-unit-card__add-lesson"
                  onClick={() => openCreateItem(unit.id)}
                  disabled={busy}
                >
                  <PencilIcon size={14} />
                  {t("pcNewItem")}
                </button>
              </section>
            ))}
          </div>
        )}
      </div>

      <TitleTypeDialog
        open={Boolean(titleTypeDialog)}
        dialogTitle={dialogTitle}
        submitLabel={dialogIsCreate ? t("pcCreate") : t("pcSave")}
        busyLabel={dialogIsCreate ? t("pcCreating") : t("pcSaving")}
        typeLabel={dialogIsUnit ? t("pcUnitType") : t("pcItemType")}
        typeOptions={dialogTypeOptions}
        typeI18nPrefix={dialogIsUnit ? "pcUnitType_" : "pcItemType_"}
        initialTitle={titleTypeDialog?.initialTitle ?? ""}
        initialType={titleTypeDialog?.initialType}
        onClose={closeTitleTypeDialog}
        onSubmit={submitTitleTypeDialog}
      />

      <ShareContentModal
        open={shareOpen}
        content={content}
        onClose={() => setShareOpen(false)}
        onSaved={(saved) => setContent((c) => ({ ...c, ...saved }))}
      />
      <AssignLessonModal
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        sourceType={assignTarget?.sourceType}
        sourceId={assignTarget?.sourceId}
        defaultTitle={assignTarget?.defaultTitle}
        contentTitle={content.title}
        contextLabel={assignTarget?.contextLabel}
      />
    </PyBotClassLayout>
  );
}
