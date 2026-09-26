import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { t } from "../../i18n.js";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/lesson-blocknote.css";
import { isSafeLessonLink, resolveContentMediaUrl } from "./contentMedia.js";
import { pybotContentSchema, pybotDictionary } from "./pybotContentSchema.jsx";
import {
  buildSnapshotReaderModel,
  findLessonIndex,
} from "../../platform/contentSnapshotReader.js";

function ReadOnlyDoc({ docKey, initialContent }) {
  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent: initialContent?.length ? initialContent : undefined,
      dictionary: pybotDictionary,
      trailingBlock: false,
      animations: false,
      links: { isValidLink: isSafeLessonLink },
      resolveFileUrl: resolveContentMediaUrl,
    },
    [docKey],
  );

  return (
    <div className="pbc-lesson-doc pbc-lesson-doc--preview">
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={false}
        slashMenu={false}
        emojiPicker={false}
        comments={false}
        formattingToolbar={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        linkToolbar={false}
        className="pbc-bn"
      />
    </div>
  );
}

function BlockCard({ kind, block }) {
  const title = block?.title || (kind === "exercise" ? "Ejercicio" : "Tarea");
  return (
    <div className={`pbc-pybot-card pbc-pybot-card--${kind === "exercise" ? "exercise" : "task"}`}>
      <div className="pbc-pybot-card__head">
        <strong>{title}</strong>
        <span className="pbc-pybot-card__kind">
          {kind === "exercise" ? "Actividad de programación" : "Tarea"}
        </span>
      </div>
      {block?.instructions ? (
        <div className="pbc-pybot-card__section">
          <div className="pbc-pybot-card__label">{t("pcInstructions")}</div>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{block.instructions}</p>
        </div>
      ) : null}
      {block?.starterCode != null && String(block.starterCode).length > 0 ? (
        <div className="pbc-pybot-card__section">
          <div className="pbc-pybot-card__label">{t("pcStarterCode")}</div>
          <pre className="pbc-pybot-card__code">{block.starterCode}</pre>
        </div>
      ) : null}
    </div>
  );
}

function LessonTypeBadge({ itemType }) {
  const key = `pcItemType_${itemType || "lesson"}`;
  return <span className="pbc-content-toc__badge">{t(key)}</span>;
}

function MinutesBadge({ minutes }) {
  if (minutes == null || minutes === "") return null;
  return <span className="pbc-content-toc__mins">{minutes}′</span>;
}

