import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  BLOCK_TYPES,
  createLessonBlock,
  deleteLessonBlock,
  getContent,
  getLesson,
  listLessonBlocks,
  moveLessonBlock,
  updateLessonBlock,
} from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

function BlockEditForm({ block, onSave, onCancel, busy }) {
  const typeInfo = BLOCK_TYPES[block.block_type] || BLOCK_TYPES.theory;
  const [title, setTitle] = useState(block.title || "");
  const [content, setContent] = useState(block.content || "");
  const [starterCode, setStarterCode] = useState(block.starter_code || "");

  return (
    <form
      className="pbc-block-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, content, starterCode: typeInfo.hasStarterCode ? starterCode : null });
      }}
    >
      <div className="pbc-modal__field">
        <label className="pbc-label">Título (opcional)</label>
        <input className="pbc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="pbc-modal__field">
        <label className="pbc-label">Contenido</label>
        <textarea
          className="pbc-input pbc-input--textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
        />
      </div>
      {typeInfo.hasStarterCode ? (
        <div className="pbc-modal__field">
          <label className="pbc-label">Código inicial (opcional)</label>
          <textarea
            className="pbc-input pbc-input--textarea pbc-input--mono"
            value={starterCode}
            onChange={(e) => setStarterCode(e.target.value)}
            rows={5}
            spellCheck={false}
          />
        </div>
      ) : null}
      <div className="pbc-modal__actions">
        <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

export default function LessonEditorPage() {
  const { contentId, lessonId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/content/${contentId}/lessons/${lessonId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [content, setContent] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState(null);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user || !contentId || !lessonId) return;
    setLoading(true);
    setErr("");

    const [{ content: c, error: cErr }, { lesson: l, error: lErr }, { rows, error: bErr }, { profile }] =
      await Promise.all([
        getContent(contentId),
        getLesson(lessonId),
        listLessonBlocks(lessonId),
        fetchProfile(user.id),
      ]);

    setSuperAdmin(isSuperAdmin(profile));

    if (cErr || !c || lErr || !l) {
      setErr(cErr || lErr || "Lección no encontrada.");
      setLoading(false);
      return;
    }
    if (bErr) setErr(bErr);

    setContent(c);
    setLesson(l);
    setBlocks(rows);
    setLoading(false);
  }, [user, contentId, lessonId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const addBlock = async (blockType) => {
    if (busy) return;
    setBusy(true);
    const { block, error } = await createLessonBlock(lessonId, { blockType, content: "" });
    setBusy(false);
    setShowTypePicker(false);
    if (error || !block) {
      setErr(error || "No se pudo crear el bloque.");
      return;
    }
    setEditingBlockId(block.id);
    void load();
  };

  const saveBlock = async (blockId, values) => {
    if (busy) return;
    setBusy(true);
    const { error } = await updateLessonBlock(blockId, {
      title: values.title,
      content: values.content,
      starterCode: values.starterCode,
    });
    setBusy(false);
    if (error) setErr(error);
    else {
      setEditingBlockId(null);
      void load();
    }
  };

  const removeBlock = async (block) => {
    if (!window.confirm(`¿Eliminar este bloque de ${BLOCK_TYPES[block.block_type]?.label || "contenido"}?`)) return;
    setBusy(true);
    const { error } = await deleteLessonBlock(block.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const moveBlock = async (blockId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveLessonBlock(blockId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando lección…</p>
      </main>
    );
  }
  if (!user || !content || !lesson) return null;

  const unitTitle = lesson.content_units?.title || "Unidad";

  return (
    <>
      <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
        {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-lesson-editor">
          <nav className="pbc-content-breadcrumb">
            <Link to="/dashboard/content">Mi Contenido</Link>
            <span aria-hidden> / </span>
            <Link to={`/dashboard/content/${contentId}`}>{content.title}</Link>
            <span aria-hidden> / </span>
            <span>{lesson.title}</span>
          </nav>

          <header className="pbc-lesson-editor__head">
            <p className="pbc-lesson-editor__unit">{unitTitle}</p>
            <h1 className="pbc-hero-block__title">{lesson.title}</h1>
          </header>

          <div className="pbc-block-list">
            {blocks.length === 0 ? (
              <p className="pbc-lesson-editor__empty">Todavía no hay bloques en esta lección.</p>
            ) : (
              blocks.map((block, index) => {
                const typeInfo = BLOCK_TYPES[block.block_type] || BLOCK_TYPES.theory;
                const isEditing = editingBlockId === block.id;

                return (
                  <article key={block.id} className={`pbc-block-card pbc-block-card--${block.block_type}`}>
                    <div className="pbc-block-card__head">
                      <span className={`pbc-block-card__type pbc-block-card__type--${block.block_type}`}>
                        {typeInfo.label}
                      </span>
                      <div className="pbc-block-card__tools">
                        <div className="pbc-order-btns">
                          <button
                            type="button"
                            className="pbc-order-btn"
                            onClick={() => void moveBlock(block.id, "up")}
                            disabled={busy || index === 0}
                            aria-label="Subir bloque"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="pbc-order-btn"
                            onClick={() => void moveBlock(block.id, "down")}
                            disabled={busy || index === blocks.length - 1}
                            aria-label="Bajar bloque"
                          >
                            ↓
                          </button>
                        </div>
                        {!isEditing ? (
                          <>
                            <button
                              type="button"
                              className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                              onClick={() => setEditingBlockId(block.id)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                              onClick={() => void removeBlock(block)}
                            >
                              Eliminar
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {isEditing ? (
                      <BlockEditForm
                        block={block}
                        busy={busy}
                        onCancel={() => setEditingBlockId(null)}
                        onSave={(values) => void saveBlock(block.id, values)}
                      />
                    ) : (
                      <div className="pbc-block-card__body">
                        {block.title ? <h3 className="pbc-block-card__title">{block.title}</h3> : null}
                        {block.content ? (
                          <pre className="pbc-block-card__content">{block.content}</pre>
                        ) : (
                          <p className="pbc-block-card__placeholder">Sin contenido todavía.</p>
                        )}
                        {block.starter_code ? (
                          <div className="pbc-block-card__code">
                            <span className="pbc-block-card__code-label">Código inicial</span>
                            <pre>{block.starter_code}</pre>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <button
            type="button"
            className="pbc-btn pbc-btn--primary"
            onClick={() => setShowTypePicker(true)}
            disabled={busy}
          >
            + Agregar contenido
          </button>
        </div>
      </PyBotClassLayout>

      {showTypePicker ? (
        <div className="pbc-modal-backdrop" role="presentation" onClick={() => setShowTypePicker(false)}>
          <div
            className="pbc-modal pbc-modal--picker"
            role="dialog"
            aria-labelledby="block-picker-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="block-picker-title" className="pbc-modal__title">
              ¿Qué querés agregar?
            </h2>
            <div className="pbc-block-type-grid">
              {Object.entries(BLOCK_TYPES).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  className={`pbc-block-type-btn pbc-block-type-btn--${key}`}
                  onClick={() => void addBlock(key)}
                  disabled={busy}
                >
                  {info.label}
                </button>
              ))}
            </div>
            <button type="button" className="pbc-btn pbc-btn--ghost" onClick={() => setShowTypePicker(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
