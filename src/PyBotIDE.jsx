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
import { HELP_COURSE } from "./helpCourseData.js";
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
} from "./ideIcons.jsx";

function labelForExample(ex) {
  return getLang() === "en" ? ex.keyEn : ex.keyEs;
}

function readInitialTheme() {
  const stored = localStorage.getItem("pybot_theme");
  if (stored === "dark" || stored === "light") return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function readInitialPythonOnly() {
  const v = localStorage.getItem("pybot_python_only");
  if (v === null) return true;
  return v === "1";
}

export default function PyBotIDE() {
  const [theme, setTheme] = useState(() => readInitialTheme());
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
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [helpModuleIdx, setHelpModuleIdx] = useState(0);
  const [helpLesson, setHelpLesson] = useState(null);
  const [pythonOnly, setPythonOnly] = useState(() => readInitialPythonOnly());
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
  const [currentFileName, setCurrentFileName] = useState("programa.py");
  const consoleEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const toolbarMenuRef = useRef(null);
  const [isCompactMobile, setIsCompactMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => {
      const next = mq.matches;
      setIsCompactMobile(next);
      if (next) {
        setSidebarOpen(false);
        setTerminalPosition("bottom");
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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

  useEffect(() => {
    if (!toolbarMenuOpen) return;
    const onDocPointerDown = (event) => {
      if (!toolbarMenuRef.current?.contains(event.target)) {
        setToolbarMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [toolbarMenuOpen]);

  const appendConsole = useCallback((line, kind = "out") => {
    setConsoleLines((prev) => [...prev.slice(-400), { text: line, kind }]);
  }, []);

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  const codeNeedsHardware = useCallback((source) => {
    const s = String(source ?? "");
    // Detecta uso directo de API hardware de PyBot.
    return /\b(pin|motor|servo|wait)\s*\(/.test(s);
  }, []);

  const resetDefaults = useCallback(() => {
    const sysDark =
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(sysDark ? "dark" : "light");
    setContrast("normal");
    setLang("en");
    forceLang((n) => n + 1);
    setTerminalPosition("bottom");
    setFontDelta(0);
    setPythonOnly(true);
    setSidebarWidth(248);
    setConsoleHeight(220);
    setConsoleWidth(360);
    appendConsole("[Info] Settings reset to defaults.\n", "info");
  }, [appendConsole]);

  const onConnect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const { baudRate } = await hardwareConnect();
      setConnected(true);
      appendConsole(`USB OK @ ${baudRate} baud\n`, "info");
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
    const needsHw = codeNeedsHardware(code);
    if (!pythonOnly && needsHw && !hardwareIsConnected()) {
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
        pythonOnly: pythonOnly || !needsHw,
      });
      appendConsole("\n[Fin]\n", "info");
    } catch {
      /* logged */
    } finally {
      setRunning(false);
    }
  }, [running, code, appendConsole, pythonOnly, codeNeedsHardware]);

  const onStop = useCallback(() => {
    signalStop();
    appendConsole("\n[Stop solicitado]\n", "info");
  }, [appendConsole]);

  const onOpenLocal = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(
    async (event) => {
      const file = event.target?.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        setCode(String(text ?? ""));
        setCurrentFileName(file.name || "programa.py");
        appendConsole(`${t("fileLoaded")} ${file.name || "programa.py"}\n`, "info");
      } catch {
        appendConsole(`${t("fileLoaded")} ERROR\n`, "err");
      }
    },
    [appendConsole],
  );

  const onSaveLocal = useCallback(async () => {
    const fallbackName =
      currentFileName && currentFileName.toLowerCase().endsWith(".py")
        ? currentFileName
        : `${currentFileName || "programa"}.py`;
    try {
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({
          suggestedName: fallbackName,
          types: [
            {
              description: "Python",
              accept: { "text/x-python": [".py"], "text/plain": [".py"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(code);
        await writable.close();
        const savedName = handle.name || fallbackName;
        setCurrentFileName(savedName);
        appendConsole(`${t("fileSaved")} ${savedName}\n`, "info");
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }

    const blob = new Blob([code], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    appendConsole(`${t("fileSaved")} ${fallbackName}\n`, "info");
  }, [code, currentFileName, appendConsole]);

  const loadExample = useCallback(
    (ex) => {
      setCode(ex.code);
      appendConsole(`Cargado: ${ex.file}\n`, "info");
      if (isCompactMobile) setSidebarOpen(false);
    },
    [appendConsole, isCompactMobile],
  );

  const monacoTheme = theme === "dark" ? "vs-dark" : "light";
  const lang = getLang();
  const course =
    HELP_COURSE[lang] && HELP_COURSE[lang].modules.length > 0
      ? HELP_COURSE[lang]
      : HELP_COURSE.es;
  const selectedModule = course.modules[helpModuleIdx] ?? course.modules[0];

  const openHelp = useCallback(() => {
    setHelpModuleIdx(0);
    setHelpLesson(null);
    setHelpOpen(true);
    setToolbarMenuOpen(false);
  }, []);

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
      <div className="bg-watermark" aria-hidden />
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
          {sidebarOpen && isCompactMobile ? (
            <button
              type="button"
              className="sidebar-backdrop"
              aria-label={t("close")}
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
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
                  <img src="/branding/pybot-logo.png" alt="" className="brand-main-logo" />
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
                    className="tb-btn tb-btn--run tb-btn--primary"
                    onClick={onRun}
                    disabled={running}
                  >
                    <IconPlay width={16} height={16} />
                    <span className="tb-btn__label">{t("run")}</span>
                  </button>
                  <button type="button" className="tb-btn tb-btn--stop tb-btn--primary" onClick={onStop}>
                    <IconSquare width={16} height={16} />
                    <span className="tb-btn__label">{t("stop")}</span>
                  </button>
                </div>
                <div className="tb-group tb-group--muted" ref={toolbarMenuRef}>
                  <button
                    type="button"
                    className="tb-btn tb-btn--ghost tb-btn--menu"
                    onClick={() => setToolbarMenuOpen((v) => !v)}
                    aria-expanded={toolbarMenuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="tb-btn__label">{t("menu")}</span>
                    <IconChevron width={14} height={14} />
                  </button>
                  {toolbarMenuOpen ? (
                    <div className="toolbar-menu" role="menu" aria-label={t("menuActions")}>
                      <button type="button" className="toolbar-menu-item" onClick={() => { onOpenLocal(); setToolbarMenuOpen(false); }}>
                        {t("openFile")}
                      </button>
                      <button type="button" className="toolbar-menu-item" onClick={() => { onSaveLocal(); setToolbarMenuOpen(false); }}>
                        {t("saveFile")}
                      </button>
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        onClick={() => {
                          if (connected) onDisconnect();
                          else onConnect();
                          setToolbarMenuOpen(false);
                        }}
                        disabled={connecting || pythonOnly}
                      >
                        {connected ? t("disconnect") : t("connect")}
                      </button>
                      <div className="toolbar-menu-divider" />
                      <div className="toolbar-menu-mode">
                        <span className="toolbar-menu-mode__label">{t("modeLabel")}</span>
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
                      <div className="toolbar-menu-divider" />
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        onClick={() => {
                          setSettingsOpen(true);
                          setToolbarMenuOpen(false);
                        }}
                      >
                        {t("settings")}
                      </button>
                      <button type="button" className="toolbar-menu-item" onClick={openHelp}>
                        {t("help")}
                      </button>
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        onClick={() => {
                          setAboutOpen(true);
                          setToolbarMenuOpen(false);
                        }}
                      >
                        {t("about")}
                      </button>
                      <button
                        type="button"
                        className="toolbar-menu-item"
                        onClick={() => {
                          clearConsole();
                          setToolbarMenuOpen(false);
                        }}
                      >
                        {t("clearConsole")}
                      </button>
                    </div>
                  ) : null}
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
                    <span className="console-head__hint">{t("terminalOutput")}</span>
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
                    <span className="console-head__hint">{t("terminalOutput")}</span>
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
            <button type="button" className="modal-reset" onClick={resetDefaults}>
              {t("resetDefaults")}
            </button>
            <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setHelpOpen(false)}>
          <div
            className="modal modal-wide modal-help"
            role="dialog"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="help-title" className="modal-title">
              {t("help")}
            </h3>
            <div className="help-course-head">
              <span className="help-course-badge">{course.badge}</span>
              <h4 className="help-course-title">{course.title}</h4>
              <p className="help-course-subtitle">{course.subtitle}</p>
            </div>
            <div className="help-course-layout">
              <aside className="help-course-menu" aria-label={lang === "es" ? "Modulos" : "Modules"}>
                {course.modules.map((mod, idx) => (
                  <button
                    key={mod.id}
                    type="button"
                    className={`help-module-btn ${idx === helpModuleIdx ? "help-module-btn--active" : ""}`}
                    onClick={() => {
                      setHelpModuleIdx(idx);
                      setHelpLesson(null);
                    }}
                  >
                    <span className="help-module-title">{mod.title}</span>
                    <span className="help-module-summary">{mod.summary}</span>
                  </button>
                ))}
              </aside>
              <section className="help-course-content">
                <h5 className="help-content-title">{selectedModule?.title}</h5>
                <p className="help-content-summary">{selectedModule?.summary}</p>
                <div className="help-lesson-grid">
                  {(selectedModule?.lessons ?? []).map((lesson) => (
                    <article key={lesson.id} className="help-lesson-card">
                      <div className="help-lesson-card__top">
                        <strong>{lesson.title}</strong>
                        <span>{lesson.duration}</span>
                      </div>
                      <p>{lesson.objective}</p>
                      <button
                        type="button"
                        className="help-lesson-open"
                        onClick={() => setHelpLesson(lesson)}
                      >
                        {lang === "es" ? "Abrir leccion" : "Open lesson"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            {helpLesson ? (
              <div className="help-lesson-popup-back" onClick={() => setHelpLesson(null)} role="presentation">
                <div className="help-lesson-popup" role="dialog" onClick={(e) => e.stopPropagation()}>
                  <div className="help-lesson-popup__head">
                    <h5>{helpLesson.title}</h5>
                    <span>{helpLesson.duration}</span>
                  </div>
                  <p className="help-lesson-objective">{helpLesson.objective}</p>
                  <ol className="help-lesson-steps">
                    {helpLesson.steps.map((step, idx) => (
                      <li key={`${helpLesson.id}-step-${idx}`}>{step}</li>
                    ))}
                  </ol>
                  <p className="help-lesson-tip">
                    <strong>{lang === "es" ? "Tip pro: " : "Pro tip: "}</strong>
                    {helpLesson.tip}
                  </p>
                  <p className="help-lesson-challenge">
                    <strong>{lang === "es" ? "Desafio: " : "Challenge: "}</strong>
                    {helpLesson.challenge}
                  </p>
                  <pre className="help-code">{helpLesson.code}</pre>
                  <button type="button" className="modal-close" onClick={() => setHelpLesson(null)}>
                    {t("close")}
                  </button>
                </div>
              </div>
            ) : null}
            <button type="button" className="modal-close" onClick={() => setHelpOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {aboutOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setAboutOpen(false)}>
          <div
            className="modal modal-about"
            role="dialog"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="about-card">
              <img src="/branding/pybot-logo.png" alt="PyBot logo" className="about-logo" />
              <h3 id="about-title" className="about-title">
                {t("aboutName")}
              </h3>
              <p className="about-desc">{t("aboutDesc")}</p>
              <p className="about-meta">
                <strong>{t("aboutAuthor")}:</strong> Victor Capeluto
              </p>
              <p className="about-meta">
                <strong>{t("aboutVersion")}:</strong> 1.0
              </p>
            </div>
            <button type="button" className="modal-close" onClick={() => setAboutOpen(false)}>
              OK
            </button>
          </div>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".py,text/x-python,text/plain"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
    </div>
  );
}
