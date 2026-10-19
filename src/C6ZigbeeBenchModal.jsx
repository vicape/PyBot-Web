import { useEffect, useState } from "react";
import { getLang } from "./i18n.js";
import {
  C6_ZIGBEE_BENCH_UI_LABEL,
  C6_ZIGBEE_BENCH_POST_FLASH_CHECKS,
  C6_ZIGBEE_BENCH_PROGRESS_STAGES,
  orchestrateC6ZigbeeBenchOneClick,
  describeC6ZigbeeBenchGateReason,
} from "./esp32UniversalLab/runtime/c6ZigbeeBench.js";

/**
 * One-click Instalar firmware for Waveshare ESP32-C6-LCD-1.47 private bench.
 * Same simplicity as stock MicroPython C6 flash: one CTA → authenticated fetch/SHA
 * → WebSerial flash. No backup picker, Continuar, or multi-stage confirm buttons.
 */
export default function C6ZigbeeBenchModal({ open, onClose, onLog, profileId, connected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [finished, setFinished] = useState(false);
  const [postChecks, setPostChecks] = useState(null);
  const en = getLang() === "en";

  const resetUi = () => {
    setBusy(false);
    setError("");
    setPhase("");
    setPct(0);
    setStage("");
    setFinished(false);
    setPostChecks(null);
  };

  useEffect(() => {
    if (!open) return;
    resetUi();
  }, [open]);

  if (!open) return null;

  const stageIndex = C6_ZIGBEE_BENCH_PROGRESS_STAGES.findIndex((s) => s.id === stage);
  const activeIndex = stage === "done" ? C6_ZIGBEE_BENCH_PROGRESS_STAGES.length - 1 : stageIndex;

  const resolveErrorMessage = (result) => {
    const hint = describeC6ZigbeeBenchGateReason(result.reason, en ? "en" : "es");
    const parts = [hint || result.reason || (en ? "Install blocked." : "Instalación bloqueada.")];
    if (result.reason === "BENCH_OPERATOR_SETUP_REQUIRED" && result.detail) {
      parts.push(result.detail);
    }
    return parts.join("\n");
  };

  const startOneClick = async () => {
    if (busy || finished) return;
    setBusy(true);
    setError("");
    setFinished(false);
    setPostChecks(null);
    setPct(0);
    setStage("fetch");
    setPhase(en
      ? "Getting and verifying firmware…"
      : "Obteniendo y verificando firmware…");
    try {
      const result = await orchestrateC6ZigbeeBenchOneClick({
        profileId,
        connected,
        onLog,
        onProgress: (p) => {
          if (p.stage) setStage(p.stage);
          if (typeof p.pct === "number") setPct(p.pct);
          if (p.phase === "fetch" || p.phase === "mint") {
            setPhase(en ? "Getting firmware from the server…" : "Obteniendo firmware del servidor…");
          } else if (p.phase === "download") {
            setPhase(en ? "Downloading firmware…" : "Descargando firmware…");
          } else if (p.phase === "verify") {
            setPhase(en ? "Verifying firmware…" : "Verificando firmware…");
          } else if (p.phase === "flash" || p.phase === "flash_write") {
            setPhase(en
              ? "Select the USB port when asked, then writing firmware…"
              : "Seleccioná el puerto USB cuando se pida; grabando firmware…");
          } else if (p.phase === "done") {
            setPhase(en
              ? "Written. Unplug/reconnect USB, then Connect in PyBot."
              : "Grabado. Desconectá/reconectá USB y usá Conectar en PyBot.");
          }
        },
      });

      if (!result.ok) {
        setError(resolveErrorMessage(result));
        setPhase(en
          ? "Stopped — install will not continue."
          : "Detenido — la instalación no continúa.");
        onLog?.("PYBOT_C6_ZIGBEE:ONE_CLICK_FAIL " + (result.reason || "unknown"));
        return;
      }

      setFinished(true);
      setPostChecks(result.flashResult?.postFlashChecks || C6_ZIGBEE_BENCH_POST_FLASH_CHECKS);
      setPct(100);
      setStage("done");
      setPhase(en
        ? "Written. Unplug/reconnect USB, then Connect in PyBot."
        : "Grabado. Desconectá/reconectá USB y usá Conectar en PyBot.");
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      setPhase(en
        ? "Stopped — install will not continue."
        : "Detenido — la instalación no continúa.");
      onLog?.("PYBOT_C6_ZIGBEE:ERROR " + msg);
    } finally {
      setBusy(false);
    }
  };

  const compactP = { margin: "0 0 8px", fontSize: 13, lineHeight: 1.4 };
  const progressTrack = {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
    listStyle: "none",
    padding: 0,
    margin: "0 0 12px",
  };
  const chipBase = {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid var(--ide-border-subtle, #ddd)",
    color: "var(--fg-muted)",
    background: "transparent",
  };

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
              ? "MicroPython + native Zigbee for Waveshare ESP32-C6-LCD-1.47 — not the ESP-IDF coordinator host path."
              : "MicroPython + Zigbee nativo para Waveshare ESP32-C6-LCD-1.47 — no es el coordinador ESP-IDF host."}
          </p>
          <p style={{ ...compactP, fontSize: 12, color: "var(--fg-muted)" }} data-testid="lab-c6-zigbee-bench-notices">
            {en
              ? "Private authenticated bench (experimental; hardware UNVERIFIED). See THIRD_PARTY_NOTICES for redistribution conditions."
              : "Banco privado autenticado (experimental; hardware UNVERIFIED). Ver THIRD_PARTY_NOTICES para condiciones de redistribución."}
          </p>
          <p style={compactP} data-testid="lab-c6-zigbee-bench-erase-notice">
            {en
              ? "Installing replaces the flash image: apps and files already on the board can be erased. Authorize the USB port when the browser asks."
              : "La instalación reemplaza la imagen en flash: las apps y archivos de la placa pueden borrarse. Autorizá el puerto USB cuando el navegador lo pida."}
          </p>

          <ol
            style={progressTrack}
            data-testid="lab-c6-zigbee-bench-progress-stages"
            aria-label={en ? "Install progress" : "Progreso de instalación"}
          >
            {C6_ZIGBEE_BENCH_PROGRESS_STAGES.map((item, idx) => {
              const done = finished || (activeIndex >= 0 && idx < activeIndex);
              const current = !finished && activeIndex === idx;
              return (
                <li
                  key={item.id}
                  data-testid={`lab-c6-zigbee-bench-stage-${item.id}`}
                  data-state={done ? "done" : current ? "current" : "pending"}
                  style={{
                    ...chipBase,
                    borderColor: current || done ? "var(--accent, #2563eb)" : chipBase.border,
                    color: current || done ? "var(--fg, inherit)" : chipBase.color,
                    fontWeight: current ? 600 : 400,
                  }}
                >
                  {idx + 1}. {en ? item.en : item.es}
                </li>
              );
            })}
          </ol>

          {(busy || pct > 0) ? (
            <div data-testid="lab-c6-zigbee-bench-progress" role="status" aria-live="polite" style={{ marginBottom: 10 }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: "var(--ide-border-subtle, #e5e5e5)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, pct))}%`,
                    height: "100%",
                    background: "var(--accent, #2563eb)",
                    transition: "width 160ms linear",
                  }}
                />
              </div>
              <p style={{ ...compactP, marginTop: 6, marginBottom: 0 }}>{pct}%</p>
            </div>
          ) : null}

          {phase ? (
            <p role="status" data-testid="lab-c6-zigbee-bench-phase" style={{ fontSize: 13, marginTop: 4 }}>
              {phase}
            </p>
          ) : null}

          {error ? (
            <p role="alert" data-testid="lab-c6-zigbee-bench-error" style={{ color: "var(--color-error, #b42318)", fontSize: 13, whiteSpace: "pre-wrap" }}>
              {error}
            </p>
          ) : null}

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
        <div className="modal-footer" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" disabled={busy} onClick={onClose}>{en ? "Close" : "Cerrar"}</button>
          {!finished ? (
            <button
              type="button"
              className="toolbar-menu-item toolbar-menu-item--highlight"
              data-testid="lab-c6-zigbee-bench-start"
              disabled={busy}
              onClick={startOneClick}
            >
              {busy
                ? (en ? "Working…" : "Procesando…")
                : C6_ZIGBEE_BENCH_UI_LABEL}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
