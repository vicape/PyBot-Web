import { useEffect, useState } from "react";
import { getLang } from "./i18n.js";
import {
  C6_ZIGBEE_BENCH_PACKAGE,
  validateC6ZigbeeBenchFiles,
  assertC6ZigbeeBenchFlashConsent,
  flashC6ZigbeeBenchPackage,
} from "./esp32UniversalLab/runtime/c6ZigbeeBench.js";

/**
 * Operator-only ESP32-C6 physical test. This dialog does not download private
 * binaries into production, auto-flash, or mark Zigbee as hardware verified.
 */
export default function C6ZigbeeBenchModal({ open, onClose, onLog, profileId, connected }) {
  const [files, setFiles] = useState([]);
  const [validated, setValidated] = useState(null);
  const [backup, setBackup] = useState(false);
  const [erase, setErase] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [pct, setPct] = useState(0);
  const [finished, setFinished] = useState(false);
  const en = getLang() === "en";

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setValidated(null);
    setBackup(false);
    setErase(false);
    setConfirm("");
    setBusy(false);
    setError("");
    setPhase("");
    setPct(0);
    setFinished(false);
  }, [open]);

  if (!open) return null;
  const packageReady = validated?.ok === true;
  const gate = assertC6ZigbeeBenchFlashConsent({
    validated,
    profileId,
    connected,
    backupConfirmed: backup,
    eraseAcknowledged: erase,
    secondConfirmation: confirm.trim(),
  });
  const title = en ? "ESP32-C6 Zigbee — physical bench" : "ESP32-C6 Zigbee — prueba física";

  const checkFiles = async () => {
    setBusy(true);
    setError("");
    setPhase(en ? "Verifying all SHA-256 hashes…" : "Verificando todos los SHA-256…");
    try {
      const result = await validateC6ZigbeeBenchFiles(files);
      if (!result.ok) throw new Error(result.reason);
      setValidated(result);
      setPhase(en ? "Three files verified. Ready for manual installation." : "Tres archivos verificados. Listos para instalación manual.");
    } catch (e) {
      setValidated(null);
      setError(e?.message || String(e));
      setPhase("");
    } finally {
      setBusy(false);
    }
  };

  const flashNow = async () => {
    if (!gate.allowed || busy) return;
    setBusy(true);
    setFinished(false);
    setError("");
    setPhase(en ? "Select the correct ESP32-C6 USB port…" : "Seleccioná el puerto USB correcto del ESP32-C6…");
    try {
      const result = await flashC6ZigbeeBenchPackage(validated, {
        profileId,
        connected,
        backupConfirmed: backup,
        eraseAcknowledged: erase,
        secondConfirmation: confirm.trim(),
        onLog,
        onProgress: (progress) => {
          setPct(progress.pct);
          setPhase(en ? "Writing firmware…" : "Grabando firmware…");
        },
      });
      setFinished(result.written);
      setPhase(en
        ? "Written. Unplug/reconnect USB, then click Connect in PyBot to install /pybot modules. Check MicroPython, LCD and Zigbee."
        : "Grabado. Desconectá y reconectá USB. Después usá Conectar en PyBot para instalar /pybot. Probá MicroPython, LCD y Zigbee.");
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      setPhase(en
        ? "No physical success claimed. Follow backup/restore guide if boot fails."
        : "No se confirma funcionamiento físico. Si falla el arranque, consultá la guía de recuperación.");
      onLog?.("PYBOT_C6_ZIGBEE:ERROR " + msg);
    } finally {
      setBusy(false);
    }
  };

  const lineStyle = { display: "block", marginBottom: 12 };
  return (
    <div className="modal-back" role="presentation" data-testid="lab-c6-zigbee-bench-modal">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="c6-zigbee-bench-title"
        style={{ maxWidth: 610, width: "calc(100% - 28px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="modal-header">
          <h3 id="c6-zigbee-bench-title" className="modal-title">{title}</h3>
          <button type="button" disabled={busy} onClick={onClose} aria-label={en ? "Close" : "Cerrar"}>
            ×
          </button>
        </div>
        <div className="modal-body" style={{ padding: 20 }}>
          <p style={lineStyle}>
            {en
              ? "Experimental build 0.1.0 for Waveshare ESP32-C6-LCD-1.47 ONLY. Flashing replaces existing MicroPython and erases saved files. Hardware operation is NOT verified."
              : "Versión experimental 0.1.0 SOLO para Waveshare ESP32-C6-LCD-1.47. La instalación reemplaza MicroPython y borra archivos guardados. El funcionamiento físico NO está verificado."}
          </p>
          <p style={lineStyle}>
            <a href={C6_ZIGBEE_BENCH_PACKAGE.sourceArtifact} target="_blank" rel="noopener noreferrer">
              {en ? "Download the authenticated GitHub firmware package" : "Descargar el paquete de firmware de GitHub"}
            </a>
            <span> — {en ? "unzip and select the three .bin files" : "extraé el ZIP y seleccioná los tres archivos .bin"}</span>
          </p>
          <label style={lineStyle}>
            <strong>{en ? "1. Select three .bin files" : "1. Seleccioná tres archivos .bin"}</strong>
            <input
              type="file"
              multiple
              accept=".bin"
              disabled={busy || finished}
              data-testid="lab-c6-zigbee-bench-files"
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                setValidated(null);
                setError("");
                setPct(0);
              }}
              style={{ display: "block", marginTop: 6, maxWidth: "100%" }}
            />
          </label>
          <button
            type="button"
            className="toolbar-menu-item toolbar-menu-item--secondary"
            disabled={busy || files.length !== 3 || finished}
            onClick={checkFiles}
            data-testid="lab-c6-zigbee-bench-verify"
          >
            {en ? "Verify SHA-256 and board layout" : "Verificar SHA-256 y distribución de memoria"}
          </button>
          {packageReady ? (
            <p role="status" data-testid="lab-c6-zigbee-bench-verified">
              {en ? "All three hashes verified. Offsets: 0x0, 0x8000, 0x10000." : "Los tres hashes coinciden. Direcciones: 0x0, 0x8000, 0x10000."}
            </p>
          ) : null}
          <hr style={{ margin: "16px 0" }} />
          <label style={lineStyle}>
            <input type="checkbox" checked={backup} disabled={busy || finished} onChange={(e) => setBackup(e.target.checked)} />
            {" "}{en ? "2. I backed up main.py, boot.py, /pybot and my flash or stock recovery image." : "2. Guardé main.py, boot.py, /pybot y el respaldo de flash o firmware original."}
          </label>
          <label style={lineStyle}>
            <input type="checkbox" checked={erase} disabled={busy || finished} onChange={(e) => setErase(e.target.checked)} />
            {" "}{en ? "3. I understand ALL 4 MB flash may be erased and this might require BOOT/RESET recovery." : "3. Entiendo que puede borrarse toda la flash de 4 MB y que podría necesitar recuperación con BOOT/RESET."}
          </label>
          <label style={lineStyle}>
            {en ? "4. Type ESP32-C6 to confirm a second time" : "4. Escribí ESP32-C6 como segunda confirmación"}
            <input
              type="text"
              aria-label={en ? "Double confirmation" : "Segunda confirmación"}
              placeholder="ESP32-C6"
              value={confirm}
              disabled={busy || finished}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ display: "block", marginTop: 6, width: "100%", maxWidth: 200 }}
            />
          </label>
          <p style={lineStyle}>{en ? "Use desktop Chrome or Edge with Web Serial; disconnect from PyBot before flashing." : "Usá Chrome o Edge de escritorio con Web Serial y desconectá la placa de PyBot antes de grabar."}</p>
          <button
            type="button"
            className="toolbar-menu-item toolbar-menu-item--highlight"
            data-testid="lab-c6-zigbee-bench-flash"
            disabled={!gate.allowed || busy || finished}
            onClick={flashNow}
          >
            {busy
              ? (en ? "Working…" : "Procesando…")
              : (en ? "Flash experimental Zigbee firmware (manual)" : "Instalar firmware Zigbee experimental (manual)")}
          </button>
          {busy && pct > 0 ? <p role="status">{pct}%</p> : null}
          {phase ? <p role="status" style={{ marginTop: 12 }}>{phase}</p> : null}
          {error ? <p role="alert" style={{ color: "var(--color-error, #b42318)" }}>{error}</p> : null}
          {finished ? <p role="status">{en ? "Installation finished; physical functionality STILL UNVERIFIED." : "Instalación finalizada; funcionamiento físico TODAVÍA NO VERIFICADO."}</p> : null}
        </div>
        <div className="modal-footer" style={{ padding: 12 }}>
          <button type="button" disabled={busy} onClick={onClose}>{en ? "Close" : "Cerrar"}</button>
        </div>
      </div>
    </div>
  );
}
