import { t } from "../../../i18n.js";

/**
 * Contenido canónico del flujo “Unirme a un curso” (compartido por modal y /join).
 */
export default function JoinCourseForm({
  code,
  onCodeChange,
  busy,
  err,
  msg,
  onSubmit,
  onCancel,
  showCancel = true,
  inputId = "join-code",
  titleId = "join-course-title",
  autoFocus = false,
}) {
  return (
    <>
      <h2 id={titleId} className="pbc-modal__title">
        {t("pcJoinCourse")}
      </h2>
      <p className="pbc-modal__step-label">{t("pcJoinIntro")}</p>

      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      {msg ? <p className="pbc-alert pbc-alert--info">{msg}</p> : null}

      <form onSubmit={onSubmit}>
        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor={inputId}>
            {t("pcInvitationCode")}
          </label>
          <input
            id={inputId}
            className="pbc-input"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={t("pcCodePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            autoFocus={autoFocus}
          />
        </div>
        <div className="pbc-modal__actions">
          {showCancel ? (
            <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onCancel}>
              {t("pcCancel")}
            </button>
          ) : null}
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
            {busy ? t("pcJoining") : t("pcJoinCourse")}
          </button>
        </div>
      </form>
    </>
  );
}
