import { useState } from "react";
import { deleteContent } from "../../../platform/contentApi.js";

export default function DeleteContentModal({ open, content, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!open || !content) return null;

  const confirmDelete = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");

    const { ok, error } = await deleteContent(content.id);
    setBusy(false);

    if (!ok) {
      setErr(error || "No se pudo eliminar el contenido.");
      return;
    }

    onDeleted?.(content.id);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <div
        className="pbc-modal pbc-modal--create-content"
        role="dialog"
        aria-labelledby="delete-content-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-content-title" className="pbc-modal__title">
          Eliminar contenido
        </h2>
        <p className="pbc-modal--create-content__subtitle">
          ¿Seguro que querés eliminar «{content.title}»?
        </p>
        <p className="pbc-modal--create-content__subtitle">
          Esta acción eliminará también sus unidades, lecciones y bloques de contenido.
        </p>
        <p className="pbc-modal--create-content__subtitle pbc-modal--create-content__subtitle--warn">
          Esta acción no se puede deshacer.
        </p>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="pbc-btn pbc-btn--danger"
            onClick={() => void confirmDelete()}
            disabled={busy}
          >
            {busy ? "Eliminando…" : "Eliminar contenido"}
          </button>
        </div>
      </div>
    </div>
  );
}
