import { useState, useCallback, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import "./PyBotIDE.css";
import { DEFAULT_CODE, EXAMPLES } from "./examplesData.js";
import { t, getLang, setLang, formatHardwareError } from "./i18n.js";
import {
  hardwareConnect,
  hardwareDisconnect,
  hardwareIsConnected,
  hardwareBaudRate,
} from "./hardwareBridge.js";
import { runPythonAsync, signalStop } from "./pyodideRunner.js";
import {
  IconExplorer,
  IconPlay,
  IconSquare,
  IconUsb,
  IconSettings,
  IconHelp,
  IconTrash,
  IconPlug,
  IconChevron,
  IconInfo,
  IconPyBot,
} from "./ideIcons.jsx";

function labelForExample(ex) {
  return getLang() === "en" ? ex.keyEn : ex.keyEs;
}

export default function PyBotIDE() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("pybot_theme") || "dark",
  );
  const [contrast, setContrast] = useState(
    () => localStorage.getItem("pybot_contrast") || "normal",
  );
  const [code, setCode] = useState(
    () => localStorage.getItem("pybot_code") || DEFAULT_CODE,
  );
  const [consoleLines, setConsoleLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pythonOnly, setPythonOnly] = useState(
    () => localStorage.getItem("pybot_python_only") === "1",
  );
  const [, forceLang] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => parseInt(localStorage.getItem("pybot_sidebar_w") || "248", 10),
  );
  const [consoleHeight, setConsoleHeight] = useState(
    () => parseInt(localStorage.getItem("pybot_console_h") || "220", 10),
  );
  const [consoleWidth, setConsoleWidth] = useState(
    () => parseInt(localStorage.getItem("pybot_console_w") || "360", 10),
  );
  const [terminalPosition, setTerminalPosition] = useState(
    () => localStorage.getItem("pybot_terminal_pos") || "bottom",
  );
  const [fontDelta, setFontDelta] = useState(
    () => parseInt(localStorage.getItem("pybot_font_delta") || "0", 10),
  );
  const [showPybotLogo, setShowPybotLogo] = useState(true);
  const [showSchoolLogo, setShowSchoolLogo] = useState(true);
  const consoleEndRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pybot_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("pybot_contrast", contrast);
  }, [contrast]);

  useEffect(() => {
    localStorage.setItem("pybot_code", code);
  }, [code]);

  useEffect(() => {
    localStorage.setItem("pybot_python_only", pythonOnly ? "1" : "0");
  }, [pythonOnly]);

  useEffect(() => {
    localStorage.setItem("pybot_sidebar_w", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("pybot_console_h", String(consoleHeight));
  }, [consoleHeight]);

  useEffect(() => {
    localStorage.setItem("pybot_console_w", String(consoleWidth));
  }, [consoleWidth]);

  useEffect(() => {
    localStorage.setItem("pybot_terminal_pos", terminalPosition);
  }, [terminalPosition]);

  useEffect(() => {
    localStorage.setItem("pybot_font_delta", String(fontDelta));
  }, [fontDelta]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLines]);

  const appendConsole = useCallback((line, kind = "out") => {
    setConsoleLines((prev) => [...prev.slice(-400), { text: line, kind }]);
  }, []);

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  const onConnect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const { baudRate } = await hardwareConnect();
      setConnected(true);
      appendConsole(`USB OK @ ${baudRate} baud (Firmata)\n`, "info");
    } catch (e) {
      appendConsole(`${formatHardwareError(e?.message)}\n`, "err");
    } finally {
      setConnecting(false);
    }
  }, [connecting, appendConsole]);

  const onDisconnect = useCallback(async () => {
    await hardwareDisconnect();
    setConnected(false);
    appendConsole(t("logDisconnected") + "\n", "info");
  }, [appendConsole]);

  const onRun = useCallback(async () => {
    if (running) return;
    if (!pythonOnly && !hardwareIsConnected()) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    setRunning(true);
    signalStop();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.__PYBOT_STOP__ = false;
    appendConsole(t("pyodideLoad") + "\n", "info");
    try {
      await runPythonAsync(code, {
        onOut: (s) => appendConsole(s, "out"),
        onErr: (s) => appendConsole(s, "err"),
        pythonOnly,
      });
      appendConsole("\n[Fin]\n", "info");
    } catch {
      /* logged */
    } finally {
      setRunning(false);
    }
  }, [running, code, appendConsole, pythonOnly]);

  const onStop = useCallback(() => {
    signalStop();
    appendConsole("\n[Stop solicitado]\n", "info");
  }, [appendConsole]);

  const loadExample = useCallback(
    (ex) => {
      setCode(ex.code);
      appendConsole(`Cargado: ${ex.file}\n`, "info");
    },
    [appendConsole],
  );

  const monacoTheme = theme === "dark" ? "vs-dark" : "light";

  const startSidebarResize = useCallback(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = sidebarWidth;
      const onMove = (ev) => {
        const next = Math.max(180, Math.min(460, startW + (ev.clientX - startX)));
        setSidebarWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  const startConsoleResize = useCallback(
    (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startH = consoleHeight;
      const onMove = (ev) => {
        const next = Math.max(120, Math.min(420, startH - (ev.clientY - startY)));
        setConsoleHeight(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [consoleHeight],
  );

  const startConsoleWidthResize = useCallback(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = consoleWidth;
      const onMove = (ev) => {
        const next = Math.max(260, Math.min(720, startW - (ev.clientX - startX)));
        setConsoleWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [consoleWidth],
  );

  return (
    <div
      className="ide-root"
      data-theme={theme}
      data-contrast={contrast}
      style={{ "--font-delta": `${fontDelta}px` }}
    >
      <div className="ide-workbench">
        <aside className="activity-bar" aria-label="Barra de actividad">
          <button
            type="button"
            className={`act-icon ${sidebarOpen ? "act-icon--active" : ""}`}
            title={t("explorer")}
            aria-label={t("explorer")}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <IconExplorer width={22} height={22} />
          </button>
          <button
            type="button"
            className="act-icon"
            title={t("run")}
            aria-label={t("run")}
            onClick={onRun}
            disabled={running}
          >
            <IconPlay width={22} height={22} />
          </button>
          <button
            type="button"
            className="act-icon"
            title={t("stop")}
            aria-label={t("stop")}
            onClick={onStop}
          >
            <IconSquare width={22} height={22} />
          </button>
          <button
            type="button"
            className={`act-icon ${connected ? "act-icon--connected" : ""}`}
            title={connected ? t("disconnect") : t("connect")}
            aria-label={connected ? t("disconnect") : t("connect")}
            onClick={connected ? onDisconnect : onConnect}
            disabled={connecting}
          >
            {connected ? <IconUsb width={22} height={22} /> : <IconPlug width={22} height={22} />}
          </button>
          <div className="act-spacer" />
          <button
            type="button"
            className="act-icon"
            title={t("settings")}
            aria-label={t("settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <IconSettings width={22} height={22} />
          </button>
        </aside>

        <div className="ide-body">
          {sidebarOpen ? (
            <aside className="sidebar" style={{ width: `${sidebarWidth}px` }}>
              <div className="sidebar-header">
                <span className="sidebar-label">{t("explorer")}</span>
              </div>
              <div className="sidebar-section">
                <div className="sidebar-section-title">{t("examples")}</div>
                <nav className="example-list" aria-label={t("examples")}>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      className="example-item"
                      onClick={() => loadExample(ex)}
                    >
                      <span className="example-item__name">{labelForExample(ex)}</span>
                      <IconChevron
                        className="example-item__chev"
                        width={16}
                        height={16}
                        aria-hidden
                      />
                    </button>
                  ))}
                </nav>
              </div>
            </aside>
          ) : null}
          {sidebarOpen ? (
            <div
              className="splitter splitter-vertical"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startSidebarResize}
            />
          ) : null}

          <div className="main-stack">
            <header className="toolbar">
              <div className="toolbar-brand">
                <div className="brand-mark" aria-hidden>
                  <IconPyBot width={22} height={22} />
                </div>
                <div className="brand-copy">
                  <span className="brand-title">{t("appTitle")}</span>
                  <span className="brand-sub">{t("brandSub")}</span>
                </div>
                <div className="brand-logos">
                  {showPybotLogo ? (
                    <img
                      src="/branding/pybot-logo.png"
                      alt="Logo PyBot"
                      className="brand-logo-img"
                      onError={() => setShowPybotLogo(false)}
                    />
                  ) : null}
                  {showSchoolLogo ? (
                    <img
                      src="/branding/colegio-escudo.png"
                      alt="Escudo del colegio"
                      className="brand-logo-img"
                      onError={() => setShowSchoolLogo(false)}
                    />
                  ) : null}
                </div>
              </div>
              <div className="toolbar-actions">
                <div className="tb-group">
                  <button
                    type="button"
                    className="tb-btn tb-btn--run"
                    onClick={onRun}
                    disabled={running}
                  >
                    <IconPlay width={16} height={16} />
                    {t("run")}
                  </button>
                  <button type="button" className="tb-btn tb-btn--stop" onClick={onStop}>
                    <IconSquare width={16} height={16} />
                    {t("stop")}
                  </button>
                </div>
                <div className="tb-group tb-group--muted">
                  <button
                    type="button"
                    className="tb-btn tb-btn--ghost"
                    onClick={connected ? onDisconnect : onConnect}
                    disabled={connecting || pythonOnly}
                  >
                    {connected ? <IconUsb width={16} height={16} /> : <IconPlug width={16} height={16} />}
                    {connected ? t("disconnect") : t("connect")}
                  </button>
                  <span
                    className={`conn-lamp ${connected ? "conn-lamp--on" : ""}`}
                    title={connected ? t("statusConn") : t("statusDisc")}
                  />
                  <span className={`conn-state ${connected ? "conn-state--on" : ""}`}>
                    {connected ? t("statusConnectedShort") : t("statusDisconnectedShort")}
                  </span>
                  <div className="mode-switch-wrap">
                    <span className="mode-label">{t("modeLabel")}</span>
                    <div className="mode-switch">
                      <button
                        type="button"
                        className={`mode-btn ${!pythonOnly ? "mode-btn--active" : ""}`}
                        onClick={() => setPythonOnly(false)}
                      >
                        {t("modeHardware")}
                      </button>
                      <button
                        type="button"
                        className={`mode-btn ${pythonOnly ? "mode-btn--active" : ""}`}
                        onClick={() => setPythonOnly(true)}
                      >
                        {t("modePythonOnly")}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tb-btn tb-btn--ghost"
                    onClick={() => setHelpOpen(true)}
                  >
                    <IconHelp width={16} height={16} />
                    {t("help")}
                  </button>
                  <button
                    type="button"
                    className="tb-btn tb-btn--ghost"
                    onClick={() => setAboutOpen(true)}
                  >
                    <IconInfo width={16} height={16} />
                    {t("about")}
                  </button>
                  <button type="button" className="tb-btn tb-btn--ghost" onClick={clearConsole}>
                    <IconTrash width={16} height={16} />
                    {t("clearConsole")}
                  </button>
                </div>
              </div>
            </header>

            {terminalPosition === "right" ? (
              <div className="workspace-panels workspace-panels--right">
                <div className="editor-shell">
                  <div className="editor-area">
                    <Editor
                      height="100%"
                      language="python"
                      theme={monacoTheme}
                      value={code}
                      onChange={(v) => setCode(v ?? "")}
                      options={{
                        fontSize: 15 + fontDelta,
                        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                        minimap: { enabled: false },
                        wordWrap: "on",
                        scrollBeyondLastLine: false,
                        tabSize: 4,
                        padding: { top: 12, bottom: 12 },
                        smoothScrolling: true,
                        cursorBlinking: "smooth",
                        renderLineHighlight: "line",
                      }}
                    />
                  </div>
                </div>
                <div
                  className="splitter splitter-vertical"
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startConsoleWidthResize}
                />
                <div className="console-panel console-panel--side" style={{ width: `${consoleWidth}px` }}>
                  <div className="console-head">
                    <span className="console-head__title">{t("terminal")}</span>
                    <span className="console-head__hint">stdout / stderr</span>
                  </div>
                  <pre className="console-out" role="log" aria-live="polite">
                    {consoleLines.map((line, i) => (
                      <span key={i} className={`co-line co-${line.kind}`}>
                        {line.text}
                      </span>
                    ))}
                    <span ref={consoleEndRef} />
                  </pre>
                </div>
              </div>
            ) : (
              <>
                <div className="editor-shell">
                  <div className="editor-area">
                    <Editor
                      height="100%"
                      language="python"
                      theme={monacoTheme}
                      value={code}
                      onChange={(v) => setCode(v ?? "")}
                      options={{
                        fontSize: 15 + fontDelta,
                        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                        minimap: { enabled: false },
                        wordWrap: "on",
                        scrollBeyondLastLine: false,
                        tabSize: 4,
                        padding: { top: 12, bottom: 12 },
                        smoothScrolling: true,
                        cursorBlinking: "smooth",
                        renderLineHighlight: "line",
                      }}
                    />
                  </div>
                </div>

                <div
                  className="splitter splitter-horizontal"
                  role="separator"
                  aria-orientation="horizontal"
                  onMouseDown={startConsoleResize}
                />
                <div className="console-panel" style={{ height: `${consoleHeight}px` }}>
                  <div className="console-head">
                    <span className="console-head__title">{t("terminal")}</span>
                    <span className="console-head__hint">stdout / stderr</span>
                  </div>
                  <pre className="console-out" role="log" aria-live="polite">
                    {consoleLines.map((line, i) => (
                      <span key={i} className={`co-line co-${line.kind}`}>
                        {line.text}
                      </span>
                    ))}
                    <span ref={consoleEndRef} />
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="status-bar">
        <span
          className={`status-pill ${running ? "status-pill--busy" : connected ? "status-pill--ok" : "status-pill--idle"}`}
          aria-hidden
        />
        <span className="status-main">
          {running ? t("statusRunning") : t("statusReady")}
          <span className="status-sep">·</span>
          {pythonOnly ? t("pythonOnlyOn") : connected ? t("statusConn") : t("statusDisc")}
          {connected && hardwareBaudRate() ? (
            <>
              <span className="status-sep">·</span>
              {hardwareBaudRate()} baud
            </>
          ) : null}
        </span>
        <span className="status-meta">{t("statusMeta")}</span>
      </footer>

      {settingsOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="settings-title" className="modal-title">
              {t("settings")}
            </h3>
            <label className="modal-row">
              <span className="modal-label">{t("theme")}</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="modal-select"
              >
                <option value="dark">{t("themeDark")}</option>
                <option value="light">{t("themeLight")}</option>
              </select>
            </label>
            <label className="modal-row">
              <span className="modal-label">{t("contrast")}</span>
              <select
                value={contrast}
                onChange={(e) => setContrast(e.target.value)}
                className="modal-select"
              >
                <option value="normal">{t("contrastNormal")}</option>
                <option value="high">{t("contrastHigh")}</option>
              </select>
            </label>
            <label className="modal-row">
              <span className="modal-label">{t("language")}</span>
              <select
                value={getLang()}
                onChange={(e) => {
                  setLang(e.target.value);
                  forceLang((n) => n + 1);
                }}
                className="modal-select"
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="modal-row">
              <span className="modal-label">{t("terminalPosition")}</span>
              <select
                value={terminalPosition}
                onChange={(e) => setTerminalPosition(e.target.value)}
                className="modal-select"
              >
                <option value="bottom">{t("terminalBottom")}</option>
                <option value="right">{t("terminalRight")}</option>
              </select>
            </label>
            <label className="modal-row">
              <span className="modal-label">{t("fontSize")}</span>
              <div className="font-stepper">
                <button
                  type="button"
                  className="font-step-btn"
                  onClick={() => setFontDelta((v) => Math.max(-3, v - 1))}
                >
                  -
                </button>
                <span className="font-step-value">{15 + fontDelta}px</span>
                <button
                  type="button"
                  className="font-step-btn"
                  onClick={() => setFontDelta((v) => Math.min(8, v + 1))}
                >
                  +
                </button>
              </div>
            </label>
            <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setHelpOpen(false)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="help-title" className="modal-title">
              {t("help")}
            </h3>
            <pre className="help-pre">{t("helpBody")}</pre>
            <button type="button" className="modal-close" onClick={() => setHelpOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {aboutOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setAboutOpen(false)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="about-title" className="modal-title">
              {t("about")}
            </h3>
            <pre className="help-pre">{t("aboutBody")}</pre>
            <button type="button" className="modal-close" onClick={() => setAboutOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
