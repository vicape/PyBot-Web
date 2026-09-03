import { useEffect, useState } from "react";
import { createContent } from "../../../platform/contentApi.js";

export default function CreateContentModal({ open, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setErr("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr("");

    const { content, error } = await createContent({ title: trimmed, description });
    setBusy(false);

    if (error || !content) {
      setErr(error || "No se pudo crear el contenido.");
      return;
    }

    onCreated?.(content);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal"
        role="dialog"
        aria-labelledby="create-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-content-title" className="pbc-modal__title">
          Crear contenido
        </h2>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="content-title">
            Título *
          </label>
          <input
            id="content-title"
            className="pbc-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Introducción a Python"
            required
            autoFocus
          />
        </div>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="content-desc">
            Descripción
          </label>
          <textarea
            id="content-desc"
            className="pbc-input pbc-input--textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contenido inicial de programación para alumnos sin experiencia."
            rows={3}
          />
        </div>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy || !title.trim()}>
            {busy ? "Creando…" : "Crear contenido"}
          </button>
        </div>
      </form>
    </div>
  );
}
