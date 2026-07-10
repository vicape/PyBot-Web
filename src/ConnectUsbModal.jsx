import { useEffect, useState } from "react";
import { t } from "./i18n.js";
import {
  getUsbEnvironmentChecks,
  classifyConnectError,
  boardLabelKey,
} from "./connectUsbAssistant.js";

/**
 * @param {{
 *   open: boolean;
 *   boardType: string;
 *   connecting: boolean;
 *   preparing?: boolean;
 *   phase: "ready" | "connecting" | "failed";
 *   errorMessage: string | null;
 *   showHelp: boolean;
 *   onClose: () => void;
 *   onConnect: () => void;
 *   onToggleHelp: () => void;
 * }} props
 */
export default function ConnectUsbModal({
  open,
  boardType,
  connecting,
  preparing = false,
  phase,
  errorMessage,
  showHelp,
  onClose,
  onConnect,
  onToggleHelp,
}) {
  const [knownPorts, setKnownPorts] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        if ("serial" in navigator) {
          const ports = await navigator.serial.getPorts();
          if (!cancelled) setKnownPorts(ports.length);
        } else if (!cancelled) {
          setKnownPorts(0);
        }
      } catch {
        if (!cancelled) setKnownPorts(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const checks = getUsbEnvironmentChecks();
  const allChecksOk = checks.every((c) => c.ok);
  const errorKind = classifyConnectError(errorMessage ?? "");
  const canConnect = allChecksOk && !connecting;

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div
        className="modal modal-wide modal-connect"
        role="dialog"
        aria-labelledby="connect-usb-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="connect-usb-title" className="modal-title">
          {t("connectModalTitle")}
        </h3>
        <p className="connect-modal-intro">{t("connectModalIntro")}</p>

        <div className="connect-modal-board">
          <span className="connect-modal-board__label">{t("boardLabel")}</span>
          <span className="connect-modal-board__value">{t(boardLabelKey(boardType))}</span>
        </div>

        <ul className="connect-checklist" aria-label={t("connectModalChecksLabel")}>
          {checks.map((c) => (
            <li
              key={c.id}
              className={`connect-check ${c.ok ? "connect-check--ok" : "connect-check--bad"}`}
            >
              <span className="connect-check__icon" aria-hidden>
                {c.ok ? "✓" : "!"}
              </span>
              <span>{t(`connectCheck_${c.id}`)}</span>
            </li>
          ))}
          {knownPorts > 0 ? (
            <li className="connect-check connect-check--ok">
              <span className="connect-check__icon" aria-hidden>
                ✓
              </span>
              <span>{t("connectCheck_knownPorts").replace("{n}", String(knownPorts))}</span>
            </li>
          ) : null}
        </ul>

        {phase === "failed" && errorMessage ? (
          <div className="connect-modal-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        {showHelp || phase === "failed" ? (
          <div className="connect-help">
            <h4 className="connect-help__title">{t("connectHelpTitle")}</h4>
            <ol className="connect-help__steps">
              <li>{t("connectHelpStep1")}</li>
              <li>{t("connectHelpStep2")}</li>
              <li>{t("connectHelpStep3")}</li>
            </ol>

            {errorKind === "MISSING_BROWSER" ? (
              <p className="connect-help__note">{t("connectHelpBrowser")}</p>
            ) : null}
            {errorKind === "HTTPS" ? (
              <p className="connect-help__note">{t("connectHelpHttps")}</p>
            ) : null}
            {errorKind === "PERMISSION" ? (
              <p className="connect-help__note">{t("connectHelpPermission")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="connect-modal-actions">
          <button
            type="button"
            className="connect-btn connect-btn--primary"
            onClick={onConnect}
            disabled={!canConnect}
          >
            {preparing
              ? t("connectModalPreparing")
              : phase === "connecting" || connecting
                ? t("connectModalConnecting")
                : t("connect")}
          </button>
          <button type="button" className="connect-btn connect-btn--ghost" onClick={onToggleHelp}>
            {showHelp ? t("connectHideHelp") : t("connectShowHelp")}
          </button>
          <button type="button" className="modal-close connect-btn--close" onClick={onClose}>
            {t("close")}
          </button>
        </div>

        <p className="connect-modal-foot">{t("connectModalFoot")}</p>
      </div>
    </div>
  );
}
