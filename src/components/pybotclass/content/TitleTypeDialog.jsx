import { useEffect, useId, useState } from "react";
import { t } from "../../../i18n.js";

/**
 * Reusable PyBotClass dialog for title + type selection (unit or lesson item).
 * Options must come from canonical UNIT_TYPES / LESSON_ITEM_TYPES.
 */
export default function TitleTypeDialog({
  open,
  dialogTitle,
  submitLabel,
  busyLabel,
  typeLabel,
  typeOptions,
  typeI18nPrefix,
  initialTitle = "",
  initialType,
  onClose,
  onSubmit,
}) {
  const titleId = useId();
  const typeId = useId();
  const headingId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [typeValue, setTypeValue] = useState(initialType);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle ?? "");
    setTypeValue(initialType);
    setErr("");
    setBusy(false);
  }, [open, initialTitle, initialType]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr("");
    try {
      const result = await onSubmit?.({ title: trimmed, type: typeValue });
      if (result?.error) {
        setErr(result.error);
        setBusy(false);
        return;
      }
      onClose?.();
    } catch (error) {
      setErr(error?.message || t("pcUnexpectedError"));
      setBusy(false);
    }
  };

  return (
    <div
      className="pbc-modal-backdrop pbc-modal-backdrop--create-content"
      role="presentation"
      onClick={() => {
        if (!busy) onClose?.();
      }}
    >
      <form
        className="pbc-modal pbc-modal--create-content pbc-modal--title-type"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id={headingId} className="pbc-modal__title">
          {dialogTitle}
        </h2>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor={titleId}>
            {t("pcTitleRequired")}
          </label>
          <input
            id={titleId}
            className="pbc-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            disabled={busy}
          />
        </div>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor={typeId}>
            {typeLabel}
          </label>
          <select
            id={typeId}
            className="pbc-input"
            value={typeValue}
            disabled={busy}
            onChange={(e) => setTypeValue(e.target.value)}
          >
            {typeOptions.map((value) => (
              <option key={value} value={value}>
                {t(`${typeI18nPrefix}${value}`)}
              </option>
            ))}
          </select>
        </div>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button
            type="button"
            className="pbc-btn pbc-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            {t("pcCancel")}
          </button>
          <button
            type="submit"
            className="pbc-btn pbc-btn--primary"
            disabled={busy || !title.trim()}
          >
            {busy ? busyLabel || t("pcSaving") : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
