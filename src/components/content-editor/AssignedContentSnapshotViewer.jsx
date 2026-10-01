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
import {
  ITEM_PROGRESS_STATUS,
  evaluateVideoPlayerCompletion,
  resolveItemCompletionRule,
  resolveVideoCompletionThreshold,
} from "../../platform/activityItemProgress.js";
import { normalizeReadOnlyFencedCode } from "./normalizeReadOnlyFencedCode.js";

function ReadOnlyDoc({ docKey, initialContent }) {
  const renderContent = useMemo(
    () => normalizeReadOnlyFencedCode(initialContent),
    [initialContent],
  );

  const editor = useCreateBlockNote(
    {
      schema: pybotContentSchema,
      initialContent: renderContent?.length ? renderContent : undefined,
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

function statusLabel(status) {
  switch (status) {
    case ITEM_PROGRESS_STATUS.COMPLETED:
      return "Completado";
    case ITEM_PROGRESS_STATUS.IN_PROGRESS:
      return "En progreso";
    default:
      return "Sin comenzar";
  }
}

function ProgressPercent({ aggregates }) {
  if (!aggregates?.trackable) return null;
  const { percent, completed, total, emptyRequired } = aggregates.content;
  return (
    <p className="auth-card__muted" style={{ margin: "0.25rem 0 0" }} aria-live="polite">
      {t("pcYourProgress")}:{" "}
      <strong>
        {emptyRequired ? "—" : `${percent}%`}
        {!emptyRequired ? ` (${completed}/${total})` : " (sin ítems requeridos)"}
      </strong>
    </p>
  );
}

function SnapshotItemCard({
  item,
  status,
  interactive,
  busyId,
  onStart,
  onComplete,
  engagement = null,
}) {
  const rule = resolveItemCompletionRule(item);
  const isDone = status === ITEM_PROGRESS_STATUS.COMPLETED;
  const isBusy = busyId === item.snapshotItemId;
  const videoUrl =
    item.type === "video"
      ? item.content?.url || item.content?.src || item.content?.videoUrl || null
      : null;

  useEffect(() => {
    if (!interactive || isDone || !onStart) return;
    // Opening may start material/example; video starts on interaction below.
    if (item.type === "material" || item.type === "example") {
      if (status === ITEM_PROGRESS_STATUS.NOT_STARTED) {
        void onStart(item);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount/open of item
  }, [item.snapshotItemId]);

  const showMarkComplete =
    interactive &&
    !isDone &&
    (rule === "marked_complete" ||
      rule === "viewed" ||
      // Embedded exercise/quiz/assignment without activity-level submit runtime
      ((item.type === "exercise" ||
        item.type === "quiz" ||
        item.type === "assignment" ||
        item.type === "assessment") &&
        rule !== "video_threshold"));

  const emitVideoState = (partial) => {
    engagement?.onVideoMediaState?.(item, partial);
  };

  return (
    <li
      className="pbc-content-reader__item-row"
      data-status={status}
      onPointerDown={() => {
        if (!engagement || !interactive) return;
        if (item.type !== "video") engagement.setItemTarget?.(item);
        else engagement.setItemTarget?.(item);
        engagement.noteInteraction?.();
      }}
    >
      <div className="pbc-content-reader__lesson-meta">
        <span className="pbc-content-reader__lesson-title">{item.title || t("pcUntitled")}</span>
        <LessonTypeBadge itemType={item.type} />
        {item.config?.required === false ? (
          <span className="pbc-content-toc__badge">Opcional</span>
        ) : null}
        <span className="pbc-pill pbc-pill--muted">{statusLabel(status)}</span>
      </div>

      {videoUrl && interactive ? (
        <div className="pbc-content-reader__item-media" style={{ marginTop: "0.5rem" }}>
          <video
            controls
            src={videoUrl}
            style={{ maxWidth: "100%", maxHeight: 320 }}
            onPlay={() => {
              // Select/prepare video target only — active time starts on onPlaying.
              if (!isDone && status === ITEM_PROGRESS_STATUS.NOT_STARTED) void onStart?.(item);
              engagement?.setItemTarget?.(item);
            }}
            onPlaying={() => {
              emitVideoState({ playing: true, waiting: false, seeking: false, ended: false, stalled: false });
            }}
            onPause={() => {
              emitVideoState({ playing: false });
            }}
            onWaiting={() => {
              emitVideoState({ playing: false, waiting: true });
            }}
            onStalled={() => {
              emitVideoState({ playing: false, stalled: true });
            }}
            onSeeking={() => {
              emitVideoState({ playing: false, seeking: true });
            }}
            onSeeked={(e) => {
              const el = e.currentTarget;
              emitVideoState({
                playing: !el.paused && !el.ended,
                seeking: false,
                ended: el.ended,
              });
            }}
            onTimeUpdate={(e) => {
              if (isDone) return;
              const el = e.currentTarget;
              if (
                evaluateVideoPlayerCompletion(item, {
                  currentTime: el.currentTime,
                  duration: el.duration,
                  ended: false,
                })
              ) {
                void onComplete?.(item, {
                  videoProgress: el.currentTime / (el.duration || 1),
                  threshold: resolveVideoCompletionThreshold(item),
                });
              }
            }}
            onEnded={() => {
              emitVideoState({ playing: false, ended: true });
              if (!isDone) {
                void onComplete?.(item, {
                  videoProgress: 1,
                  threshold: resolveVideoCompletionThreshold(item),
                  ended: true,
                });
              }
            }}
          />
        </div>
      ) : null}

      {showMarkComplete ? (
        <div style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            className="pbc-btn pbc-btn--ghost pbc-btn--sm"
            disabled={isBusy}
            onClick={() => void onComplete?.(item)}
          >
            {isBusy ? "…" : "Marcar completado"}
          </button>
        </div>
      ) : null}

      {interactive &&
      !isDone &&
      (rule === "submitted" || rule === "quiz_finished") &&
      !showMarkComplete ? (
        <p className="auth-card__muted" style={{ margin: "0.35rem 0 0", fontSize: "0.9em" }}>
          Se completa al entregar la actividad.
        </p>
      ) : null}
    </li>
  );
}

function SnapshotItemsList({
  items,
  progressByItemId,
  interactive,
  busyId,
  onStart,
  onComplete,
  engagement = null,
}) {
  if (!items?.length) return null;
  return (
    <ul className="pbc-content-reader__lesson-list" aria-label="Ítems de la lección">
      {items.map((item) => {
        const row = progressByItemId?.[item.snapshotItemId];
        const status = row?.status || ITEM_PROGRESS_STATUS.NOT_STARTED;
        return (
          <SnapshotItemCard
            key={item.snapshotItemId}
            item={item}
            status={status}
            interactive={interactive}
            busyId={busyId}
            onStart={onStart}
            onComplete={onComplete}
            engagement={engagement}
          />
        );
      })}
    </ul>
  );
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
  lessonProgress,
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
                    const lp = lessonProgress?.[lesson.id];
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
                          {lp && !lp.emptyRequired ? (
                            <span className="pbc-content-toc__mins">{lp.percent}%</span>
                          ) : null}
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

function OverviewMode({ model, onOpenLesson, aggregates }) {
  const firstLessonId = model.orderedLessons[0]?.id;

  return (
    <div className="pbc-content-reader pbc-content-reader--overview">
      <header className="pbc-content-reader__overview-head">
        {model.title ? <h2 className="pbc-content-reader__title">{model.title}</h2> : null}
        {model.description ? (
          <p className="pbc-content-reader__description">{model.description}</p>
        ) : null}
        <ProgressPercent aggregates={aggregates} />
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
        {(model.units || []).map((unit) => {
          const unitAgg = aggregates?.units?.[unit.id];
          return (
            <section key={unit.id} className="pbc-content-reader__unit">
              <div className="pbc-content-reader__unit-head">
                <h3 className="pbc-content-reader__unit-title">{unit.title || t("pcUnitFallback")}</h3>
                {unit.unitType ? (
                  <span className="pbc-content-toc__badge">{t(`pcUnitType_${unit.unitType}`)}</span>
                ) : null}
                <MinutesBadge minutes={unit.estimatedMinutes} />
                {unitAgg && !unitAgg.emptyRequired ? (
                  <span className="pbc-pill pbc-pill--muted">{unitAgg.percent}%</span>
                ) : null}
              </div>
              {unit.description ? (
                <p className="pbc-content-reader__unit-desc">{unit.description}</p>
              ) : null}
              <ul className="pbc-content-reader__lesson-list">
                {(unit.lessons || []).map((lesson) => {
                  const lp = aggregates?.lessons?.[lesson.id];
                  return (
                    <li key={lesson.id} className="pbc-content-reader__lesson-row">
                      <div className="pbc-content-reader__lesson-meta">
                        <span className="pbc-content-reader__lesson-title">
                          {lesson.title || t("pcUntitled")}
                        </span>
                        <LessonTypeBadge itemType={lesson.itemType} />
                        <MinutesBadge minutes={lesson.estimatedMinutes} />
                        {lp && !lp.emptyRequired ? (
                          <span className="pbc-pill pbc-pill--muted">{lp.percent}%</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="pbc-btn pbc-btn--ghost pbc-content-reader__open-btn"
                        onClick={() => onOpenLesson(lesson.id)}
                      >
                        {t("pcOpen")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LessonMode({
  model,
  selectedLessonId,
  onSelectLesson,
  onBack,
  learningObjectives,
  aggregates,
  progressByItemId,
  interactive,
  busyId,
  onStart,
  onComplete,
  engagement = null,
}) {
  const [indexOpen, setIndexOpen] = useState(false);
  const index = findLessonIndex(model.orderedLessons, selectedLessonId);
  const lesson = index >= 0 ? model.orderedLessons[index] : null;

  useEffect(() => {
    if (!engagement || !lesson) return undefined;
    engagement.setLessonDocument?.({
      id: lesson.id,
      unitId: lesson.unitId || null,
    });
    return () => {
      engagement.leaveTarget?.();
    };
  }, [engagement, lesson?.id, lesson?.unitId]);

  if (!lesson) return null;

  const total = model.orderedLessons.length;
  const positionLabel = t("pcLessonPosition")
    .replace("{n}", String(index + 1))
    .replace("{total}", String(total));
  const prev = index > 0 ? model.orderedLessons[index - 1] : null;
  const next = index < total - 1 ? model.orderedLessons[index + 1] : null;
  const lessonAgg = aggregates?.lessons?.[lesson.id];

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
            {lessonAgg && !lessonAgg.emptyRequired ? (
              <p className="auth-card__muted" style={{ margin: 0 }}>
                Lección: {lessonAgg.percent}%
              </p>
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
          lessonProgress={aggregates?.lessons}
        />

        <article className="pbc-content-reader__article" aria-labelledby="pbc-reader-lesson-title">
          <LearningObjectives objectives={learningObjectives} />

          <div
            className="pbc-lesson-workspace pbc-lesson-workspace--preview"
            onPointerDown={() => {
              if (!engagement) return;
              engagement.activateLessonDocument?.();
            }}
          >
            <ReadOnlyDoc docKey={lesson.id} initialContent={lesson.document_json} />
          </div>

          <SnapshotItemsList
            items={lesson.items}
            progressByItemId={progressByItemId}
            interactive={interactive}
            busyId={busyId}
            onStart={onStart}
            onComplete={onComplete}
            engagement={engagement}
          />

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

function ProgressiveMultiLessonReader({
  snapshot,
  aggregates,
  progressByItemId,
  interactive,
  busyId,
  onStart,
  onComplete,
  engagement = null,
}) {
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
    return (
      <OverviewMode model={model} onOpenLesson={setSelectedLessonId} aggregates={aggregates} />
    );
  }

  return (
    <LessonMode
      model={model}
      selectedLessonId={selectedLessonId}
      onSelectLesson={setSelectedLessonId}
      onBack={() => setSelectedLessonId(null)}
      learningObjectives={learningObjectives}
      aggregates={aggregates}
      progressByItemId={progressByItemId}
      interactive={interactive}
      busyId={busyId}
      onStart={onStart}
      onComplete={onComplete}
      engagement={engagement}
    />
  );
}

/**
 * Viewer de snapshot inmutable para actividades y contenido compartido.
 * For sourceType="content" and sourceType="unit", default view does not render all lesson documents
 * (progressive overview + one lesson at a time).
 * Single lesson/exercise/task: direct render (no forced overview).
 * Optional progress props integrate Point 4 without a parallel app.
 * Optional engagement prop integrates Point 5 active-time without mutating progress.
 */
export default function AssignedContentSnapshotViewer({
  snapshot,
  aggregates = null,
  progressByItemId = null,
  interactive = false,
  busyId = null,
  onStartItem = null,
  onCompleteItem = null,
  engagement = null,
}) {
  if (!snapshot) return null;

  const type = snapshot.sourceType;
  const progressMap = progressByItemId || {};
  const surfaceProps = engagement?.setSurfaceRef
    ? { ref: engagement.setSurfaceRef }
    : {};

  if (type === "exercise" || type === "task") {
    return (
      <ExerciseTaskSurface
        type={type}
        snapshot={snapshot}
        engagement={engagement}
        surfaceProps={surfaceProps}
      />
    );
  }

  if (type === "lesson") {
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    return (
      <LessonDocumentSurface
        snapshot={snapshot}
        items={items}
        aggregates={aggregates}
        progressMap={progressMap}
        interactive={interactive}
        busyId={busyId}
        onStartItem={onStartItem}
        onCompleteItem={onCompleteItem}
        engagement={engagement}
        surfaceProps={surfaceProps}
      />
    );
  }

  // For sourceType="content" and sourceType="unit": progressive reader (no endless dump).
  if (type === "unit" || type === "content") {
    return (
      <div className="pbc-assigned-lesson" {...surfaceProps}>
        <ProgressiveMultiLessonReader
          snapshot={snapshot}
          aggregates={aggregates}
          progressByItemId={progressMap}
          interactive={interactive}
          busyId={busyId}
          onStart={onStartItem}
          onComplete={onCompleteItem}
          engagement={engagement}
        />
      </div>
    );
  }

  return <p className="auth-card__muted">{t("pcNoContentToShow")}</p>;
}

function LessonDocumentSurface({
  snapshot,
  items,
  aggregates,
  progressMap,
  interactive,
  busyId,
  onStartItem,
  onCompleteItem,
  engagement,
  surfaceProps,
}) {
  useEffect(() => {
    if (!engagement) return undefined;
    engagement.setLessonDocument?.({
      id: snapshot.sourceId,
      unitId: snapshot.unitId || null,
    });
    return () => engagement.leaveTarget?.();
  }, [engagement, snapshot.sourceId, snapshot.unitId]);

  return (
    <div className="pbc-lesson-workspace pbc-lesson-workspace--preview pbc-assigned-lesson" {...surfaceProps}>
      <ProgressPercent aggregates={aggregates} />
      <div
        onPointerDown={() => {
          if (!engagement) return;
          engagement.activateLessonDocument?.();
        }}
      >
        <ReadOnlyDoc docKey={snapshot.sourceId} initialContent={snapshot.document_json} />
      </div>
      <SnapshotItemsList
        items={items}
        progressByItemId={progressMap}
        interactive={interactive}
        busyId={busyId}
        onStart={onStartItem}
        onComplete={onCompleteItem}
        engagement={engagement}
      />
    </div>
  );
}

function ExerciseTaskSurface({ type, snapshot, engagement, surfaceProps }) {
  useEffect(() => {
    if (!engagement) return undefined;
    // Standalone assigned exercise/task: treat card view as interacted element target
    engagement.setItemTarget?.({
      snapshotItemId: String(snapshot.sourceId || snapshot.contentId || "exercise"),
      type,
      lessonId: snapshot.lessonId || snapshot.sourceId || null,
      unitId: null,
    });
    return () => engagement.leaveTarget?.();
  }, [engagement, snapshot.sourceId, snapshot.contentId, snapshot.lessonId, type]);

  return (
    <div className="pbc-assigned-lesson" {...surfaceProps}>
      <BlockCard kind={type} block={snapshot.block || snapshot} />
    </div>
  );
}
