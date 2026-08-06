import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import Editor from "@monaco-editor/react";
import "./PyBotIDE.css";
import {
  pythonToPseudocode,
  pseudocodeToPython,
  pythonToAst,
  astToPython,
  astToBlockly,
} from "./rosetta/index.js";
import "./rosetta/rosetta.css";

const FlowchartEditor = lazy(() => import("./rosetta/FlowchartEditor.jsx"));

// PyBlock (editor visual por bloques) — carga diferida y aislada: solo se carga
// cuando el usuario elige el modo PyBlock, así el modo Python no se ve afectado.
const PyBlockEditor = lazy(() => import("./pyblock/PyBlockEditor.jsx"));
import { DEFAULT_CODE, EXAMPLES } from "./examplesData.js";
import { t, getLang, setLang, formatHardwareError, formatPythonError } from "./i18n.js";
import {
  hardwareConnect,
  hardwareDisconnect,
  hardwareIsConnected,
  hardwareBaudRate,
  hardwareMode,
  runOnBoard,
  interruptBoard,
  getBoardType,
  getEda6Profile,
  installEda6Library,
  checkEda6Installed,
  flashToEsp32,
  deleteMainPy,
  checkMainPyInstalled,
  recoverEsp32Repl,
  downloadToArduino,
} from "./hardwareBridge.js";
import {
  filterExamplesForBoard,
  setEda6Profile,
} from "./eda6Profile.js";
import { runPythonAsync, signalStop } from "./pyodideRunner.js";
import { checkPythonSyntax } from "./pythonSyntaxDiagnostics.js";
import { hasCanvasCode } from "./canvasCodeDetect.js";
import { HELP_COURSE } from "./helpCourseData.js";
import ConnectUsbModal from "./ConnectUsbModal.jsx";
import { isConnectAssistantEnabled, setConnectAssistantEnabled } from "./connectUsbAssistant.js";
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
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectModalPhase, setConnectModalPhase] = useState("ready");
  const [connectModalError, setConnectModalError] = useState(null);
  const [connectModalShowHelp, setConnectModalShowHelp] = useState(false);
  const [connectModalPreparing, setConnectModalPreparing] = useState(false);
  const [connectAssistant, setConnectAssistant] = useState(() => isConnectAssistantEnabled());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [helpModuleIdx, setHelpModuleIdx] = useState(0);
  const [helpLesson, setHelpLesson] = useState(null);
  const [pythonOnly, setPythonOnly] = useState(() => readInitialPythonOnly());
  const [boardType, setBoardType] = useState(() => getBoardType());
  const [eda6Profile, setEda6ProfileState] = useState(() => getEda6Profile());
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
  const [showSchoolLogo, setShowSchoolLogo] = useState(true);
  const [currentFileName, setCurrentFileName] = useState("programa.py");
  const consoleEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const toolbarMenuRef = useRef(null);
  const boardMenuRef = useRef(null);
  const viewMenuRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const inputResolveRef = useRef(null);
  const inputFieldRef = useRef(null);
  const [waitingInput, setWaitingInput] = useState(false);
  const [downloadingArduino, setDownloadingArduino] = useState(false);
  const [editorMode, setEditorMode] = useState(() => {
    try {
      const saved = localStorage.getItem("pybot_editor_mode");
      return ["python", "pyblock", "pseudo", "flow"].includes(saved) ? saved : "python";
    } catch {
      return "python";
    }
  });
  const [pyblockCode, setPyblockCode] = useState("");
  const [pseudoCode, setPseudoCode] = useState(() => {
    try {
      return localStorage.getItem("pybot_pseudo") ?? "";
    } catch {
      return "";
    }
  });
  const [flowAst, setFlowAst] = useState(null);
  // Programa (JSON de Blockly) a cargar en el editor de bloques cuando se llega
  // a "Bloques" desde otra representacion. null = usar el workspace guardado.
  const [pyblockIncoming, setPyblockIncoming] = useState(null);
  // Marca si el usuario EDITO realmente cada vista. Al cambiar de pestaña solo
  // reescribimos el Python canonico si la vista de origen fue editada; asi, solo
  // navegar entre pestañas nunca modifica el codigo.
  const viewEditedRef = useRef({ pseudo: false, flow: false, pyblock: false });
  const [inputPrompt, setInputPrompt] = useState("");
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState(null);
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
    try {
      localStorage.setItem("pybot_editor_mode", editorMode);
    } catch {
      /* ignore */
    }
  }, [editorMode]);

  // PyBlock: pasar el Python generado al editor de texto y volver a modo Python.
  const onCopyToPython = useCallback((generated) => {
    if (!generated || !generated.trim()) return;
    setCode(generated);
    setEditorMode("python");
  }, []);

  const lang = getLang();

  // --- Rosetta: conversion entre representaciones (Python es el canonico) ---
  // Devuelve el Python "real" de lo que el alumno tiene armado en el modo actual.
  const currentPythonCode = useCallback(() => {
    if (editorMode === "pyblock") return pyblockCode;
    if (editorMode === "pseudo") return pseudocodeToPython(pseudoCode);
    if (editorMode === "flow") return flowAst ? astToPython(flowAst) : code;
    return code; // python
  }, [editorMode, code, pyblockCode, pseudoCode, flowAst]);

  // Cambia de representacion. Regla clave para evitar que "solo navegar" altere
  // el codigo: al SALIR de una vista, unicamente bajamos esa vista a Python si
  // el usuario la EDITO. Si no la toco, conservamos el Python canonico tal cual.
  // Luego derivamos la vista destino desde ese Python y la marcamos sin editar.
  const switchRepresentation = useCallback(
    (next) => {
      if (next === editorMode) return;
      const from = editorMode;
      let baseCode = code;
      if (from === "pseudo" && viewEditedRef.current.pseudo) {
        baseCode = pseudocodeToPython(pseudoCode);
      } else if (from === "flow" && viewEditedRef.current.flow && flowAst) {
        baseCode = astToPython(flowAst);
      } else if (from === "pyblock" && viewEditedRef.current.pyblock) {
        baseCode = pyblockCode;
      }
      if (baseCode !== code) setCode(baseCode);

      if (next === "pseudo") {
        setPseudoCode(pythonToPseudocode(baseCode));
        viewEditedRef.current.pseudo = false;
      } else if (next === "flow") {
        setFlowAst(pythonToAst(baseCode));
        viewEditedRef.current.flow = false;
      } else if (next === "pyblock") {
        try {
          setPyblockIncoming(astToBlockly(pythonToAst(baseCode)));
        } catch {
          setPyblockIncoming(null);
        }
        viewEditedRef.current.pyblock = false;
      }
      setEditorMode(next);
    },
    [editorMode, code, pseudoCode, flowAst, pyblockCode],
  );

  // Persistir el pseudocodigo para que sobreviva a recargas.
  useEffect(() => {
    try {
      localStorage.setItem("pybot_pseudo", pseudoCode);
    } catch {
      /* ignore */
    }
  }, [pseudoCode]);

  // Al montar: si arrancamos en una vista no-Python (por recarga), alineamos el
  // Python canonico con lo que muestra esa vista una sola vez, para que no se
  // pierda al primer cambio de pestaña.
  useEffect(() => {
    if (editorMode === "pseudo" && pseudoCode.trim()) {
      setCode(pseudocodeToPython(pseudoCode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // En modo flowchart: si no hay AST cargado (por ej. tras recargar la pagina),
  // lo generamos desde el Python canonico.
  useEffect(() => {
    if (editorMode === "flow" && !flowAst) {
      setFlowAst(pythonToAst(code));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  // --- Diagnóstico de sintaxis Python (Monaco markers). Aislado y aditivo. ---
  const SYNTAX_MARKER_OWNER = "pybot-python";

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  const applySyntaxResult = useCallback((res) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel?.();
    if (!model) return;
    if (!res || res.ok) {
      monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, []);
      return;
    }
    monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: `${t("syntaxErrorPrefix")} ${res.message} (${t("lineWord")} ${res.line})`,
        startLineNumber: res.line,
        startColumn: res.column,
        endLineNumber: res.endLine,
        endColumn: res.endColumn,
      },
    ]);
  }, []);

  // Valida la sintaxis al escribir (solo en modo Python), con debounce.
  useEffect(() => {
    if (editorMode !== "python") {
      applySyntaxResult({ ok: true });
      return undefined;
    }
    const handle = setTimeout(async () => {
      const editorAtStart = editorRef.current;
      const res = await checkPythonSyntax(code);
      if (editorRef.current !== editorAtStart) return; // el editor cambió/desmontó
      applySyntaxResult(res);
    }, 650);
    return () => clearTimeout(handle);
  }, [code, editorMode, applySyntaxResult]);

  const prevBoardTypeRef = useRef(boardType);

  useEffect(() => {
    localStorage.setItem("pybot_board_type", boardType);
    if (boardType === "esp32-eda6" && prevBoardTypeRef.current !== "esp32-eda6") {
      setEda6ProfileState("WEMOS");
    }
    prevBoardTypeRef.current = boardType;
  }, [boardType]);

  useEffect(() => {
    setEda6Profile(eda6Profile);
  }, [eda6Profile]);

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
    if (waitingInput) inputFieldRef.current?.focus();
  }, [waitingInput]);

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

  useEffect(() => {
    if (!boardMenuOpen) return;
    const onDocPointerDown = (event) => {
      if (!boardMenuRef.current?.contains(event.target)) {
        setBoardMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [boardMenuOpen]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const onDocPointerDown = (event) => {
      if (!viewMenuRef.current?.contains(event.target)) {
        setViewMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [viewMenuOpen]);

  const appendConsole = useCallback((line, kind = "out") => {
    setConsoleLines((prev) => {
      const next = [...prev, { text: line, kind }];
      // Acota memoria/DOM ante salida continua: como mucho 500 entradas y
      // ~48 KB de texto total (lo que se ve más un buen scrollback).
      let total = 0;
      let start = next.length;
      for (let i = next.length - 1; i >= 0; i--) {
        total += next[i].text.length;
        start = i;
        if (total > 49152 || next.length - i >= 500) break;
      }
      return start > 0 ? next.slice(start) : next;
    });
  }, []);

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  const onCanvas = useCallback(async (w, h) => {
    setCanvasSize({ w, h });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 30));
      if (canvasRef.current) return canvasRef.current;
    }
    return canvasRef.current;
  }, []);

  const onInput = useCallback((promptText) => {
    return new Promise((resolve) => {
      inputResolveRef.current = resolve;
      setInputPrompt(promptText);
      setWaitingInput(true);
    });
  }, []);

  const onInputSubmit = useCallback(
    (value) => {
      appendConsole(`${inputPrompt}${value}\n`, "out");
      setWaitingInput(false);
      setInputPrompt("");
      if (inputResolveRef.current) {
        inputResolveRef.current(value);
        inputResolveRef.current = null;
      }
    },
    [inputPrompt, appendConsole],
  );

  const codeNeedsHardware = useCallback((source) => {
    const s = String(source ?? "");
    // wait() es solo una pausa: funciona en Pyodide sin placa, por eso no exige
    // conexion. Solo pin/motor/servo/sensores y la API EDA6 requieren hardware.
    return (
      /\b(pin|motor|servo)\s*\(/.test(s) ||
      /\b(entradaDigital|entradaAnalogica|salidaDigital|motorRC|servomotor|sensorDistancia|detenerTodo|printLCD|limpiarLCD|asciiLCD|luzLCD|cursorLCD|parpadeoLCD)\s*\(/.test(
        s,
      )
    );
  }, []);

  const visibleExamples = filterExamplesForBoard(EXAMPLES, boardType);

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

  const performHardwareConnect = useCallback(async () => {
    if (connecting) return { ok: false, skipped: true };
    setConnecting(true);
    try {
      const { baudRate, mode } = await hardwareConnect({
        onArduinoPrepare: (info) => {
          if (info.phase === "start") {
            setConnectModalPreparing(true);
            appendConsole(t("arduinoFirmataFlashing") + "\n", "info");
          } else if (info.phase === "done") {
            setConnectModalPreparing(false);
            appendConsole(t("arduinoFirmataFlashOk") + "\n", "info");
          } else if (info.phase === "fail") {
            setConnectModalPreparing(false);
          }
        },
      });
      setConnected(true);
      if (mode === "esp32-eda6") {
        appendConsole(
          (eda6Profile === "ESP32" ? t("eda6ConnectedEsp32") : t("eda6ConnectedWemos")) + "\n",
          "info",
        );
        appendConsole(t("eda6Hint") + "\n", "info");
        appendConsole(t("esp32ReconnectWarn") + "\n", "info");
      } else if (mode === "esp32-micropython") {
        appendConsole(t("mpyConnected") + "\n", "info");
        appendConsole(t("esp32FlashHint") + "\n", "info");
        appendConsole(t("esp32ReconnectWarn") + "\n", "info");
      } else {
        appendConsole(`${t("arduinoConnected")}\n`, "info");
      }
      return { ok: true };
    } catch (e) {
      const display = formatHardwareError(e?.message);
      appendConsole(`${display}\n`, "err");
      return { ok: false, message: e?.message, display };
    } finally {
      setConnecting(false);
      setConnectModalPreparing(false);
    }
  }, [connecting, appendConsole, eda6Profile]);

  const openConnectFlow = useCallback(() => {
    if (connecting) return;
    if (pythonOnly) {
      appendConsole(t("needHardwareMode") + "\n", "info");
      setPythonOnly(false);
    }
    if (!isConnectAssistantEnabled()) {
      void performHardwareConnect();
      return;
    }
    setConnectModalPhase("ready");
    setConnectModalError(null);
    setConnectModalShowHelp(false);
    setConnectModalOpen(true);
  }, [connecting, pythonOnly, appendConsole, performHardwareConnect]);

  const onConnectFromModal = useCallback(async () => {
    setConnectModalPhase("connecting");
    const result = await performHardwareConnect();
    if (result.ok) {
      setConnectModalOpen(false);
      setConnectModalPhase("ready");
      setConnectModalError(null);
      setConnectModalShowHelp(false);
    } else if (!result.skipped) {
      setConnectModalPhase("failed");
      setConnectModalError(result.display ?? formatHardwareError(result.message));
      setConnectModalShowHelp(true);
    } else {
      setConnectModalPhase("ready");
    }
  }, [performHardwareConnect]);

  const onConnect = openConnectFlow;

  const runBoardProgram = useCallback(
    async (runningMsg, sourceCode) => {
      setRunning(true);
      setCanvasSize(null);
      signalStop();
      await new Promise((r) => setTimeout(r, 20));
      globalThis.__PYBOT_STOP__ = false;
      appendConsole(runningMsg + "\n", "info");
      try {
        await runOnBoard(sourceCode ?? code, {
          onOut: (s) => appendConsole(s, "out"),
          onErr: (s) => appendConsole(String(s).trim() + "\n", "err"),
          onStarted: () => appendConsole(t("boardProgramRunning") + "\n", "info"),
          shouldStop: () => globalThis.__PYBOT_STOP__ === true,
        });
        appendConsole("\n[Fin]\n", "info");
      } catch (e) {
        appendConsole(formatPythonError(e?.message) + "\n", "err");
      } finally {
        setRunning(false);
      }
    },
    [code, appendConsole],
  );

  const onDisconnect = useCallback(async () => {
    await hardwareDisconnect();
    setConnected(false);
    appendConsole(t("logDisconnected") + "\n", "info");
  }, [appendConsole]);

  const onRun = useCallback(async () => {
    if (running) return;
    // En PyBlock se ejecuta el Python generado por los bloques.
    const activeCode = currentPythonCode();
    if (!activeCode.trim()) {
      appendConsole(t("pyblockEmpty") + "\n", "err");
      return;
    }
    const needsHw = codeNeedsHardware(activeCode);
    const canvasCode = hasCanvasCode(activeCode);

    // ESP32 MicroPython / EDA6: el programa corre EN la placa (no en Pyodide).
    // Canvas/dibujo solo corre en pantalla (Pyodide), nunca en la placa.
    if (
      !pythonOnly &&
      !canvasCode &&
      (boardType === "esp32-micropython" || boardType === "esp32-eda6")
    ) {
      if (!hardwareIsConnected()) {
        appendConsole(t("needConnect") + "\n", "err");
        return;
      }
      if (boardType === "esp32-micropython" && /\bpin\s*\([^)]*["'][Aa]\d/.test(activeCode)) {
        appendConsole(formatPythonError("ESP32_GPIO_ONLY") + "\n", "err");
        return;
      }
      if (boardType === "esp32-eda6") {
        appendConsole(
          (eda6Profile === "ESP32" ? t("eda6ProfileWarnEsp32") : t("eda6ProfileWarnWemos")) + "\n",
          eda6Profile === "ESP32" ? "err" : "info",
        );
        appendConsole(t("eda6RunUploading") + "\n", "info");
      }
      const msg = boardType === "esp32-eda6" ? t("eda6Running") : t("mpyRunning");
      await runBoardProgram(msg, activeCode);
      return;
    }

    if (!pythonOnly && needsHw && !hardwareIsConnected()) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }

    // Validación de sintaxis antes de ejecutar (no corre el programa).
    const syntax = await checkPythonSyntax(activeCode);
    if (!syntax.ok) {
      applySyntaxResult(syntax);
      appendConsole(
        `${t("syntaxErrorPrefix")} ${syntax.message}` +
          (syntax.line ? ` (${t("lineWord")} ${syntax.line})` : "") +
          "\n",
        "err",
      );
      return;
    }

    setRunning(true);
    setCanvasSize(null);
    signalStop();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.__PYBOT_STOP__ = false;
    appendConsole(t("pyodideLoad") + "\n", "info");
    try {
      await runPythonAsync(activeCode, {
        onOut: (s) => appendConsole(s, "out"),
        onErr: (s) => appendConsole(s, "err"),
        onInput,
        onCanvas,
        pythonOnly: pythonOnly || !needsHw,
      });
      appendConsole("\n[Fin]\n", "info");
    } catch {
      /* logged */
    } finally {
      setRunning(false);
      setWaitingInput(false);
      setInputPrompt("");
      inputResolveRef.current = null;
    }
  }, [running, code, editorMode, pyblockCode, currentPythonCode, appendConsole, pythonOnly, codeNeedsHardware, onInput, onCanvas, runBoardProgram, boardType, eda6Profile, applySyntaxResult]);

  const onInstallEda6 = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    appendConsole(t("eda6Installing") + "\n", "info");
    try {
      await installEda6Library(eda6Profile);
      appendConsole(t("eda6InstalledOk") + "\n", "info");
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, appendConsole, eda6Profile]);

  const onVerifyEda6 = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    try {
      const ok = await checkEda6Installed();
      appendConsole((ok ? t("eda6VerifyOk") : t("eda6VerifyMissing")) + "\n", ok ? "info" : "err");
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, appendConsole]);

  const onFlashToEsp32 = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    if (boardType !== "esp32-micropython" && boardType !== "esp32-eda6") {
      return;
    }
    const activeCode = currentPythonCode();
    if (!activeCode.trim()) {
      appendConsole(t("pyblockEmpty") + "\n", "err");
      return;
    }
    if (hasCanvasCode(activeCode)) {
      appendConsole(t("boardNoCanvas") + "\n", "err");
      return;
    }
    appendConsole(
      (boardType === "esp32-eda6" ? t("eda6Installing") : t("esp32FlashHint")) + "\n",
      "info",
    );
    try {
      const { kind, verify } = await flashToEsp32(activeCode);
      if (verify?.mainSize > 0) {
        appendConsole(t("esp32FlashVerified").replace("{size}", String(verify.mainSize)) + "\n", "info");
      }
      await hardwareDisconnect();
      setConnected(false);
      appendConsole(
        (kind === "eda6" ? t("eda6FlashedOk") : t("esp32FlashOk")) + "\n",
        "info",
      );
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, code, editorMode, pyblockCode, currentPythonCode, appendConsole, boardType]);

  const onDownloadToArduino = useCallback(async () => {
    if (boardType !== "arduino-firmata") return;
    if (downloadingArduino) return;
    const activeCode = currentPythonCode();
    if (!activeCode.trim()) {
      appendConsole(t("pyblockEmpty") + "\n", "err");
      return;
    }
    // Canvas/dibujo solo funciona en pantalla (Pyodide), no en el Arduino VM.
    if (hasCanvasCode(activeCode)) {
      appendConsole(t("arduinoNoCanvas") + "\n", "err");
      return;
    }
    // El compilador Arduino VM todavía no soporta def/funciones/procedimientos.
    if (/^[ \t]*(async[ \t]+)?def[ \t]+\w+/m.test(activeCode)) {
      appendConsole(t("arduinoNoFunctions") + "\n", "err");
      return;
    }
    setDownloadingArduino(true);
    appendConsole(t("arduinoDownloadStart") + "\n", "info");
    try {
      const { bytes } = await downloadToArduino(activeCode, {
        onPhase: (phase) => {
          if (phase === "flashing") {
            appendConsole(t("arduinoDownloadFlashing") + "\n", "info");
          } else if (phase === "uploading" || phase === "retry") {
            appendConsole(t("arduinoDownloadUploading") + "\n", "info");
          }
        },
      });
      setConnected(false);
      appendConsole(t("arduinoDownloadOk").replace("{bytes}", String(bytes)) + "\n", "info");
    } catch (e) {
      if (e?.compile) {
        const msg = getLang() === "en" ? e.compile.en : e.compile.es;
        const where = e.compile.line ? ` [${e.compile.line}]` : "";
        appendConsole(t("arduinoDownloadUnsupported") + " " + msg + where + "\n", "err");
      } else {
        appendConsole(formatHardwareError(e?.message) + "\n", "err");
      }
    } finally {
      setDownloadingArduino(false);
    }
  }, [boardType, downloadingArduino, code, editorMode, pyblockCode, currentPythonCode, appendConsole]);

  const onRecoverRepl = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    try {
      await recoverEsp32Repl();
      appendConsole(t("esp32RecoverReplBtn") + " OK\n", "info");
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, appendConsole]);

  const onVerifyMainPy = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    try {
      const ok = await checkMainPyInstalled();
      appendConsole((ok ? t("esp32MainPresent") : t("esp32MainMissing")) + "\n", ok ? "info" : "err");
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, appendConsole]);

  const onDeleteMainPy = useCallback(async () => {
    if (!connected) {
      appendConsole(t("needConnect") + "\n", "err");
      return;
    }
    try {
      await deleteMainPy();
      appendConsole(t("eda6MainDeleted") + "\n", "info");
    } catch (e) {
      appendConsole(formatPythonError(e?.message) + "\n", "err");
    }
  }, [connected, appendConsole]);

  const onStop = useCallback(() => {
    signalStop();
    if (boardType === "esp32-micropython" || boardType === "esp32-eda6") {
      if (hardwareIsConnected()) interruptBoard();
    }
    setRunning(false);
    if (inputResolveRef.current) {
      inputResolveRef.current("");
      inputResolveRef.current = null;
      setWaitingInput(false);
      setInputPrompt("");
    }
    appendConsole("\n[Stop solicitado]\n", "info");
  }, [appendConsole, boardType]);

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

  const monacoOptions = {
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
  };

  // Opciones de representacion (flowchart/pseudo/python/bloques).
  const REP_TABS = [
    ["flow", t("repFlow")],
    ["pseudo", t("repPseudo")],
    ["python", t("repPython")],
    ["pyblock", t("repBlocks")],
  ];
  const currentRepLabel = (REP_TABS.find(([id]) => id === editorMode) || REP_TABS[2])[1];

  // Desplegable "Ver como" en la barra superior (reemplaza la fila de pestañas
  // para no ocupar espacio; misma logica switchRepresentation).
  const viewMenu = (
    <div className="tb-group tb-group--muted" ref={viewMenuRef}>
      <button
        type="button"
        className="tb-btn tb-btn--ghost tb-btn--menu"
        onClick={() => setViewMenuOpen((v) => !v)}
        aria-expanded={viewMenuOpen}
        aria-haspopup="menu"
        title={t("repTabsLabel")}
      >
        <span className="tb-btn__label">
          {t("viewAsLabel")}: {currentRepLabel}
        </span>
        <IconChevron width={14} height={14} />
      </button>
      {viewMenuOpen ? (
        <div className="toolbar-menu" role="menu" aria-label={t("repTabsLabel")}>
          {REP_TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={editorMode === id}
              className={`toolbar-menu-item ${editorMode === id ? "toolbar-menu-item--highlight" : ""}`}
              onClick={() => {
                switchRepresentation(id);
                setViewMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  let editorSurface;
  if (editorMode === "pyblock") {
    editorSurface = (
      <Suspense fallback={<div className="pyblock-loading">{t("pyblockLoading")}</div>}>
        <PyBlockEditor
          theme={theme}
          lang={lang}
          boardType={boardType}
          incoming={pyblockIncoming}
          onGenerated={setPyblockCode}
          onEdited={() => {
            viewEditedRef.current.pyblock = true;
          }}
          onCopyToPython={onCopyToPython}
        />
      </Suspense>
    );
  } else if (editorMode === "pseudo") {
    editorSurface = (
      <div className="pseudo-view">
        <Editor
          height="100%"
          language="plaintext"
          theme={monacoTheme}
          value={pseudoCode}
          onChange={(v) => {
            viewEditedRef.current.pseudo = true;
            setPseudoCode(v ?? "");
          }}
          options={monacoOptions}
        />
      </div>
    );
  } else if (editorMode === "flow") {
    editorSurface = (
      <Suspense fallback={<div className="pyblock-loading">{t("pyblockLoading")}</div>}>
        <FlowchartEditor
          ast={flowAst}
          onAstChange={(nextAst) => {
            viewEditedRef.current.flow = true;
            setFlowAst(nextAst);
          }}
          lang={lang}
        />
      </Suspense>
    );
  } else {
    editorSurface = (
      <Editor
        height="100%"
        language="python"
        theme={monacoTheme}
        value={code}
        onChange={(v) => setCode(v ?? "")}
        onMount={handleEditorMount}
        options={monacoOptions}
      />
    );
  }

  const editorShell = (
    <div className="editor-shell">
      <div className="editor-area">{editorSurface}</div>
    </div>
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
                  {visibleExamples.map((ex) => (
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
                {/* LOGO PyBot WEB: PNG nuevo (pybot-logo-web2.png, incluye el texto "PyBot WEB"/"by VIC" dentro de la imagen).
                    Para revertir a los SVG originales, volver a src="/branding/pybot-logo-full.svg" (sin el ?v=web2). */}
                <img
                  src="/branding/pybot-logo-web2.png?v=web2"
                  alt={t("appTitle")}
                  className="brand-logo-full"
                />
                <div className="brand-logos">
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
                {viewMenu}
                <div className="tb-group tb-group--muted" ref={boardMenuRef}>
                  <button
                    type="button"
                    className={`tb-btn tb-btn--ghost tb-btn--menu ${connected ? "tb-btn--connected" : ""}`}
                    onClick={() => setBoardMenuOpen((v) => !v)}
                    aria-expanded={boardMenuOpen}
                    aria-haspopup="menu"
                  >
                    {connected ? <IconUsb width={15} height={15} /> : <IconPlug width={15} height={15} />}
                    <span className="tb-btn__label">{t("boardMenuTitle")}</span>
                    <IconChevron width={14} height={14} />
                  </button>
                  {boardMenuOpen ? (
                    <div className="toolbar-menu" role="menu" aria-label={t("menuSectionBoard")}>
                      <button
                        type="button"
                        className="toolbar-menu-item toolbar-menu-item--highlight"
                        onClick={() => {
                          if (connected) onDisconnect();
                          else onConnect();
                          setBoardMenuOpen(false);
                        }}
                        disabled={connecting}
                      >
                        {connected ? t("disconnect") : t("connect")}
                      </button>
                      <div className="toolbar-menu-mode">
                        <span className="toolbar-menu-mode__label">{t("boardLabel")}</span>
                        <select
                          className="toolbar-menu-board"
                          value={boardType}
                          onChange={(e) => setBoardType(e.target.value)}
                          disabled={connected || connecting}
                          title={connected ? t("disconnect") : t("boardHint")}
                          aria-label={t("boardLabel")}
                        >
                          <option value="arduino-firmata">{t("boardArduino")}</option>
                          <option value="esp32-micropython">{t("boardEsp32Mp")}</option>
                          <option value="esp32-eda6">{t("boardEsp32Eda6")}</option>
                        </select>
                      </div>
                      {boardType === "esp32-eda6" ? (
                        <div className="toolbar-menu-mode">
                          <span className="toolbar-menu-mode__label">{t("eda6ProfileLabel")}</span>
                          <select
                            className="toolbar-menu-board"
                            value={eda6Profile}
                            onChange={(e) => setEda6ProfileState(e.target.value)}
                            disabled={connected || connecting}
                            aria-label={t("eda6ProfileLabel")}
                          >
                            <option value="WEMOS">{t("eda6ProfileWemos")}</option>
                            <option value="ESP32">{t("eda6ProfileEsp32")}</option>
                          </select>
                        </div>
                      ) : null}
                      {(boardType === "esp32-eda6" || boardType === "esp32-micropython") &&
                      connected ? (
                        <div className="toolbar-menu-subgroup">
                          <span className="toolbar-menu-mode__label">{t("menuBoardToolsLabel")}</span>
                          <button
                            type="button"
                            className="toolbar-menu-item toolbar-menu-item--secondary"
                            onClick={() => {
                              onFlashToEsp32();
                              setBoardMenuOpen(false);
                            }}
                          >
                            {boardType === "esp32-eda6" ? t("eda6FlashBtn") : t("esp32FlashBtn")}
                          </button>
                          <button
                            type="button"
                            className="toolbar-menu-item toolbar-menu-item--secondary"
                            onClick={() => {
                              onDeleteMainPy();
                              setBoardMenuOpen(false);
                            }}
                          >
                            {t("eda6DeleteMainBtn")}
                          </button>
                          <button
                            type="button"
                            className="toolbar-menu-item toolbar-menu-item--secondary"
                            onClick={() => {
                              onRecoverRepl();
                              setBoardMenuOpen(false);
                            }}
                          >
                            {t("esp32RecoverReplBtn")}
                          </button>
                          <button
                            type="button"
                            className="toolbar-menu-item toolbar-menu-item--secondary"
                            onClick={() => {
                              onVerifyMainPy();
                              setBoardMenuOpen(false);
                            }}
                          >
                            {t("esp32VerifyMainBtn")}
                          </button>
                          {boardType === "esp32-eda6" ? (
                            <>
                              <button
                                type="button"
                                className="toolbar-menu-item toolbar-menu-item--secondary"
                                onClick={() => {
                                  onInstallEda6();
                                  setBoardMenuOpen(false);
                                }}
                              >
                                {t("eda6InstallBtn")}
                              </button>
                              <button
                                type="button"
                                className="toolbar-menu-item toolbar-menu-item--secondary"
                                onClick={() => {
                                  onVerifyEda6();
                                  setBoardMenuOpen(false);
                                }}
                              >
                                {t("eda6VerifyBtn")}
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {boardType === "arduino-firmata" ? (
                        <>
                          <div className="toolbar-menu-divider" />
                          <button
                            type="button"
                            className="toolbar-menu-item toolbar-menu-item--highlight"
                            onClick={() => {
                              onDownloadToArduino();
                              setBoardMenuOpen(false);
                            }}
                            disabled={downloadingArduino}
                          >
                            {t("arduinoDownloadBtn")}
                          </button>
                          <div className="toolbar-menu-hint">{t("arduinoDownloadMenuHint")}</div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
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
                      <Link
                        to="/login"
                        className="toolbar-menu-item"
                        role="menuitem"
                        onClick={() => setToolbarMenuOpen(false)}
                      >
                        {t("accountMenu")}
                      </Link>
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
                {editorShell}
                <div
                  className="splitter splitter-vertical"
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startConsoleWidthResize}
                />
                <div className="console-panel console-panel--side" style={{ width: `${consoleWidth}px` }}>
                  {canvasSize ? (
                    <div className="canvas-wrap">
                      <button type="button" className="canvas-close" onClick={() => setCanvasSize(null)} title="Cerrar canvas">&times;</button>
                      <canvas
                        ref={canvasRef}
                        width={canvasSize.w}
                        height={canvasSize.h}
                        className="pybot-canvas"
                      />
                    </div>
                  ) : null}
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
                    {waitingInput ? (
                      <span className="console-input-inline">
                        <span className="console-input-prompt">{inputPrompt}</span>
                        <input
                          ref={inputFieldRef}
                          className="console-input-field"
                          type="text"
                          autoComplete="off"
                          size="1"
                          onInput={(e) => { e.target.style.width = Math.max(1, e.target.value.length) + "ch"; }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              onInputSubmit(e.target.value);
                              e.target.value = "";
                              e.target.style.width = "1ch";
                            }
                          }}
                        />
                      </span>
                    ) : null}
                    <span ref={consoleEndRef} />
                  </pre>
                </div>
              </div>
            ) : (
              <>
                {editorShell}

                <div
                  className="splitter splitter-horizontal"
                  role="separator"
                  aria-orientation="horizontal"
                  onMouseDown={startConsoleResize}
                />
                <div className="console-panel" style={{ height: `${consoleHeight}px` }}>
                  {canvasSize ? (
                    <div className="canvas-wrap">
                      <button type="button" className="canvas-close" onClick={() => setCanvasSize(null)} title="Cerrar canvas">&times;</button>
                      <canvas
                        ref={canvasRef}
                        width={canvasSize.w}
                        height={canvasSize.h}
                        className="pybot-canvas"
                      />
                    </div>
                  ) : null}
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
                    {waitingInput ? (
                      <span className="console-input-inline">
                        <span className="console-input-prompt">{inputPrompt}</span>
                        <input
                          ref={inputFieldRef}
                          className="console-input-field"
                          type="text"
                          autoComplete="off"
                          size="1"
                          onInput={(e) => { e.target.style.width = Math.max(1, e.target.value.length) + "ch"; }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              onInputSubmit(e.target.value);
                              e.target.value = "";
                              e.target.style.width = "1ch";
                            }
                          }}
                        />
                      </span>
                    ) : null}
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
          {pythonOnly
            ? t("pythonOnlyOn")
            : connected
              ? boardType === "arduino-firmata"
                ? t("statusConn")
                : t("statusConnEsp32")
              : t("statusDisc")}
          {connected && hardwareBaudRate() ? (
            <>
              <span className="status-sep">·</span>
              {hardwareBaudRate()} baud
            </>
          ) : null}
        </span>
        <span className="status-meta">{t("statusMeta")}</span>
      </footer>

      <ConnectUsbModal
        open={connectModalOpen}
        boardType={boardType}
        connecting={connecting}
        preparing={connectModalPreparing}
        phase={connectModalPhase}
        errorMessage={connectModalError}
        showHelp={connectModalShowHelp}
        onClose={() => {
          if (!connecting) setConnectModalOpen(false);
        }}
        onConnect={onConnectFromModal}
        onToggleHelp={() => setConnectModalShowHelp((v) => !v)}
      />

      {settingsOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div
            className="modal modal--settings"
            role="dialog"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="settings-title" className="modal-title">
                {t("settings")}
              </h3>
            </div>
            <div className="modal-body">
              <div className="modal-section-title">{t("settingsSectionWork")}</div>
              <label className="modal-row">
                <span className="modal-label">{t("modeLabel")}</span>
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
              </label>
              <label className="modal-row">
                <span className="modal-label">{t("editorLabel")}</span>
                <select
                  value={editorMode}
                  onChange={(e) => switchRepresentation(e.target.value)}
                  className="modal-select"
                >
                  <option value="flow">{t("repFlow")}</option>
                  <option value="pseudo">{t("repPseudo")}</option>
                  <option value="python">{t("editorPython")}</option>
                  <option value="pyblock">{t("editorPyblock")}</option>
                </select>
              </label>

              <div className="modal-section-title">{t("settingsSectionAppearance")}</div>
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

              <div className="modal-section-title">{t("settingsSectionLangConn")}</div>
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
                <span className="modal-label">{t("connectAssistantLabel")}</span>
                <select
                  value={connectAssistant ? "1" : "0"}
                  onChange={(e) => {
                    const on = e.target.value === "1";
                    setConnectAssistant(on);
                    setConnectAssistantEnabled(on);
                    if (!on) setConnectModalOpen(false);
                  }}
                  className="modal-select"
                >
                  <option value="1">{t("connectAssistantOn")}</option>
                  <option value="0">{t("connectAssistantOff")}</option>
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="modal-reset" onClick={resetDefaults}>
                {t("resetDefaults")}
              </button>
              <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
                {t("close")}
              </button>
            </div>
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
              {/* LOGO PyBot WEB: PNG nuevo (pybot-logo-web2.png). Para revertir a los SVG originales, volver a src="/branding/pybot-logo-full.svg" (sin ?v=web2). */}
              <img src="/branding/pybot-logo-web2.png?v=web2" alt="PyBot" className="about-logo" />
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
