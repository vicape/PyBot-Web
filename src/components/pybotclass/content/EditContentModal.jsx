import { t } from "../../../i18n.js";
import { useEffect, useState } from "react";
import { updateContent } from "../../../platform/contentApi.js";
import ContentMetadataFields from "./ContentMetadataFields.jsx";

function metaFromContent(content) {
  return {
    language_code: content?.language_code ?? null,
    difficulty: content?.difficulty ?? null,
    recommended_age_min: content?.recommended_age_min ?? null,
    recommended_age_max: content?.recommended_age_max ?? null,
    estimated_minutes: content?.estimated_minutes ?? null,
    subject: content?.subject ?? "",
    tags: Array.isArray(content?.tags) ? content.tags.join(", ") : content?.tags || "",
    learning_objectives: Array.isArray(content?.learning_objectives)
      ? content.learning_objectives.join(", ")
      : content?.learning_objectives || "",
    prerequisites: Array.isArray(content?.prerequisites)
      ? content.prerequisites.join(", ")
      : content?.prerequisites || "",
  };
}

export default function EditContentModal({ open, content, onClose, onSaved }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [meta, setMeta] = useState(() => metaFromContent(null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !content) return;
    setTitle(content.title || "");
    setDescription(content.description || "");
    setMeta(metaFromContent(content));
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
      ...meta,
    });
    setBusy(false);

    if (error || !updated) {
      setErr(error || t("pcEditContentFail"));
      return;
    }

    onSaved?.(updated);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--create-content pbc-modal--content-meta"
        role="dialog"
        aria-labelledby="edit-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="edit-content-title" className="pbc-modal__title">
          {t("pcEditContent")}
        </h2>
        <p className="pbc-modal--create-content__subtitle">{t("pcEditContentDesc")}</p>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="edit-content-title-input">
            {t("pcTitleRequired")}
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
            {t("pcDescription")}
          </label>
          <textarea
            id="edit-content-desc"
            className="pbc-input pbc-input--textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <ContentMetadataFields value={meta} onChange={setMeta} disabled={busy} />

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            {t("pcCancel")}
          </button>
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy || !title.trim()}>
            {busy ? t("pcSaving") : t("pcSaveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}
