import { useEffect, useState } from "react";
import { getLang } from "./i18n.js";
import {
  C6_ZIGBEE_BENCH_PACKAGE,
  C6_ZIGBEE_BENCH_UI_LABEL,
  C6_ZIGBEE_BENCH_DISTRIBUTION,
  C6_ZIGBEE_BENCH_POST_FLASH_CHECKS,
  C6_FULL_FLASH_BYTES,
  validateC6ZigbeeBenchFiles,
  assertC6ZigbeeBenchFlashConsent,
  detectC6ZigbeeBenchTarget,
  backupC6ZigbeeBenchFlash,
  flashC6ZigbeeBenchPackage,
  resolveC6ZigbeeBenchPackageFetch,
} from "./esp32UniversalLab/runtime/c6ZigbeeBench.js";

/**
 * Guided Preparar e instalar for Waveshare ESP32-C6-LCD-1.47 private bench.
 * Does not auto-fetch private binaries, auto-flash, or mark Zigbee hardware verified.
 */
export default function C6ZigbeeBenchModal({ open, onClose, onLog, profileId, connected }) {
  const [files, setFiles] = useState([]);
  const [validated, setValidated] = useState(null);
  const [detection, setDetection] = useState(null);
  const [backupResult, setBackupResult] = useState(null);
  const [backupAck, setBackupAck] = useState(false);
  const [erase, setErase] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [pct, setPct] = useState(0);
  const [finished, setFinished] = useState(false);
  const [postChecks, setPostChecks] = useState(null);
  const en = getLang() === "en";
  const distribution = resolveC6ZigbeeBenchPackageFetch();

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setValidated(null);
    setDetection(null);
    setBackupResult(null);
    setBackupAck(false);
    setErase(false);
    setConfirm("");
    setBusy(false);
    setError("");
    setPhase("");
    setPct(0);
    setFinished(false);
    setPostChecks(null);
  }, [open]);

  if (!open) return null;
  const packageReady = validated?.ok === true;
  const gate = assertC6ZigbeeBenchFlashConsent({
    validated,
    profileId,
    connected,
    detection,
    backupResult,
    backupDownloadAcknowledged: backupAck,
    eraseAcknowledged: erase,
    secondConfirmation: confirm.trim(),
  });
  const needsBackupAck =
    backupResult?.ok === true && backupResult.downloadConfirmed !== true;

  const runDetect = async () => {
    setBusy(true);
    setError("");
    setPhase(en ? "Select the ESP32-C6 USB port for detection…" : "Seleccioná el puerto USB del ESP32-C6 para detectar…");
    try {
      const result = await detectC6ZigbeeBenchTarget({ onLog });
      if (!result.ok) {
        setDetection(result);
        throw new Error(result.reason || "BENCH_DETECTION_REQUIRED");
      }
      setDetection(result);
      setPhase(en
        ? `Detected ${result.chipName}, flash ${result.flashSize}.`
        : `Detectado ${result.chipName}, flash ${result.flashSize}.`);
    } catch (e) {
      setDetection(null);
      setError(e?.message || String(e));
      setPhase(en
        ? "Detection failed — install will not proceed."
        : "Detección fallida — la instalación no continúa.");
    } finally {
      setBusy(false);
    }
  };

  const checkFiles = async () => {
    setBusy(true);
    setError("");
    setPhase(en ? "Verifying all SHA-256 hashes…" : "Verificando todos los SHA-256…");
    try {
      const result = await validateC6ZigbeeBenchFiles(files);
      if (!result.ok) throw new Error(result.reason);
      setValidated(result);
      setPhase(en
        ? "Three files verified (0x0, 0x8000, 0x10000). Ready for backup."
        : "Tres archivos verificados (0x0, 0x8000, 0x10000). Listo para respaldo.");
    } catch (e) {
      setValidated(null);
      setError(e?.message || String(e));
      setPhase("");
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async () => {
    if (!detection?.ok || !packageReady || busy) return;
    setBusy(true);
    setError("");
    setBackupAck(false);
    setPhase(en
      ? "Select the correct port, then save the full 4 MB backup locally…"
      : "Seleccioná el puerto correcto y guardá el respaldo completo de 4 MB…");
    try {
      const result = await backupC6ZigbeeBenchFlash({
        onLog,
        onProgress: (progress) => {
          setPct(progress.pct || 0);
          setPhase(en ? "Reading full 4 MB flash…" : "Leyendo flash completa de 4 MB…");
        },
      });
      if (!result.ok) throw new Error(result.reason || "BENCH_BACKUP_INCOMPLETE");
      setBackupResult(result);
      setDetection(result.detection || detection);
      setPct(100);
      setPhase(result.downloadConfirmed
        ? (en
          ? `Backup saved (${result.byteLength} bytes). /main.py, /boot.py, /pybot/assets preserved in the full image.`
          : `Respaldo guardado (${result.byteLength} bytes). /main.py, /boot.py, /pybot/assets quedan en la imagen completa.`)
        : (en
          ? `Backup read OK (${result.byteLength} bytes). Browser cannot confirm download completion — acknowledge the saved file.`
          : `Lectura OK (${result.byteLength} bytes). El navegador no confirma la descarga — confirmá el archivo guardado.`));
    } catch (e) {
      setBackupResult(null);
      const msg = e?.message || String(e);
      const missing = e?.missingCapability;
      setError(missing
        ? `${msg} — missing capability: ${missing}. Firmware installation fail-closed.`
        : msg);
      setPhase(en
        ? "Backup/recovery capability missing or failed — install blocked."
        : "Falta o falló la capacidad de respaldo/recuperación — instalación bloqueada.");
      onLog?.("PYBOT_C6_ZIGBEE:BACKUP_FAIL " + msg);
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
        detection,
        backupResult,
        backupDownloadAcknowledged: backupAck,
        eraseAcknowledged: erase,
        secondConfirmation: confirm.trim(),
        onLog,
        onProgress: (progress) => {
          setPct(progress.pct);
          setPhase(en ? "Writing firmware…" : "Grabando firmware…");
        },
      });
      setFinished(result.written);
      setPostChecks(result.postFlashChecks || C6_ZIGBEE_BENCH_POST_FLASH_CHECKS);
      setPhase(en
        ? "Written. Unplug/reconnect USB, then Connect in PyBot. If boot fails: BOOT/RESET and restore the 4 MB backup with esptool read_flash inverse (write_flash 0 backup.bin)."
        : "Grabado. Desconectá/reconectá USB y usá Conectar en PyBot. Si no arranca: BOOT/RESET y restaurá el respaldo 4 MB con esptool (write_flash 0 respaldo.bin).");
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      setPhase(en
        ? "No physical success claimed. Use the verified 4 MB backup for recovery if needed."
        : "No se confirma funcionamiento físico. Usá el respaldo 4 MB verificado para recuperar si hace falta.");
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
        style={{ maxWidth: 640, width: "calc(100% - 28px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="modal-header">
          <h3 id="c6-zigbee-bench-title" className="modal-title">{C6_ZIGBEE_BENCH_UI_LABEL}</h3>
          <button type="button" disabled={busy} onClick={onClose} aria-label={en ? "Close" : "Cerrar"}>
            ×
          </button>
        </div>
        <div className="modal-body" style={{ padding: 20 }}>
          <p style={lineStyle}>
            {en
              ? "Guided experimental install 0.1.0 for Waveshare ESP32-C6-LCD-1.47 ONLY. Replaces MicroPython and erases saved files. Hardware operation is NOT verified. No automatic flash."
              : "Instalación guiada experimental 0.1.0 SOLO para Waveshare ESP32-C6-LCD-1.47. Reemplaza MicroPython y borra archivos. Funcionamiento físico NO verificado. Sin flash automático."}
          </p>

          <p
            role="status"
            data-testid="lab-c6-zigbee-bench-decision-required"
            style={{ ...lineStyle, whiteSpace: "pre-wrap", fontFamily: "inherit" }}
          >
            <strong>DECISION REQUIRED</strong>
            {"\n"}
            {en
              ? "Automatic package download is not supported securely with current infrastructure."
              : "La descarga automática del paquete no se puede hacer de forma segura con la infraestructura actual."}
            {"\n"}
            {distribution.blockers.map((b, i) => `• ${b}`).join("\n")}
            {"\n"}
            {en ? "Alternatives:" : "Alternativas:"}
            {"\n"}
            {distribution.alternatives.map((a) => `• ${a}`).join("\n")}
            {"\n"}
            {en
              ? `Pinned private artifact (operator-authenticated GitHub only): run ${C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId} / artifact ${C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId}. Do not publish binaries publicly. Respect THIRD_PARTY_NOTICES / zboss terms.`
              : `Artefacto privado anclado (solo GitHub autenticado del operador): run ${C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId} / artifact ${C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId}. No publicar binarios. Respetar THIRD_PARTY_NOTICES / términos zboss.`}
          </p>
          <p style={lineStyle} data-testid="lab-c6-zigbee-bench-distribution-status">
            {C6_ZIGBEE_BENCH_DISTRIBUTION.status}
          </p>

          <hr style={{ margin: "16px 0" }} />
          <p style={lineStyle}>
            <strong>{en ? "1. Detect ESP32-C6 and 4 MB flash" : "1. Detectar ESP32-C6 y flash de 4 MB"}</strong>
          </p>
          <button
            type="button"
            className="toolbar-menu-item toolbar-menu-item--secondary"
            disabled={busy || finished}
            onClick={runDetect}
            data-testid="lab-c6-zigbee-bench-detect"
          >
            {en ? "Detect board" : "Detectar placa"}
          </button>
          {detection?.ok ? (
            <p role="status" data-testid="lab-c6-zigbee-bench-detected">
              {detection.chipName} / {detection.flashSize} ({C6_FULL_FLASH_BYTES} bytes)
            </p>
          ) : null}

          <hr style={{ margin: "16px 0" }} />
          <label style={lineStyle}>
            <strong>
              {en
                ? "2. Load the three verified .bin files from the private #555 package (interim path C)"
                : "2. Cargá los tres .bin verificados del paquete privado #555 (alternativa C)"}
            </strong>
            <input
              type="file"
              multiple
              accept=".bin"
              disabled={busy || finished || !detection?.ok}
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
            disabled={busy || files.length !== 3 || finished || !detection?.ok}
            onClick={checkFiles}
            data-testid="lab-c6-zigbee-bench-verify"
          >
            {en ? "Verify SHA-256 and offsets" : "Verificar SHA-256 y offsets"}
          </button>
          {packageReady ? (
            <p role="status" data-testid="lab-c6-zigbee-bench-verified">
              {en ? "All three hashes verified. Offsets: 0x0, 0x8000, 0x10000." : "Los tres hashes coinciden. Direcciones: 0x0, 0x8000, 0x10000."}
            </p>
          ) : null}

          <hr style={{ margin: "16px 0" }} />
          <p style={lineStyle}>
            <strong>
              {en
                ? "3. Full 4 MB backup to a local file (required before erase)"
                : "3. Respaldo completo de 4 MB a un archivo local (obligatorio antes de borrar)"}
            </strong>
          </p>
          <button
            type="button"
            className="toolbar-menu-item toolbar-menu-item--secondary"
            disabled={busy || finished || !detection?.ok || !packageReady}
            onClick={runBackup}
            data-testid="lab-c6-zigbee-bench-backup"
          >
            {en ? "Back up 4 MB flash" : "Respaldar flash 4 MB"}
          </button>
          {backupResult?.ok ? (
            <p role="status" data-testid="lab-c6-zigbee-bench-backup-ok">
              {backupResult.fileName} — {backupResult.byteLength} bytes
              {backupResult.downloadConfirmed ? (en ? " (save confirmed)" : " (guardado confirmado)") : ""}
            </p>
          ) : null}
          {needsBackupAck ? (
            <label style={lineStyle} data-testid="lab-c6-zigbee-bench-backup-ack-wrap">
              <input
                type="checkbox"
                checked={backupAck}
                disabled={busy || finished}
                onChange={(e) => setBackupAck(e.target.checked)}
                data-testid="lab-c6-zigbee-bench-backup-ack"
              />
              {" "}
              {en
                ? "I verified the 4 MB backup file was saved externally. Limitation: the browser cannot confirm download completion for this save method."
                : "Verifiqué que el respaldo de 4 MB quedó guardado fuera de la placa. Limitación: el navegador no puede confirmar la descarga con este método."}
            </label>
          ) : null}

          <hr style={{ margin: "16px 0" }} />
          <label style={lineStyle}>
            <input type="checkbox" checked={erase} disabled={busy || finished} onChange={(e) => setErase(e.target.checked)} />
            {" "}{en ? "4. I understand ALL 4 MB flash will be erased and BOOT/RESET recovery may be required." : "4. Entiendo que se borrará toda la flash de 4 MB y que podría necesitar recuperación con BOOT/RESET."}
          </label>
          <label style={lineStyle}>
            {en ? "5. Type ESP32-C6 to confirm destructive install" : "5. Escribí ESP32-C6 para confirmar la instalación destructiva"}
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
          <p style={lineStyle}>
            {en
              ? "Use desktop Chrome or Edge with Web Serial; disconnect from PyBot before flashing. You will pick the port again — choose the correct ESP32-C6."
              : "Usá Chrome o Edge de escritorio con Web Serial y desconectá la placa de PyBot. Vas a elegir el puerto otra vez — el ESP32-C6 correcto."}
          </p>
          <button
            type="button"
            className="toolbar-menu-item toolbar-menu-item--highlight"
            data-testid="lab-c6-zigbee-bench-flash"
            disabled={!gate.allowed || busy || finished}
            onClick={flashNow}
          >
            {busy
              ? (en ? "Working…" : "Procesando…")
              : C6_ZIGBEE_BENCH_UI_LABEL}
          </button>
          {busy && pct > 0 ? <p role="status">{pct}%</p> : null}
          {phase ? <p role="status" style={{ marginTop: 12 }}>{phase}</p> : null}
          {error ? <p role="alert" style={{ color: "var(--color-error, #b42318)" }}>{error}</p> : null}
          {finished ? (
            <div data-testid="lab-c6-zigbee-bench-finished">
              <p role="status">
                {en
                  ? "Installation finished; physical functionality STILL UNVERIFIED."
                  : "Instalación finalizada; funcionamiento físico TODAVÍA NO VERIFICADO."}
              </p>
              <ul data-testid="lab-c6-zigbee-bench-post-checks">
                {(postChecks || C6_ZIGBEE_BENCH_POST_FLASH_CHECKS).map((item) => (
                  <li key={item.id}>
                    {item.label}: <strong>{item.status}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="modal-footer" style={{ padding: 12 }}>
          <button type="button" disabled={busy} onClick={onClose}>{en ? "Close" : "Cerrar"}</button>
        </div>
      </div>
    </div>
  );
}
