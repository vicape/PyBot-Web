import { useCallback, useEffect, useMemo, useState } from "react";
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
  LESSON_ITEM_CREATE_TYPES,
  itemTypeOptionsForEdit,
  createContentUnit,
  createLesson,
  createContentItem,
  deleteContentUnit,
  deleteLesson,
  deleteContentItem,
  getContent,
  listContentUnits,
  listLessonItems,
  listUnitLessons,
  moveContentUnit,
  moveLesson,
  moveContentItem,
  updateContentUnit,
  updateLesson,
  updateContentItem,
  duplicateContentUnit,
  duplicateLesson,
  duplicateContentItem,
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
    case "example":
      return <PencilIcon size={size} />;
    case "quiz":
    case "assessment":
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

function CompactMenu({ label, disabled, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pbc-compact-menu">
      <button
        type="button"
        className="pbc-btn pbc-btn--ghost pbc-btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label || "⋯"}
      </button>
      {open ? (
        <div className="pbc-compact-menu__panel" role="menu" onMouseLeave={() => setOpen(false)}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  );
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
  const [expandedUnits, setExpandedUnits] = useState({});
  const [expandedLessons, setExpandedLessons] = useState({});
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
    const nextExpandedUnits = {};
    const nextExpandedLessons = {};
    await Promise.all(
      unitRows.map(async (unit) => {
        const { rows } = await listUnitLessons(unit.id);
        lessonMap[unit.id] = rows;
        nextExpandedUnits[unit.id] = true;
        await Promise.all(
          rows.map(async (lesson) => {
            nextExpandedLessons[lesson.id] = true;
            const { rows: children, error: childErr } = await listLessonItems(lesson.id);
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
    setExpandedUnits((prev) => ({ ...nextExpandedUnits, ...prev }));
    setExpandedLessons((prev) => ({ ...nextExpandedLessons, ...prev }));
    setLoading(false);
  }, [user, contentId, navigate, supabase]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const allUnitIds = useMemo(() => units.map((u) => u.id), [units]);
  const allLessonIds = useMemo(
    () => Object.values(lessonsByUnit).flat().map((l) => l.id),
    [lessonsByUnit],
  );

  const expandAll = () => {
    setExpandedUnits(Object.fromEntries(allUnitIds.map((id) => [id, true])));
    setExpandedLessons(Object.fromEntries(allLessonIds.map((id) => [id, true])));
  };

  const collapseAll = () => {
    setExpandedUnits(Object.fromEntries(allUnitIds.map((id) => [id, false])));
    setExpandedLessons(Object.fromEntries(allLessonIds.map((id) => [id, false])));
  };

  const toggleUnit = (unitId) => {
    setExpandedUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }));
  };

  const toggleLesson = (lessonId) => {
    setExpandedLessons((prev) => ({ ...prev, [lessonId]: !prev[lessonId] }));
  };

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

  const openCreateLesson = (unitId) => {
    if (busy) return;
    setTitleTypeDialog({
      kind: "lesson",
      mode: "create",
      unitId,
      initialTitle: "",
      initialType: "lesson",
      typeOptions: ["lesson"],
    });
  };

  const openEditLesson = (lesson) => {
    setTitleTypeDialog({
      kind: "lesson",
      mode: "edit",
      target: lesson,
      initialTitle: lesson.title || "",
      initialType: "lesson",
      typeOptions: ["lesson"],
    });
  };

  const openCreateItem = (lesson) => {
    if (busy) return;
    setTitleTypeDialog({
      kind: "item",
      mode: "create",
      lessonId: lesson.id,
      initialTitle: "",
      initialType: "material",
      typeOptions: [...LESSON_ITEM_CREATE_TYPES],
    });
  };

  const openEditItem = (item) => {
    setTitleTypeDialog({
      kind: "item",
      mode: "edit",
      target: item,
      initialTitle: item.title || "",
      initialType: item.type || item.item_type || "material",
      typeOptions: itemTypeOptionsForEdit({ itemType: item.type || item.item_type }),
    });
  };

  const closeTitleTypeDialog = () => setTitleTypeDialog(null);

  const submitTitleTypeDialog = async ({ title, type }) => {
    if (!titleTypeDialog) return { error: t("pcUnexpectedError") };
    const { kind, mode, target, unitId, lessonId } = titleTypeDialog;

    if (kind === "unit" && mode === "create") {
      setBusy(true);
      const { unit, error } = await createContentUnit(contentId, {
        title,
        unitType: type,
      });
      setBusy(false);
      if (error || !unit) return { error: error || "No se pudo crear la unidad." };
      void load();
      return {};
    }

    if (kind === "unit" && mode === "edit") {
      const unit = target;
      const prevType = unit.unit_type || "unit";
      if (title === unit.title && type === prevType) return {};
      setBusy(true);
      const { error } = await updateContentUnit(unit.id, { title, unitType: type });
      setBusy(false);
      if (error) return { error };
      void load();
      return {};
    }

    if (kind === "lesson" && mode === "create") {
      setBusy(true);
      const { lesson, error } = await createLesson(unitId, { title });
      setBusy(false);
      if (error || !lesson) return { error: error || "No se pudo crear la lección." };
      void load();
      return {};
    }

    if (kind === "lesson" && mode === "edit") {
      if (title === target.title) return {};
      setBusy(true);
      const { error } = await updateLesson(target.id, { title });
      setBusy(false);
      if (error) return { error };
      void load();
      return {};
    }

    if (kind === "item" && mode === "create") {
      setBusy(true);
      const { item, error } = await createContentItem(lessonId, { title, type });
      setBusy(false);
      if (error || !item) return { error: error || "No se pudo crear el ítem." };
      navigate(`/dashboard/content/${contentId}/lessons/${item.id}`);
      return {};
    }

    if (kind === "item" && mode === "edit") {
      const prevType = target.type || target.item_type || "material";
      if (title === target.title && type === prevType) return {};
      setBusy(true);
      const { error } = await updateContentItem(target.id, { title, type });
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
    const count = itemsByLesson[lesson.id]?.length ?? 0;
    const msg =
      count > 0
        ? t("pcDeleteLessonWithChildren").replace("{title}", lesson.title)
        : `¿Eliminar «${lesson.title}»?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    const { error } = await deleteLesson(lesson.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const removeItem = async (item) => {
    if (!window.confirm(`¿Eliminar «${item.title}»?`)) return;
    setBusy(true);
    const { error } = await deleteContentItem(item.id);
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

  const moveItemRow = async (itemId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveContentItem(itemId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const handleDuplicateUnit = async (unit) => {
    if (busy) return;
    setBusy(true);
    const { error } = await duplicateContentUnit(unit.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const handleDuplicateLesson = async (lesson) => {
    if (busy) return;
    setBusy(true);
    const { error } = await duplicateLesson(lesson.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const handleDuplicateItem = async (item) => {
    if (busy) return;
    setBusy(true);
    const { error } = await duplicateContentItem(item.id);
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
    if (entry.type === "lesson") {
      const el = document.getElementById(`lesson-${entry.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (entry.type === "item") {
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
  const dialogIsLesson = titleTypeDialog?.kind === "lesson";
  const dialogIsCreate = titleTypeDialog?.mode === "create";
  const dialogTypeOptions = dialogIsUnit
    ? UNIT_TYPES
    : dialogIsLesson
      ? ["lesson"]
      : titleTypeDialog?.typeOptions || [...LESSON_ITEM_CREATE_TYPES];
  const dialogTitle = dialogIsCreate
    ? dialogIsUnit
      ? t("pcNewUnit")
      : dialogIsLesson
        ? t("pcNewLesson")
        : t("pcNewItem")
    : t("pcEdit");
  const typeI18nPrefix = dialogIsUnit ? "pcUnitType_" : dialogIsLesson ? "pcItemType_" : "pcItemType_";

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
          <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={expandAll} disabled={busy}>
            {t("pcExpandAll")}
          </button>
          <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={collapseAll} disabled={busy}>
            {t("pcCollapseAll")}
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
          <div className="pbc-structure-tree">
            {units.map((unit, unitIndex) => {
              const unitOpen = expandedUnits[unit.id] !== false;
              const lessons = lessonsByUnit[unit.id] ?? [];
              return (
                <section key={unit.id} id={`unit-${unit.id}`} className="pbc-structure-unit">
                  <div className="pbc-structure-row pbc-structure-row--unit">
                    <button
                      type="button"
                      className="pbc-structure-toggle"
                      aria-expanded={unitOpen}
                      onClick={() => toggleUnit(unit.id)}
                    >
                      {unitOpen ? "▾" : "▸"}
                    </button>
                    <span className="pbc-structure-row__title">
                      <span className="pbc-type-badge">{t(`pcUnitType_${unit.unit_type || "unit"}`)}</span>{" "}
                      {unitIndex + 1} — {unit.title}
                    </span>
                    <div className="pbc-structure-row__actions">
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
                      <CompactMenu disabled={busy}>
                        {(close) => (
                          <>
                            <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); openEditUnit(unit); }}>
                              {t("pcEdit")}
                            </button>
                            <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); void handleDuplicateUnit(unit); }}>
                              {t("pcDuplicate")}
                            </button>
                            {canAssign ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="pbc-compact-menu__item"
                                onClick={() => {
                                  close();
                                  setAssignTarget({
                                    sourceType: "unit",
                                    sourceId: unit.id,
                                    defaultTitle: unit.title,
                                    contextLabel: "unidad",
                                  });
                                }}
                              >
                                {t("pcAssign")}
                              </button>
                            ) : null}
                            <button type="button" role="menuitem" className="pbc-compact-menu__item pbc-compact-menu__item--danger" onClick={() => { close(); void removeUnit(unit); }}>
                              {t("pcDelete")}
                            </button>
                          </>
                        )}
                      </CompactMenu>
                    </div>
                  </div>

                  {unitOpen ? (
                    <div className="pbc-structure-children">
                      {lessons.length === 0 ? (
                        <p className="pbc-structure-empty">{t("pcNoLessonsYet")}</p>
                      ) : (
                        lessons.map((lesson, lessonIndex) => {
                          const lessonOpen = expandedLessons[lesson.id] !== false;
                          const items = itemsByLesson[lesson.id] ?? [];
                          return (
                            <div key={lesson.id} id={`lesson-${lesson.id}`} className="pbc-structure-lesson">
                              <div className="pbc-structure-row pbc-structure-row--lesson">
                                <button
                                  type="button"
                                  className="pbc-structure-toggle"
                                  aria-expanded={lessonOpen}
                                  onClick={() => toggleLesson(lesson.id)}
                                >
                                  {lessonOpen ? "▾" : "▸"}
                                </button>
                                <span className="pbc-structure-row__title">
                                  <span className="pbc-type-badge">{t("pcItemType_lesson")}</span>{" "}
                                  {unitIndex + 1}.{lessonIndex + 1} — {lesson.title}
                                </span>
                                <div className="pbc-structure-row__actions">
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
                                      disabled={busy || lessonIndex === lessons.length - 1}
                                      aria-label={t("pcMoveItemDown")}
                                    >
                                      ↓
                                    </button>
                                  </div>
                                  <CompactMenu disabled={busy}>
                                    {(close) => (
                                      <>
                                        <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); openEditLesson(lesson); }}>
                                          {t("pcEdit")}
                                        </button>
                                        <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); void handleDuplicateLesson(lesson); }}>
                                          {t("pcDuplicate")}
                                        </button>
                                        {canAssign ? (
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="pbc-compact-menu__item"
                                            onClick={() => {
                                              close();
                                              setAssignTarget({
                                                sourceType: "lesson",
                                                sourceId: lesson.id,
                                                defaultTitle: lesson.title,
                                                contextLabel: "lección",
                                              });
                                            }}
                                          >
                                            {t("pcAssign")}
                                          </button>
                                        ) : null}
                                        <button type="button" role="menuitem" className="pbc-compact-menu__item pbc-compact-menu__item--danger" onClick={() => { close(); void removeLesson(lesson); }}>
                                          {t("pcDelete")}
                                        </button>
                                      </>
                                    )}
                                  </CompactMenu>
                                </div>
                              </div>

                              {lessonOpen ? (
                                <ul className="pbc-structure-items">
                                  {items.map((item, itemIndex) => {
                                    const itemType = item.type || item.item_type || "material";
                                    return (
                                      <li key={item.id} id={`item-${item.id}`} className="pbc-structure-row pbc-structure-row--item">
                                        <span className="pbc-structure-toggle pbc-structure-toggle--leaf" aria-hidden>
                                          └
                                        </span>
                                        <Link
                                          to={`/dashboard/content/${contentId}/lessons/${item.id}`}
                                          className="pbc-structure-row__main"
                                        >
                                          <span className="pbc-structure-row__icon" aria-hidden>
                                            <ItemTypeIcon itemType={itemType} size={16} />
                                          </span>
                                          <span className="pbc-structure-row__title">
                                            <span className="pbc-type-badge">{t(`pcItemType_${itemType}`)}</span>{" "}
                                            {item.title}
                                          </span>
                                        </Link>
                                        <div className="pbc-structure-row__actions">
                                          <div className="pbc-order-btns">
                                            <button
                                              type="button"
                                              className="pbc-order-btn"
                                              onClick={() => void moveItemRow(item.id, "up")}
                                              disabled={busy || itemIndex === 0}
                                              aria-label={t("pcMoveItemUp")}
                                            >
                                              ↑
                                            </button>
                                            <button
                                              type="button"
                                              className="pbc-order-btn"
                                              onClick={() => void moveItemRow(item.id, "down")}
                                              disabled={busy || itemIndex === items.length - 1}
                                              aria-label={t("pcMoveItemDown")}
                                            >
                                              ↓
                                            </button>
                                          </div>
                                          <CompactMenu disabled={busy}>
                                            {(close) => (
                                              <>
                                                <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); openEditItem(item); }}>
                                                  {t("pcEdit")}
                                                </button>
                                                <button type="button" role="menuitem" className="pbc-compact-menu__item" onClick={() => { close(); void handleDuplicateItem(item); }}>
                                                  {t("pcDuplicate")}
                                                </button>
                                                <button type="button" role="menuitem" className="pbc-compact-menu__item pbc-compact-menu__item--danger" onClick={() => { close(); void removeItem(item); }}>
                                                  {t("pcDelete")}
                                                </button>
                                              </>
                                            )}
                                          </CompactMenu>
                                        </div>
                                      </li>
                                    );
                                  })}
                                  <li className="pbc-structure-add">
                                    <button
                                      type="button"
                                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                                      onClick={() => openCreateItem(lesson)}
                                      disabled={busy}
                                    >
                                      + {t("pcAddToLesson")}
                                    </button>
                                  </li>
                                </ul>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                      <button
                        type="button"
                        className="pbc-btn pbc-btn--primary pbc-btn--sm"
                        onClick={() => openCreateLesson(unit.id)}
                        disabled={busy}
                      >
                        + {t("pcNewLesson")}
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })}
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
        typeI18nPrefix={typeI18nPrefix}
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
