import { useEffect, useState, useCallback } from "react";
import { t } from "./i18n.js";
import { isWebBluetoothSupported, BLE_STATE } from "./bluetoothTransport.js";
import {
  COMMANDS,
  parseInfoResponse,
  runtimeSupportsRun,
  runtimeUpdateStatus,
  PYBOT_RUNTIME_VERSION,
} from "./bleProtocol.js";
import {
  bleRunConnect,
  bleRunDisconnect,
  bleRunTransport,
  bleUpdateRuntime,
} from "./hardwareBridge.js";

/**
 * Panel de conexion + diagnostico BLE (encapsulado). No toca USB / Web Serial.
 *
 * Reutiliza la MISMA conexion BLE que usa el Run inalámbrico (bridge): así, al
 * conectar acá, el botón Ejecutar corre el programa por Bluetooth. El transporte
 * lo administra `hardwareBridge` (bleRunConnect/bleRunTransport/bleRunDisconnect).
 *
 * @param {{ open: boolean, onClose: () => void, onConnectionChange?: (connected:boolean, name:string|null) => void }} props
 */
export default function BluetoothPanel({ open, onClose, onConnectionChange }) {
  const [supported] = useState(() => isWebBluetoothSupported());
  const [state, setState] = useState(BLE_STATE.IDLE);
  const [deviceName, setDeviceName] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [updating, setUpdating] = useState(false);
  const [updatePhase, setUpdatePhase] = useState(null);
  const [updatePct, setUpdatePct] = useState(0);
  const [updateMsg, setUpdateMsg] = useState(null);

  const appendLog = useCallback((line, kind = "info") => {
    setLog((prev) => [...prev.slice(-40), { line, kind, ts: Date.now() }]);
  }, []);

  const notifyConnection = useCallback(
    (connected, name) => {
      if (typeof onConnectionChange === "function") onConnectionChange(connected, name);
    },
    [onConnectionChange],
  );

  // Refleja el estado del transporte compartido al montar (por si ya estaba conectado).
  useEffect(() => {
    const tr = bleRunTransport();
    if (tr && tr.isConnected()) {
      setState(BLE_STATE.CONNECTED);
      setDeviceName(tr.getDeviceInfo?.().deviceName ?? null);
    }
  }, [open]);

  const handleConnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { deviceName: name } = await bleRunConnect();
      const tr = bleRunTransport();
      if (tr && typeof tr.onStateChange === "function") {
        tr.onStateChange((s) => {
          setState(s);
          if (s === BLE_STATE.DISCONNECTED || s === BLE_STATE.IDLE) {
            notifyConnection(false, null);
          }
        });
      }
      setState(BLE_STATE.CONNECTED);
      setDeviceName(name);
      notifyConnection(true, name);
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
  }, [appendLog, notifyConnection]);

  const handleDisconnect = useCallback(async () => {
    await bleRunDisconnect().catch(() => {});
    setState(BLE_STATE.IDLE);
    setDeviceName(null);
    setInfo(null);
    notifyConnection(false, null);
    appendLog(t("bleLogDisconnected"), "info");
  }, [appendLog, notifyConnection]);

  const sendCommand = useCallback(
    async (command, label) => {
      const tr = bleRunTransport();
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

  const refreshInfo = useCallback(async () => {
    const tr = bleRunTransport();
    if (!tr || !tr.isConnected()) return;
    try {
      const resp = await tr.sendAndWait(COMMANDS.INFO, 4000);
      const parsed = parseInfoResponse(resp);
      if (parsed) {
        tr.setDeviceInfo(parsed);
        setInfo(parsed);
      }
    } catch {
      /* INFO opcional */
    }
  }, []);

  const updatePhaseText = useCallback((phase, pct) => {
    switch (phase) {
      case "begin":
      case "start":
        return t("bleUpdateStart");
      case "transfer":
        return t("bleUpdateTransfer").replace("{pct}", String(pct ?? 0));
      case "verified":
        return t("bleUpdateVerifying");
      case "applying":
        return t("bleUpdateApplying");
      case "reconnecting":
        return t("bleUpdateReconnecting");
      case "verifying-version":
        return t("bleUpdateRestarting");
      default:
        return t("bleUpdating");
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    if (updating) return;
    setError(null);
    setUpdateMsg(null);
    setUpdating(true);
    setUpdatePhase("start");
    setUpdatePct(0);
    appendLog(t("bleUpdateStart"), "info");
    try {
      const res = await bleUpdateRuntime({
        onProgress: (p) => {
          setUpdatePhase(p.phase);
          if (typeof p.pct === "number") setUpdatePct(p.pct);
        },
      });
      if (res.reconnected) {
        // Restaurar el estado de conexión tras el reset+reconexión de la placa.
        setState(BLE_STATE.CONNECTED);
        notifyConnection(true, deviceName);
      }
      if (res.verified) {
        setUpdateMsg(t("bleUpdateOk"));
        appendLog(t("bleUpdateOk"), "ok");
        await refreshInfo();
      } else if (res.reconnected) {
        setUpdateMsg(t("bleUpdateMismatch"));
        appendLog(t("bleUpdateMismatch"), "err");
        await refreshInfo();
      } else {
        setUpdateMsg(t("bleUpdateAppliedNoReconnect"));
        appendLog(t("bleUpdateAppliedNoReconnect"), "info");
      }
    } catch (e) {
      const code = e?.message ?? "";
      if (code === "BLE_UPDATE_UNSUPPORTED") {
        setUpdateMsg(t("bleUpdateUnsupported"));
      } else {
        const short = code.replace(/^BLE_UPDATE_ERROR:/, "").replace(/^BLE_UPDATE_/, "");
        setUpdateMsg(t("bleUpdateFail").replace("{code}", short || "ERROR"));
      }
      appendLog(updateMsg ?? t("bleUpdateFail").replace("{code}", code || "ERROR"), "err");
    } finally {
      setUpdating(false);
      setUpdatePhase(null);
    }
  }, [updating, appendLog, notifyConnection, deviceName, refreshInfo, updateMsg]);

  if (!open) return null;

  const connected = state === BLE_STATE.CONNECTED;
  const updateStatus = info ? runtimeUpdateStatus(info, PYBOT_RUNTIME_VERSION) : null;

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

        {connected && info && !runtimeSupportsRun(info) ? (
          <div className="connect-modal-error" role="alert">
            {t("bleFirmwareOutdated")}
          </div>
        ) : null}

        {connected && info ? (
          <div className="ble-update">
            <span className="toolbar-menu-mode__label">{t("bleUpdateSectionLabel")}</span>
            <div className="ble-update__versions">
              <span>
                {t("bleUpdateInstalled").replace("{version}", info.firmware ?? "?")}
              </span>
              <span>
                {t("bleUpdateLatest").replace("{version}", updateStatus?.latest ?? PYBOT_RUNTIME_VERSION)}
              </span>
            </div>

            {updating ? (
              <div className="ble-update__progress" aria-live="polite">
                {updatePhaseText(updatePhase, updatePct)}
              </div>
            ) : updateStatus?.needsUsb ? (
              <div className="connect-modal-error" role="alert">
                {t("bleUpdateNeedsUsb")}
              </div>
            ) : updateStatus?.canUpdateOta ? (
              <>
                <div className="ble-update__available">
                  {t("bleUpdateAvailable")
                    .replace("{from}", updateStatus.installed ?? "?")
                    .replace("{to}", updateStatus.latest)}
                </div>
                <button
                  type="button"
                  className="connect-btn connect-btn--primary"
                  onClick={handleUpdate}
                  disabled={busy || updating}
                >
                  {t("bleUpdateBtn")}
                </button>
              </>
            ) : (
              <div className="ble-update__uptodate">{t("bleUpdateUpToDate")}</div>
            )}

            {updateMsg ? (
              <div className="ble-update__msg" aria-live="polite">
                {updateMsg}
              </div>
            ) : null}
          </div>
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
