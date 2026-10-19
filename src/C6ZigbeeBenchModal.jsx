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
  describeC6ZigbeeBenchGateReason,
} from "./esp32UniversalLab/runtime/c6ZigbeeBench.js";

/**
 * Guided Preparar e instalar for Waveshare ESP32-C6-LCD-1.47 private bench.
 * Compact 4-step flow. Does not auto-fetch private binaries, auto-flash,
 * or mark Zigbee hardware verified. Distinct from ESP-IDF coordinator mode.
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
  const [showDistDetail, setShowDistDetail] = useState(false);
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
    setShowDistDetail(false);
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
  const gateHint =
    !gate.allowed && !finished
      ? describeC6ZigbeeBenchGateReason(gate.reason, en ? "en" : "es")
      : "";

  const stepStatus = (done, active) => {
    if (done) return en ? "done" : "listo";
    if (active) return en ? "current" : "actual";
    return en ? "pending" : "pendiente";
  };
  const step1Done = detection?.ok === true;
  const step2Done = packageReady;
  const step3Done = backupResult?.ok === true && (!needsBackupAck || backupAck);
  const step4Active = step1Done && step2Done && step3Done;

  const runDetect = async () => {
    setBusy(true);
    setError("");
    setPhase(en ? "Select the ESP32-C6 USB port…" : "Seleccioná el puerto USB del ESP32-C6…");
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
        ? "Three files verified (0x0, 0x8000, 0x10000)."
        : "Tres archivos verificados (0x0, 0x8000, 0x10000).");
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
      ? "Select the port, then save the full 4 MB backup…"
      : "Seleccioná el puerto y guardá el respaldo completo de 4 MB…");
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
          ? `Backup saved (${result.byteLength} bytes).`
          : `Respaldo guardado (${result.byteLength} bytes).`)
        : (en
          ? `Backup read OK (${result.byteLength} bytes). Acknowledge the saved file.`
          : `Lectura OK (${result.byteLength} bytes). Confirmá el archivo guardado.`));
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
        ? "Written. Unplug/reconnect USB, then Connect in PyBot. Recovery: write_flash 0 backup.bin."
        : "Grabado. Desconectá/reconectá USB y usá Conectar en PyBot. Recuperación: write_flash 0 respaldo.bin.");
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      setPhase(en
        ? "No physical success claimed. Use the verified 4 MB backup if needed."
        : "No se confirma funcionamiento físico. Usá el respaldo 4 MB si hace falta.");
      onLog?.("PYBOT_C6_ZIGBEE:ERROR " + msg);
    } finally {
      setBusy(false);
    }
  };

  const stepBox = {
    border: "1px solid var(--ide-border-subtle, #ddd)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 10,
  };
  const stepMeta = { fontSize: 11, color: "var(--fg-muted)", marginBottom: 6 };
  const compactP = { margin: "0 0 8px", fontSize: 13, lineHeight: 1.4 };

  return (
    <div className="modal-back" role="presentation" data-testid="lab-c6-zigbee-bench-modal">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="c6-zigbee-bench-title"
        style={{ maxWidth: 560, width: "calc(100% - 28px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="modal-header">
          <h3 id="c6-zigbee-bench-title" className="modal-title">{C6_ZIGBEE_BENCH_UI_LABEL}</h3>
          <button type="button" disabled={busy} onClick={onClose} aria-label={en ? "Close" : "Cerrar"}>
            ×
          </button>
        </div>
        <div className="modal-body" style={{ padding: 16 }}>
          <p style={compactP} data-testid="lab-c6-zigbee-bench-path-label">
            {en
              ? "MicroPython + native Zigbee (_uzigbee) for Waveshare ESP32-C6-LCD-1.47 — not the ESP-IDF coordinator host path."
              : "MicroPython + Zigbee nativo (_uzigbee) para Waveshare ESP32-C6-LCD-1.47 — no es el coordinador ESP-IDF host."}
          </p>

          <div
            role="status"
            data-testid="lab-c6-zigbee-bench-decision-required"
            style={{
              ...stepBox,
              background: "var(--ide-elevated, #f6f7f9)",
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            <strong data-testid="lab-c6-zigbee-bench-distribution-status">
              {C6_ZIGBEE_BENCH_DISTRIBUTION.status}
            </strong>
            {" — "}
            {en
              ? "Automatic secure download unavailable."
              : "Descarga automática segura no disponible."}
            <button
              type="button"
              className="toolbar-menu-item toolbar-menu-item--secondary"
              style={{ display: "inline", marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
              onClick={() => setShowDistDetail((v) => !v)}
              data-testid="lab-c6-zigbee-bench-dist-toggle"
            >
              {showDistDetail ? (en ? "Hide details" : "Ocultar detalle") : (en ? "Why / alternatives" : "Por qué / alternativas")}
            </button>
            {showDistDetail ? (
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                {distribution.blockers.map((b) => `• ${b}`).join("\n")}
                {"\n"}
                {en ? "Alternatives:" : "Alternativas:"}
                {"\n"}
                {distribution.alternatives.map((a) => `• ${a}`).join("\n")}
                {"\n"}
                {en
                  ? `Pinned private artifact: run ${C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId} / artifact ${C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId}. Respect THIRD_PARTY_NOTICES / zboss terms.`
                  : `Artefacto privado anclado: run ${C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId} / artifact ${C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId}. Respetar THIRD_PARTY_NOTICES / términos zboss.`}
              </div>
            ) : null}
          </div>

          <div style={stepBox} data-testid="lab-c6-zigbee-bench-step-1">
            <div style={stepMeta}>
              1/4 · {en ? "Detect C6 + 4 MB" : "Detectar C6 + 4 MB"} · {stepStatus(step1Done, !step1Done)}
            </div>
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
              <p role="status" data-testid="lab-c6-zigbee-bench-detected" style={{ ...compactP, marginTop: 8, marginBottom: 0 }}>
                {detection.chipName} / {detection.flashSize} ({C6_FULL_FLASH_BYTES} bytes)
              </p>
            ) : null}
          </div>

          <div style={stepBox} data-testid="lab-c6-zigbee-bench-step-2">
            <div style={stepMeta}>
              2/4 · {en ? "Load & verify 3× .bin (#555)" : "Cargar y verificar 3× .bin (#555)"} · {stepStatus(step2Done, step1Done && !step2Done)}
            </div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
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
                style={{ display: "block", marginTop: 4, maxWidth: "100%" }}
              />
            </label>
            <button
              type="button"
              className="toolbar-menu-item toolbar-menu-item--secondary"
              disabled={busy || files.length !== 3 || finished || !detection?.ok}
              onClick={checkFiles}
              data-testid="lab-c6-zigbee-bench-verify"
            >
              {en ? "Verify SHA-256" : "Verificar SHA-256"}
            </button>
            {packageReady ? (
              <p role="status" data-testid="lab-c6-zigbee-bench-verified" style={{ ...compactP, marginTop: 8, marginBottom: 0 }}>
                {en ? "Hashes OK · 0x0, 0x8000, 0x10000" : "Hashes OK · 0x0, 0x8000, 0x10000"}
              </p>
            ) : null}
          </div>

          <div style={stepBox} data-testid="lab-c6-zigbee-bench-step-3">
            <div style={stepMeta}>
              3/4 · {en ? "Full 4 MB backup" : "Respaldo completo 4 MB"} · {stepStatus(step3Done, step2Done && !step3Done)}
            </div>
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
              <p role="status" data-testid="lab-c6-zigbee-bench-backup-ok" style={{ ...compactP, marginTop: 8 }}>
                {backupResult.fileName} — {backupResult.byteLength} bytes
                {backupResult.downloadConfirmed ? (en ? " (save confirmed)" : " (guardado confirmado)") : ""}
              </p>
            ) : null}
            {needsBackupAck ? (
              <label style={{ display: "block", fontSize: 13 }} data-testid="lab-c6-zigbee-bench-backup-ack-wrap">
                <input
                  type="checkbox"
                  checked={backupAck}
                  disabled={busy || finished}
                  onChange={(e) => setBackupAck(e.target.checked)}
                  data-testid="lab-c6-zigbee-bench-backup-ack"
                />
                {" "}
                {en
                  ? "I verified the 4 MB backup file was saved (browser cannot confirm this download)."
                  : "Verifiqué que el respaldo de 4 MB quedó guardado (el navegador no confirma esta descarga)."}
              </label>
            ) : null}
          </div>

          <div style={stepBox} data-testid="lab-c6-zigbee-bench-step-4">
            <div style={stepMeta}>
              4/4 · {en ? "Confirm & install" : "Confirmar e instalar"} · {stepStatus(finished, step4Active && !finished)}
            </div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={erase} disabled={busy || finished} onChange={(e) => setErase(e.target.checked)} />
              {" "}
              {en
                ? "I understand ALL 4 MB will be erased; BOOT/RESET recovery may be required."
                : "Entiendo que se borrará toda la flash de 4 MB; podría necesitar BOOT/RESET."}
            </label>
            <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
              {en ? "Type ESP32-C6 to confirm" : "Escribí ESP32-C6 para confirmar"}
              <input
                type="text"
                aria-label={en ? "Double confirmation" : "Segunda confirmación"}
                placeholder="ESP32-C6"
                value={confirm}
                disabled={busy || finished}
                onChange={(e) => setConfirm(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", maxWidth: 200 }}
              />
            </label>
            {gateHint ? (
              <p role="status" data-testid="lab-c6-zigbee-bench-gate-hint" style={{ ...compactP, color: "var(--fg-muted)" }}>
                {gateHint}
              </p>
            ) : null}
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
          </div>

          {busy && pct > 0 ? <p role="status">{pct}%</p> : null}
          {phase ? <p role="status" style={{ fontSize: 13, marginTop: 4 }}>{phase}</p> : null}
          {error ? <p role="alert" style={{ color: "var(--color-error, #b42318)", fontSize: 13 }}>{error}</p> : null}
          {finished ? (
            <div data-testid="lab-c6-zigbee-bench-finished">
              <p role="status" style={compactP}>
                {en
                  ? "Written; physical functionality STILL UNVERIFIED."
                  : "Grabado; funcionamiento físico TODAVÍA NO VERIFICADO."}
              </p>
              <ul data-testid="lab-c6-zigbee-bench-post-checks" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
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
