import { useState, useCallback, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import "./PyBotIDE.css";
import { DEFAULT_CODE, EXAMPLES } from "./examplesData.js";
import { t, getLang, setLang } from "./i18n.js";
import {
  hardwareConnect,
  hardwareDisconnect,
  hardwareIsConnected,
  hardwareBaudRate,
} from "./hardwareBridge.js";
import { runPythonAsync, signalStop } from "./pyodideRunner.js";

function labelForExample(ex) {
  return getLang() === "en" ? ex.keyEn : ex.keyEs;
}

export default function PyBotIDE() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("pybot_theme") || "dark",
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
  const [, forceLang] = useState(0);
  const consoleEndRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pybot_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("pybot_code", code);
  }, [code]);

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
      appendConsole(`${e.message}\n`, "err");
    } finally {
      setConnecting(false);
    }
  }, [connecting, appendConsole]);

  const onDisconnect = useCallback(async () => {
    await hardwareDisconnect();
    setConnected(false);
    appendConsole("Desconectado.\n", "info");
  }, [appendConsole]);

  const onRun = useCallback(async () => {
    if (running) return;
    if (!hardwareIsConnected()) {
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
      });
      appendConsole("\n[Fin]\n", "info");
    } catch {
      /* logged */
    } finally {
      setRunning(false);
    }
  }, [running, code, appendConsole]);

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

  return (
    <div className="ide-root" data-theme={theme}>
      <aside className="activity-bar">
        <button
          type="button"
          className={`act-btn ${sidebarOpen ? "act-active" : ""}`}
          title={t("explorer")}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          Doc
        </button>
        <button
          type="button"
          className="act-btn"
          title={t("run")}
          onClick={onRun}
          disabled={running}
        >
          Run
        </button>
        <button type="button" className="act-btn" title={t("stop")} onClick={onStop}>
          Stop
        </button>
        <button
          type="button"
          className={`act-btn ${connected ? "act-ok" : ""}`}
          title={t("connect")}
          onClick={connected ? onDisconnect : onConnect}
          disabled={connecting}
        >
          USB
        </button>
        <div className="act-spacer" />
        <button
          type="button"
          className="act-btn"
          title={t("settings")}
          onClick={() => setSettingsOpen(true)}
        >
          Set
        </button>
      </aside>

      <div className="ide-body">
        {sidebarOpen ? (
          <aside className="sidebar">
            <div className="sidebar-head">{t("explorer")}</div>
            <div className="sidebar-sub">{t("examples")}</div>
            <div className="example-list">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  className="example-item"
                  onClick={() => loadExample(ex)}
                >
                  {labelForExample(ex)}
                </button>
              ))}
            </div>
          </aside>
        ) : null}

        <div className="main-stack">
          <header className="toolbar">
            <span className="toolbar-title">{t("appTitle")}</span>
            <div className="toolbar-actions">
              <button type="button" className="tb-btn tb-run" onClick={onRun} disabled={running}>
                {t("run")}
              </button>
              <button type="button" className="tb-btn tb-stop" onClick={onStop}>
                {t("stop")}
              </button>
              <button
                type="button"
                className="tb-btn"
                onClick={connected ? onDisconnect : onConnect}
                disabled={connecting}
              >
                {connected ? t("disconnect") : t("connect")}
              </button>
              <button type="button" className="tb-btn" onClick={() => setHelpOpen(true)}>
                {t("help")}
              </button>
              <button type="button" className="tb-btn" onClick={clearConsole}>
                Clear
              </button>
            </div>
          </header>

          <div className="editor-area">
            <Editor
              height="100%"
              language="python"
              theme={monacoTheme}
              value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                wordWrap: "on",
                scrollBeyondLastLine: false,
                tabSize: 4,
                padding: { top: 8 },
              }}
            />
          </div>

          <div className="console-panel">
            <div className="console-head">{t("terminal")}</div>
            <pre className="console-out">
              {consoleLines.map((line, i) => (
                <span key={i} className={`co-${line.kind}`}>
                  {line.text}
                </span>
              ))}
              <span ref={consoleEndRef} />
            </pre>
          </div>
        </div>
      </div>

      <footer className="status-bar">
        <span className="sb-dot sb-ok">*</span>
        <span>
          {running ? t("statusRunning") : t("statusReady")}
          {connected ? ` · ${t("statusConn")}` : ` · ${t("statusDisc")}`}
          {connected && hardwareBaudRate() ? ` @ ${hardwareBaudRate()} baud` : ""}
        </span>
        <span className="sb-right">Python Pyodide · async</span>
      </footer>

      {settingsOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t("settings")}</h3>
            <label className="modal-row">
              {t("theme")}
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
              {t("language")}
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
            <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setHelpOpen(false)}>
          <div className="modal modal-wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t("help")}</h3>
            <pre className="help-pre">{t("helpBody")}</pre>
            <button type="button" className="modal-close" onClick={() => setHelpOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
