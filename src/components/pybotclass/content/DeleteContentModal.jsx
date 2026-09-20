import { t } from "../../../i18n.js";
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
      setErr(error || t("pcDeleteContentFail"));
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
          {t("pcDeleteContent")}
        </h2>
        <p className="pbc-modal--create-content__subtitle">
          {t("pcDeleteContentQuestion")} «{content.title}»?
        </p>
        <p className="pbc-modal--create-content__subtitle">
          {t("pcDeleteContentCascade")}
        </p>
        <p className="pbc-modal--create-content__subtitle pbc-modal--create-content__subtitle--warn">
          {t("pcCannotUndo")}
        </p>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            {t("pcCancel")}
          </button>
          <button
            type="button"
            className="pbc-btn pbc-btn--danger"
            onClick={() => void confirmDelete()}
            disabled={busy}
          >
            {busy ? t("pcDeleting") : t("pcDeleteContent")}
          </button>
        </div>
      </div>
    </div>
  );
}
