import { t } from "./i18n.js";
import { PHASE, canCloseModal, BOARD_STATE } from "./esp32/provisioningPhases.js";

/**
 * Modal educativo del flujo Preparar ESP32.
 */
export default function PrepareEsp32Modal({
  open,
  phase = PHASE.IDLE,
  pct = null,
  bytesWritten = null,
  bytesTotal = null,
  boardState = null,
  chipName = null,
  error = null,
  logLines = [],
  showLog = false,
  running = false,
  onToggleLog,
  onClose,
  onConfirm,
  onCancelConfirm,
  onRetry,
  onReinstall,
}) {
  if (!open) return null;

  const critical = !canCloseModal(phase);
  const close = () => {
    if (critical) return;
    onClose?.();
  };

  const confirmPhase =
    phase === PHASE.CONFIRM_FLASH ||
    phase === PHASE.CONFIRM_INSTALL ||
    phase === PHASE.CONFIRM_UPDATE ||
    phase === PHASE.CONFIRM_REINSTALL;

  const progressKnown = typeof pct === "number" && (phase === PHASE.FLASHING || phase === PHASE.INSTALLING_PYBOT);

  return (
    <div className="modal-back" role="presentation" onClick={close}>
      <div
        className="modal modal-wide modal-connect modal-prepare-esp32"
        role="dialog"
        aria-labelledby="prepare-esp32-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="prepare-esp32-title" className="modal-title">
          {t("prepareEsp32Title")}
        </h3>
        <p className="connect-modal-intro">{t("prepareEsp32Intro")}</p>

        {boardState ? (
          <div className="connect-modal-board">
            <span className="connect-modal-board__label">{t("prepareEsp32BoardState")}</span>
            <span className="connect-modal-board__value">{t(`prepareState_${boardState}`)}</span>
          </div>
        ) : null}

        <p className="prepare-esp32-phase">{t(`preparePhase_${phase}`)}</p>

        {progressKnown ? (
          <div className="prepare-esp32-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="prepare-esp32-progress__bar" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
            <span className="prepare-esp32-progress__label">
              {t("prepareEsp32Progress").replace("{pct}", String(pct))}
              {bytesWritten != null && bytesTotal
                ? ` (${bytesWritten} / ${bytesTotal})`
                : null}
            </span>
          </div>
        ) : null}

        {chipName && phase === PHASE.UNSUPPORTED_VARIANT ? (
          <div className="connect-modal-error" role="alert">
            {t("prepareEsp32Unsupported").replace("{chip}", String(chipName))}
          </div>
        ) : null}

        {phase === PHASE.NEED_BOOT_BUTTON ? (
          <div className="connect-help">
            <h4 className="connect-help__title">{t("prepareEsp32BootHelp")}</h4>
            <ol className="connect-help__steps">
              <li>{t("prepareEsp32BootHelp1")}</li>
              <li>{t("prepareEsp32BootHelp2")}</li>
            </ol>
          </div>
        ) : null}

        {phase === PHASE.ERROR && error ? (
          <div className="connect-modal-error" role="alert">
            {t(`provErr_${error}`) !== `provErr_${error}` ? t(`provErr_${error}`) : t("provErr_UNKNOWN")}
          </div>
        ) : null}

        {phase === PHASE.ALREADY_PREPARED ? (
          <p className="prepare-esp32-ok">{t("prepareEsp32Already")}</p>
        ) : null}

        {phase === PHASE.READY ? (
          <p className="prepare-esp32-ok">{t("prepareEsp32Ready")}</p>
        ) : null}

        {confirmPhase ? (
          <div className="prepare-esp32-warn" role="alert">
            {phase === PHASE.CONFIRM_FLASH
              ? t("prepareEsp32ConfirmFlash")
              : phase === PHASE.CONFIRM_REINSTALL
                ? t("prepareEsp32ConfirmReinstall")
                : phase === PHASE.CONFIRM_UPDATE
                  ? t("prepareEsp32ConfirmUpdate")
                  : t("prepareEsp32ConfirmInstall")}
          </div>
        ) : null}

        {showLog && logLines.length ? (
          <pre className="prepare-esp32-log" aria-label={t("prepareEsp32ShowLog")}>
            {logLines.join("\n")}
          </pre>
        ) : null}

        <div className="connect-modal-actions">
          {confirmPhase ? (
            <>
              <button type="button" className="connect-btn connect-btn--primary" onClick={onConfirm}>
                {t("prepareEsp32ConfirmYes")}
              </button>
              <button type="button" className="connect-btn connect-btn--ghost" onClick={onCancelConfirm}>
                {t("prepareEsp32ConfirmNo")}
              </button>
            </>
          ) : null}

          {phase === PHASE.ALREADY_PREPARED ? (
            <button type="button" className="connect-btn connect-btn--ghost" onClick={onReinstall}>
              {t("prepareEsp32Reinstall")}
            </button>
          ) : null}

          {(phase === PHASE.ERROR || phase === PHASE.NEED_BOOT_BUTTON || phase === PHASE.UNSUPPORTED_VARIANT) &&
          !running ? (
            <button type="button" className="connect-btn connect-btn--primary" onClick={onRetry} disabled={running}>
              {t("prepareEsp32Retry")}
            </button>
          ) : null}

          <button type="button" className="connect-btn connect-btn--ghost" onClick={onToggleLog}>
            {showLog ? t("prepareEsp32HideLog") : t("prepareEsp32ShowLog")}
          </button>

          <button
            type="button"
            className="modal-close connect-btn--close"
            onClick={close}
            disabled={critical}
          >
            {phase === PHASE.READY ? t("close") : t("prepareEsp32Cancel")}
          </button>
        </div>

        {critical ? <p className="connect-modal-foot">{t("prepareEsp32Critical")}</p> : null}
        {boardState === BOARD_STATE.VIRGIN ? (
          <p className="connect-modal-foot">{t("prepareEsp32Foot")}</p>
        ) : null}
      </div>
    </div>
  );
}
