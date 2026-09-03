import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import LessonBlockNoteEditor from "../components/content-editor/LessonBlockNoteEditor.jsx";
import LessonDocIllustration from "../components/content-editor/LessonDocIllustration.jsx";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";
import {
  hasSavedLessonDocument,
  legacyBlocksToDocument,
  normalizeLessonDocument,
} from "../components/content-editor/legacyLessonDocument.js";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  getContent,
  getLesson,
  listLessonBlocks,
  saveLessonDocument,
  updateLesson,
} from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

const TITLE_SAVE_MS = 1000;

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
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

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AssignIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="9" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19 8v6M16 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SaveStatus({ status, onRetry }) {
  if (status === "saving") {
    return (
      <span className="pbc-lesson-save" aria-live="polite">
        Guardando...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="pbc-lesson-save pbc-lesson-save--ok" aria-live="polite">
        <CheckIcon />
        Guardado
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="pbc-lesson-save pbc-lesson-save--err" role="alert">
        No se pudo guardar
        <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={onRetry}>
          Reintentar
        </button>
      </span>
    );
  }
  return <span className="pbc-lesson-save" aria-live="polite" />;
}

export default function LessonEditorPage() {
  const { contentId, lessonId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/content/${contentId}/lessons/${lessonId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [content, setContent] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [editorSeed, setEditorSeed] = useState(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [assignOpen, setAssignOpen] = useState(false);

  const editorRef = useRef(null);
  const titleInputRef = useRef(null);
  const titleTimerRef = useRef(null);
  const titleDirtyRef = useRef(false);
  const lastSavedTitleRef = useRef("");
  const titleValueRef = useRef("");
  titleValueRef.current = title;

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const persistTitle = useCallback(
    async (nextTitle) => {
      const trimmed = String(nextTitle ?? "").trim();
      if (!trimmed || trimmed === lastSavedTitleRef.current) {
        titleDirtyRef.current = false;
        return true;
      }
      const { error } = await updateLesson(lessonId, { title: trimmed });
      if (error) {
        setSaveStatus("error");
        return false;
      }
      lastSavedTitleRef.current = trimmed;
      titleDirtyRef.current = false;
      setLesson((prev) => (prev ? { ...prev, title: trimmed } : prev));
      return true;
    },
    [lessonId],
  );

  const load = useCallback(async () => {
    if (!user || !contentId || !lessonId) return;
    setLoading(true);
    setErr("");
    setPreview(false);
    setEditorSeed(null);

    const [{ content: c, error: cErr }, { lesson: l, error: lErr }, { profile }] = await Promise.all([
      getContent(contentId),
      getLesson(lessonId),
      fetchProfile(user.id),
    ]);

    setSuperAdmin(isSuperAdmin(profile));

    if (cErr || !c || lErr || !l) {
      setErr(cErr || lErr || "Lección no encontrada.");
      setLoading(false);
      return;
    }

    let documentJson = l.document_json;
    let documentVersion = l.document_version ?? 1;

    if (!hasSavedLessonDocument(documentJson)) {
      const { rows } = await listLessonBlocks(lessonId);
      if (rows.length > 0) {
        documentJson = legacyBlocksToDocument(rows);
        const { lesson: saved, error: saveErr } = await saveLessonDocument(
          lessonId,
          documentJson,
          documentVersion,
        );
        if (saveErr) {
          setErr("Se pudo abrir el contenido anterior, pero no se guardó el documento nuevo.");
        } else if (saved) {
          documentVersion = saved.document_version;
          l.document_version = saved.document_version;
          l.document_json = saved.document_json;
        }
      } else {
        documentJson = normalizeLessonDocument(null);
      }
    }

    setContent(c);
    setLesson(l);
    setTitle(l.title || "");
    lastSavedTitleRef.current = l.title || "";
    titleDirtyRef.current = false;
    setEditorSeed({
      lessonId,
      document: JSON.parse(JSON.stringify(normalizeLessonDocument(documentJson))),
      documentVersion,
    });
    setLoading(false);
  }, [user, contentId, lessonId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (titleDirtyRef.current) {
        void persistTitle(titleValueRef.current);
      }
    };
  }, [lessonId, persistTitle]);

  const onTitleChange = (value) => {
    setTitle(value);
    titleDirtyRef.current = true;
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      void persistTitle(value);
    }, TITLE_SAVE_MS);
  };

  const retrySave = () => {
    void persistTitle(title);
    void editorRef.current?.flush();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando lección…</p>
      </main>
    );
  }
  if (!user || !content || !lesson) return null;

  const unit = lesson.content_units;
  const unitPosition = Number.isFinite(unit?.position) ? unit.position + 1 : null;
  const unitLabel = unit
    ? `${unitPosition ? `Unidad ${unitPosition}` : "Unidad"} · ${unit.title || "Sin título"}`
    : "Unidad";

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
      {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

      <div className="pbc-lesson-page">
        <nav className="pbc-content-breadcrumb" aria-label="Ubicación">
          <Link to="/dashboard/content">Mi Contenido</Link>
          <span aria-hidden> › </span>
          <Link to={`/dashboard/content/${contentId}`}>{content.title}</Link>
          <span aria-hidden> › </span>
          <span>{unitLabel}</span>
          <span aria-hidden> › </span>
          <span>{title || lesson.title}</span>
        </nav>

        <header className="pbc-lesson-hero">
          <div className="pbc-lesson-hero__left">
            <LessonDocIllustration />
            <div className="pbc-lesson-hero__copy">
              <div className="pbc-lesson-hero__title-row">
                <label className="pbc-visually-hidden" htmlFor="lesson-title-input">
                  Título de la lección
                </label>
                <input
                  id="lesson-title-input"
                  ref={titleInputRef}
                  className="pbc-lesson-title-input"
                  value={title}
                  onChange={(event) => onTitleChange(event.target.value)}
                  onBlur={() => void persistTitle(title)}
                  disabled={preview}
                />
                {!preview ? (
                  <button
                    type="button"
                    className="pbc-lesson-hero__pencil"
                    title="Editar título"
                    aria-label="Editar título"
                    onClick={() => titleInputRef.current?.focus()}
                  >
                    <PencilIcon />
                  </button>
                ) : null}
              </div>
              <p className="pbc-lesson-hero__subtitle">
                {content.title} · {unitLabel}
              </p>
              <Link to={`/dashboard/content/${contentId}`} className="pbc-lesson-hero__back">
                ← Volver
              </Link>
            </div>
          </div>

          <div className="pbc-lesson-hero__right">
            <SaveStatus status={saveStatus} onRetry={retrySave} />
            <button
              type="button"
              className="pbc-lesson-assign-btn"
              onClick={() => setAssignOpen(true)}
              disabled={preview}
            >
              <AssignIcon />
              Asignar
            </button>
            <button
              type="button"
              className="pbc-lesson-preview-btn"
              onClick={() => setPreview((value) => !value)}
              aria-pressed={preview}
            >
              <EyeIcon />
              {preview ? "Seguir editando" : "Vista previa"}
            </button>
          </div>
        </header>

        {editorSeed && editorSeed.lessonId === lessonId ? (
          <LessonBlockNoteEditor
            key={lessonId}
            ref={editorRef}
            lessonId={lessonId}
            contentId={contentId}
            initialContent={editorSeed.document}
            documentVersion={editorSeed.documentVersion}
            preview={preview}
            onStatusChange={setSaveStatus}
          />
        ) : null}
      </div>

      <AssignLessonModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        lessonId={lessonId}
        lessonTitle={title || lesson.title}
        contentTitle={content.title}
      />
    </PyBotClassLayout>
  );
}
