import { useEffect, useState } from "react";
import { updateContent } from "../../../platform/contentApi.js";

export default function EditContentModal({ open, content, onClose, onSaved }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !content) return;
    setTitle(content.title || "");
    setDescription(content.description || "");
    setErr("");
    setBusy(false);
  }, [open, content]);

  if (!open || !content) return null;

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr("");

    const { content: updated, error } = await updateContent(content.id, {
      title: trimmed,
      description,
    });
    setBusy(false);

    if (error || !updated) {
      setErr(error || "No se pudo guardar el contenido.");
      return;
    }

    onSaved?.(updated);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--create-content"
        role="dialog"
        aria-labelledby="edit-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="edit-content-title" className="pbc-modal__title">
          Editar contenido
        </h2>
        <p className="pbc-modal--create-content__subtitle">
          Actualizá el título y la descripción de este contenido.
        </p>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="edit-content-title-input">
            Título *
          </label>
          <input
            id="edit-content-title-input"
            className="pbc-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="edit-content-desc">
            Descripción
          </label>
          <textarea
            id="edit-content-desc"
            className="pbc-input pbc-input--textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy || !title.trim()}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