/** Real learning objectives only — never invent placeholders. */
function resolveLearningObjectives(snapshot) {
  const raw =
    snapshot?.contentMeta?.learning_objectives ??
    snapshot?.learning_objectives ??
    null;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function LearningObjectives({ objectives }) {
  const [open, setOpen] = useState(false);
  if (!objectives?.length) return null;

  return (
    <aside className="pbc-content-reader__objectives" aria-label={t("pcMetaObjectives")}>
      <button
        type="button"
        className="pbc-content-reader__objectives-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t("pcInThisLessonLearn")}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ul className="pbc-content-reader__objectives-list">
          {objectives.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function ReaderOutline({
  units,
  selectedLessonId,
  onSelectLesson,
  open,
  onClose,
  onBackToOverview,
  overviewTitle,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && panelRef.current) {
      const focusable = panelRef.current.querySelector("button, [href], [tabindex]:not([tabindex='-1'])");
      focusable?.focus?.();
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="pbc-content-reader__index-backdrop"
        aria-label={t("pcClose")}
        onClick={onClose}
      />
      <nav
        ref={panelRef}
        id="pbc-reader-index-panel"
        className="pbc-content-reader__nav pbc-content-reader__nav--drawer"
        aria-label={t("pcReaderOutline")}
      >
        <div className="pbc-content-reader__nav-head">
          <strong>{t("pcTocTitle")}</strong>
          <button type="button" className="pbc-content-reader__nav-close" onClick={onClose}>
            {t("pcClose")}
          </button>
        </div>
        {onBackToOverview ? (
          <button
            type="button"
            className="pbc-content-reader__back"
            onClick={() => {
              onBackToOverview();
              onClose?.();
            }}
          >
            {overviewTitle || t("pcReaderOutline")}
          </button>
        ) : null}
        <ol className="pbc-content-reader__outline-list">
          {(units || []).map((unit) => (
            <li key={unit.id} className="pbc-content-reader__outline-unit">
              <div className="pbc-content-reader__outline-unit-title">
                <span>{unit.title || t("pcUnitFallback")}</span>
                {unit.unitType ? (
                  <span className="pbc-content-toc__badge">{t(`pcUnitType_${unit.unitType}`)}</span>
                ) : null}
                <MinutesBadge minutes={unit.estimatedMinutes} />
              </div>
              {unit.lessons?.length ? (
                <ol className="pbc-content-reader__outline-lessons">
                  {unit.lessons.map((lesson) => {
                    const isCurrent = lesson.id === selectedLessonId;
                    const title = lesson.title || t("pcUntitled");
                    return (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          className={
                            isCurrent
                              ? "pbc-content-reader__outline-link pbc-content-reader__outline-link--current"
                              : "pbc-content-reader__outline-link"
                          }
                          aria-current={isCurrent ? "true" : undefined}
                          title={title}
                          onClick={() => {
                            onSelectLesson(lesson.id);
                            onClose?.();
                          }}
                        >
                          <span className="pbc-content-reader__outline-lesson-title">{title}</span>
                          <LessonTypeBadge itemType={lesson.itemType} />
                          <MinutesBadge minutes={lesson.estimatedMinutes} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}

function OverviewMode({ model, onOpenLesson }) {
  const firstLessonId = model.orderedLessons[0]?.id;

  return (
    <div className="pbc-content-reader pbc-content-reader--overview">
      <header className="pbc-content-reader__overview-head">
        {model.title ? <h2 className="pbc-content-reader__title">{model.title}</h2> : null}
        {model.description ? (
          <p className="pbc-content-reader__description">{model.description}</p>
        ) : null}
        {firstLessonId ? (
          <button
            type="button"
            className="pbc-btn pbc-btn--primary"
            onClick={() => onOpenLesson(firstLessonId)}
          >
            {t("pcStartLesson")}
          </button>
        ) : null}
      </header>

      <div className="pbc-content-reader__structure" aria-label={t("pcReaderOutline")}>
        {(model.units || []).map((unit) => (
          <section key={unit.id} className="pbc-content-reader__unit">
            <div className="pbc-content-reader__unit-head">
              <h3 className="pbc-content-reader__unit-title">{unit.title || t("pcUnitFallback")}</h3>
              {unit.unitType ? (
                <span className="pbc-content-toc__badge">{t(`pcUnitType_${unit.unitType}`)}</span>
              ) : null}
              <MinutesBadge minutes={unit.estimatedMinutes} />
            </div>
            {unit.description ? (
              <p className="pbc-content-reader__unit-desc">{unit.description}</p>
            ) : null}
            <ul className="pbc-content-reader__lesson-list">
              {(unit.lessons || []).map((lesson) => (
                <li key={lesson.id} className="pbc-content-reader__lesson-row">
                  <div className="pbc-content-reader__lesson-meta">
                    <span className="pbc-content-reader__lesson-title">
                      {lesson.title || t("pcUntitled")}
                    </span>
                    <LessonTypeBadge itemType={lesson.itemType} />
                    <MinutesBadge minutes={lesson.estimatedMinutes} />
                  </div>
                  <button
                    type="button"
                    className="pbc-btn pbc-btn--ghost pbc-content-reader__open-btn"
                    onClick={() => onOpenLesson(lesson.id)}
                  >
                    {t("pcOpen")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function LessonMode({ model, selectedLessonId, onSelectLesson, onBack, learningObjectives }) {
  const [indexOpen, setIndexOpen] = useState(false);
  const index = findLessonIndex(model.orderedLessons, selectedLessonId);
  const lesson = index >= 0 ? model.orderedLessons[index] : null;
  if (!lesson) return null;

  const total = model.orderedLessons.length;
  const positionLabel = t("pcLessonPosition")
    .replace("{n}", String(index + 1))
    .replace("{total}", String(total));
  const prev = index > 0 ? model.orderedLessons[index - 1] : null;
  const next = index < total - 1 ? model.orderedLessons[index + 1] : null;

  return (
    <div className="pbc-content-reader pbc-content-reader--lesson">
      <header className="pbc-content-reader__header">
        <div className="pbc-content-reader__header-row">
          <button
            type="button"
            className="pbc-content-reader__nav-toggle"
            aria-expanded={indexOpen}
            aria-controls="pbc-reader-index-panel"
            onClick={() => setIndexOpen((v) => !v)}
          >
            {t("pcViewStructure")}
          </button>
          <div className="pbc-content-reader__header-meta">
            <p className="pbc-content-reader__position" aria-live="polite">
              {positionLabel}
            </p>
            {lesson.unitTitle ? (
              <p className="pbc-content-reader__context-unit">{lesson.unitTitle}</p>
            ) : null}
          </div>
        </div>
        <h2 id="pbc-reader-lesson-title" className="pbc-content-reader__lesson-heading">
          {lesson.title || t("pcUntitled")}
        </h2>
      </header>

      <div className="pbc-content-reader__layout">
        <ReaderOutline
          units={model.units}
          selectedLessonId={lesson.id}
          onSelectLesson={onSelectLesson}
          open={indexOpen}
          onClose={() => setIndexOpen(false)}
          onBackToOverview={onBack}
          overviewTitle={model.title}
        />

        <article className="pbc-content-reader__article" aria-labelledby="pbc-reader-lesson-title">
          <LearningObjectives objectives={learningObjectives} />

          <div className="pbc-lesson-workspace pbc-lesson-workspace--preview">
            <ReadOnlyDoc docKey={lesson.id} initialContent={lesson.document_json} />
          </div>

          <div className="pbc-content-reader__pager">
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost"
              disabled={!prev}
              aria-label={t("pcPrevious")}
              onClick={() => prev && onSelectLesson(prev.id)}
            >
              {t("pcPrevious")}
            </button>
            <button
              type="button"
              className="pbc-btn pbc-btn--primary"
              disabled={!next}
              aria-label={t("pcNext")}
              onClick={() => next && onSelectLesson(next.id)}
            >
              {t("pcNext")}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

function ProgressiveMultiLessonReader({ snapshot }) {
  const model = useMemo(() => buildSnapshotReaderModel(snapshot), [snapshot]);
  const learningObjectives = useMemo(() => resolveLearningObjectives(snapshot), [snapshot]);
  const [selectedLessonId, setSelectedLessonId] = useState(null);

  useEffect(() => {
    setSelectedLessonId(null);
  }, [snapshot?.sourceId, snapshot?.sourceType]);

  if (!model || model.mode !== "multi") return null;

  if (!model.orderedLessons.length) {
    return <p className="auth-card__muted">{t("pcNoContentToShow")}</p>;
  }

  if (!selectedLessonId) {
    return <OverviewMode model={model} onOpenLesson={setSelectedLessonId} />;
  }

  return (
    <LessonMode
      model={model}
      selectedLessonId={selectedLessonId}
      onSelectLesson={setSelectedLessonId}
      onBack={() => setSelectedLessonId(null)}
      learningObjectives={learningObjectives}
    />
  );
}

/**
 * Viewer de snapshot inmutable para actividades y contenido compartido.
 * For sourceType="content" and sourceType="unit", default view does not render all lesson documents
 * (progressive overview + one lesson at a time).
 * Single lesson/exercise/task: direct render (no forced overview).
 */
export default function AssignedContentSnapshotViewer({ snapshot }) {
  if (!snapshot) return null;

  const type = snapshot.sourceType;

  if (type === "exercise" || type === "task") {
    return (
      <div className="pbc-assigned-lesson">
        <BlockCard kind={type} block={snapshot.block || snapshot} />
      </div>
    );
  }

  if (type === "lesson") {
    return (
      <div className="pbc-lesson-workspace pbc-lesson-workspace--preview pbc-assigned-lesson">
        <ReadOnlyDoc docKey={snapshot.sourceId} initialContent={snapshot.document_json} />
      </div>
    );
  }

  // For sourceType="content" and sourceType="unit": progressive reader (no endless dump).
  if (type === "unit" || type === "content") {
    return (
      <div className="pbc-assigned-lesson">
        <ProgressiveMultiLessonReader snapshot={snapshot} />
      </div>
    );
  }

  return <p className="auth-card__muted">{t("pcNoContentToShow")}</p>;
}
