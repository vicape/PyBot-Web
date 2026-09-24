import { t } from "../../../i18n.js";
import { useEffect, useState } from "react";
import { createContent } from "../../../platform/contentApi.js";
import ContentMetadataFields from "./ContentMetadataFields.jsx";

const EMPTY_META = {
  language_code: null,
  difficulty: null,
  recommended_age_min: null,
  recommended_age_max: null,
  estimated_minutes: null,
  subject: "",
  tags: "",
  learning_objectives: "",
  prerequisites: "",
};

export default function CreateContentModal({ open, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [meta, setMeta] = useState(EMPTY_META);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setMeta(EMPTY_META);
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

    const { content, error } = await createContent({
      title: trimmed,
      description,
      ...meta,
    });
    setBusy(false);

    if (error || !content) {
      setErr(error || t("pcCreateContentFail"));
      return;
    }

    onCreated?.(content);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--create-content pbc-modal--content-meta"
        role="dialog"
        aria-labelledby="create-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-content-title" className="pbc-modal__title">
          {t("pcCreateContent")}
        </h2>
        <p className="pbc-modal--create-content__subtitle">{t("pcCreateContentDesc")}</p>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="content-title">
            {t("pcTitleRequired")}
          </label>
          <input
            id="content-title"
            className="pbc-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("pcContentTitlePlaceholder")}
            required
            autoFocus
          />
        </div>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="content-desc">
            {t("pcDescription")}
          </label>
          <textarea
            id="content-desc"
            className="pbc-input pbc-input--textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("pcContentDescriptionPlaceholder")}
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
            {busy ? t("pcCreatingContent") : t("pcCreateContent")}
          </button>
        </div>
      </form>
    </div>
  );
}
