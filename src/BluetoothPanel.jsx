import { useEffect, useRef, useState, useCallback } from "react";
import { t } from "./i18n.js";
import {
  BluetoothTransport,
  isWebBluetoothSupported,
  BLE_STATE,
} from "./bluetoothTransport.js";
import { COMMANDS, parseInfoResponse } from "./bleProtocol.js";

/**
 * Panel de conexion + diagnostico BLE (encapsulado). No toca USB / Web Serial.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function BluetoothPanel({ open, onClose }) {
  const transportRef = useRef(null);
  const [supported] = useState(() => isWebBluetoothSupported());
  const [state, setState] = useState(BLE_STATE.IDLE);
  const [deviceName, setDeviceName] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const appendLog = useCallback((line, kind = "info") => {
    setLog((prev) => [...prev.slice(-40), { line, kind, ts: Date.now() }]);
  }, []);

  const getTransport = useCallback(() => {
    if (!transportRef.current) {
      const tr = new BluetoothTransport();
      tr.onStateChange((s) => setState(s));
      transportRef.current = tr;
    }
    return transportRef.current;
  }, []);

  useEffect(() => {
    return () => {
      const tr = transportRef.current;
      if (tr && tr.isConnected()) {
        tr.disconnect().catch(() => {});
      }
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const tr = getTransport();
      const { deviceName: name } = await tr.connect();
      setDeviceName(name);
      appendLog(t("bleLogConnected").replace("{name}", name ?? "PYBOT"), "ok");
      try {
        const resp = await tr.sendAndWait(COMMANDS.INFO, 4000);
        const parsed = parseInfoResponse(resp);
        if (parsed) {
          tr.setDeviceInfo(parsed);
          setInfo(parsed);
        }
        appendLog("INFO -> " + resp, "recv");
      } catch {
        /* INFO opcional: la conexion sigue siendo valida */
      }
    } catch (e) {
      const code = e?.message ?? "BLE_CONNECT_FAIL";
      if (code === "BLE_CANCELLED") {
        setError(t("bleCancelled"));
      } else if (code === "BLE_UNSUPPORTED") {
        setError(t("bleUnsupported"));
      } else {
        setError(t("bleConnectFail"));
      }
    } finally {
      setBusy(false);
    }
  }, [getTransport, appendLog]);

  const handleDisconnect = useCallback(async () => {
    const tr = transportRef.current;
    if (tr) await tr.disconnect().catch(() => {});
    setDeviceName(null);
    setInfo(null);
    appendLog(t("bleLogDisconnected"), "info");
  }, [appendLog]);

  const sendCommand = useCallback(
    async (command, label) => {
      const tr = transportRef.current;
      if (!tr || !tr.isConnected()) {
        setError(t("bleNotConnected"));
        return;
      }
      setBusy(true);
      appendLog((label ?? command) + " ->", "send");
      try {
        const resp = await tr.sendAndWait(command, 4000);
        appendLog("<- " + resp, "recv");
        const parsed = parseInfoResponse(resp);
        if (parsed) {
          tr.setDeviceInfo(parsed);
          setInfo(parsed);
        }
      } catch (e) {
        const code = e?.message ?? "";
        appendLog("<- " + (code === "BLE_TIMEOUT" ? t("bleTimeout") : t("bleSendFail")), "err");
      } finally {
        setBusy(false);
      }
    },
    [appendLog],
  );

  if (!open) return null;

  const connected = state === BLE_STATE.CONNECTED;

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div
        className="modal modal-connect"
        role="dialog"
        aria-labelledby="ble-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ble-panel-title" className="modal-title">
          {t("blePanelTitle")}
        </h3>
        <p className="connect-modal-intro">{t("blePanelIntro")}</p>

        {!supported ? (
          <div className="connect-modal-error" role="alert">
            {t("bleUnsupported")}
          </div>
        ) : null}

        {error ? (
          <div className="connect-modal-error" role="alert">
            {error}
          </div>
        ) : null}

        {connected ? (
          <div className="connect-modal-board">
            <span className="connect-modal-board__label">{t("bleConnectedLabel")}</span>
            <span className="connect-modal-board__value">
              {info?.device ?? deviceName ?? "PYBOT"}
            </span>
          </div>
        ) : null}

        {connected && info ? (
          <ul className="connect-checklist" aria-label={t("bleDeviceInfo")}>
            <li className="connect-check connect-check--ok">
              <span className="connect-check__icon" aria-hidden>ID</span>
              <span>{info.id}</span>
            </li>
            <li className="connect-check connect-check--ok">
              <span className="connect-check__icon" aria-hidden>FW</span>
              <span>
                {info.firmware} · {info.runtime}
              </span>
            </li>
          </ul>
        ) : null}

        <div className="connect-modal-actions">
          {!connected ? (
            <button
              type="button"
              className="connect-btn connect-btn--primary"
              onClick={handleConnect}
              disabled={!supported || busy || state === BLE_STATE.CONNECTING}
            >
              {state === BLE_STATE.CONNECTING ? t("bleConnecting") : t("bleConnect")}
            </button>
          ) : (
            <button
              type="button"
              className="connect-btn connect-btn--ghost"
              onClick={handleDisconnect}
              disabled={busy}
            >
              {t("bleDisconnect")}
            </button>
          )}
          <button type="button" className="modal-close connect-btn--close" onClick={onClose}>
            {t("close")}
          </button>
        </div>

        {connected ? (
          <div className="ble-diag">
            <span className="toolbar-menu-mode__label">{t("bleDiagTitle")}</span>
            <div className="ble-diag__buttons">
              <button
                type="button"
                className="connect-btn connect-btn--ghost"
                onClick={() => sendCommand(COMMANDS.PING, "PING")}
                disabled={busy}
              >
                PING
              </button>
              <button
                type="button"
                className="connect-btn connect-btn--ghost"
                onClick={() => sendCommand(COMMANDS.INFO, "INFO")}
                disabled={busy}
              >
                INFO
              </button>
              <button
                type="button"
                className="connect-btn connect-btn--ghost"
                onClick={() => sendCommand(COMMANDS.LED_ON, t("bleLedOn"))}
                disabled={busy}
              >
                {t("bleLedOn")}
              </button>
              <button
                type="button"
                className="connect-btn connect-btn--ghost"
                onClick={() => sendCommand(COMMANDS.LED_OFF, t("bleLedOff"))}
                disabled={busy}
              >
                {t("bleLedOff")}
              </button>
            </div>
            <div className="ble-diag__log" aria-live="polite">
              {log.length === 0 ? (
                <span className="ble-diag__empty">{t("bleLogEmpty")}</span>
              ) : (
                log.map((entry) => (
                  <div key={entry.ts + entry.line} className={`ble-diag__line ble-diag__line--${entry.kind}`}>
                    {entry.line}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <p className="connect-modal-foot">{t("blePanelFoot")}</p>
      </div>
    </div>
  );
}
