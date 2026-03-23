const STRINGS = {
  es: {
    appTitle: "PyBot Web",
    brandSub: "by VIC · Python + Arduino en el navegador",
    explorer: "EXPLORADOR",
    examples: "EJEMPLOS",
    terminal: "TERMINAL",
    run: "Ejecutar",
    stop: "Detener",
    connect: "Conectar USB",
    disconnect: "Desconectar",
    settings: "Configuración",
    help: "Ayuda",
    about: "Acerca de",
    theme: "Tema",
    themeDark: "Oscuro",
    themeLight: "Claro",
    contrast: "Contraste",
    contrastNormal: "Normal",
    contrastHigh: "Alto",
    language: "Idioma",
    fontSize: "Tamano de fuente",
    terminalPosition: "Posicion de la terminal",
    terminalBottom: "Abajo",
    terminalRight: "Derecha",
    close: "Cerrar",
    resetDefaults: "Restablecer valores por defecto",
    clearConsole: "Limpiar consola",
    modeLabel: "Modo",
    modeHardware: "Python + Hardware",
    modePythonOnly: "Python Solo",
    statusConnectedShort: "Conectado",
    statusDisconnectedShort: "Sin USB",
    pythonOnly: "Solo Python (sin Arduino)",
    pythonOnlyOn: "Solo Python activo",
    statusReady: "Listo",
    statusRunning: "Ejecutando…",
    statusConn: "Arduino conectado",
    statusDisc: "Sin Arduino",
    logDisconnected: "USB desconectado.",
    needConnect:
      "Conectá el USB antes de ejecutar código con pin/motor/servo, o activá Solo Python.",
    usbErr_MISSING_BROWSER:
      "Este dispositivo o navegador no tiene compatibilidad USB suficiente para esta función.",
    usbErr_HTTPS:
      "La aplicación debe abrirse en un entorno seguro para habilitar la conexión USB.",
    usbErr_LIST_EMPTY:
      "No se encontró ningún puerto disponible o se canceló la selección. Verificá cable de datos, drivers del sistema y que el dispositivo aparezca como puerto serie.",
    usbErr_PERMISSION:
      "La aplicación no tiene permisos para acceder al USB. Revisá permisos del navegador y del sistema.",
    usbErr_FIRMATA:
      "El dispositivo USB no respondió correctamente. Reiniciá la placa, cerrá otras apps que usen el puerto y volvé a intentar.",
    pyodideLoad: "Cargando Python (primera vez puede tardar)…",
    statusMeta: "Python · mismo estilo que escritorio",
    helpBody: `PyBot Web usa Python estilo escritorio: escribís pin/motor/servo/wait sin async/await.

  pin("out", 2, 1)
  pin("in", 7)
  pin("in", "A0")
  x = pin("in", "A0")
  servo(10, 90)
  motor(10, 50)
  wait(1)

No hace falta envolver en main(); podés escribir líneas directas.

El entorno adapta el código automáticamente para ejecutar de forma compatible.

USB / puerto no aparece:
• Solo Chrome o Edge (Chromium). HTTPS o localhost.
• Driver CH340 o CP2102 según el chip de tu placa; cable de datos; otro USB.
• Cerrar cualquier otra app que esté usando el mismo puerto USB.

Recomendado: navegador actualizado + cable USB de datos.`,
    aboutBody: `PyBot Web
Versión web del entorno PyBot para aprender Python + robótica.

Características:
• Editor profesional con ejemplos.
• Modo Python + Hardware.
• Modo Solo Python para clases sin hardware.
• Ayuda integrada y ejecución directa.

Creado por VIC.`,
  },
  en: {
    appTitle: "PyBot Web",
    brandSub: "by VIC · Python + Arduino in the browser",
    explorer: "EXPLORER",
    examples: "EXAMPLES",
    terminal: "TERMINAL",
    run: "Run",
    stop: "Stop",
    connect: "Connect USB",
    disconnect: "Disconnect",
    settings: "Settings",
    help: "Help",
    about: "About",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    contrast: "Contrast",
    contrastNormal: "Normal",
    contrastHigh: "High",
    language: "Language",
    fontSize: "Font size",
    terminalPosition: "Terminal position",
    terminalBottom: "Bottom",
    terminalRight: "Right",
    close: "Close",
    resetDefaults: "Reset to defaults",
    clearConsole: "Clear console",
    modeLabel: "Mode",
    modeHardware: "Python + Hardware",
    modePythonOnly: "Python only",
    statusConnectedShort: "Connected",
    statusDisconnectedShort: "No USB",
    pythonOnly: "Python only (no Arduino)",
    pythonOnlyOn: "Python only enabled",
    statusReady: "Ready",
    statusRunning: "Running…",
    statusConn: "Arduino connected",
    statusDisc: "No Arduino",
    logDisconnected: "USB disconnected.",
    needConnect:
      "Connect USB before running code that uses pin/motor/servo, or enable Python only.",
    usbErr_MISSING_BROWSER:
      "This device or browser lacks enough USB compatibility for this feature.",
    usbErr_HTTPS:
      "The app must run in a secure context to enable USB connection.",
    usbErr_LIST_EMPTY:
      "No ports were found or selection was cancelled. Check data cable, system drivers, and verify the device appears as a serial port.",
    usbErr_PERMISSION:
      "The app does not have USB access permissions. Check browser and system permissions.",
    usbErr_FIRMATA:
      "The USB device did not respond correctly. Restart the board, close other apps using the same port, and try again.",
    pyodideLoad: "Loading Python (first load may take a while)…",
    statusMeta: "Python · same style as desktop",
    helpBody: `PyBot Web keeps desktop-style Python: write pin/motor/servo/wait without async/await.

  pin("out", 2, 1)
  pin("in", 7)
  pin("in", "A0")
  x = pin("in", "A0")
  servo(10, 90)
  motor(10, 50)
  wait(1)

You don't need a main() wrapper; direct top-level lines are fine.

The runtime adapts code automatically for safe execution.

USB / empty port list:
• Chrome or Edge (Chromium) only. HTTPS or localhost.
• CH340 or CP2102 driver depending on your board; data-capable cable; try another USB port.
• Close any other app using the same USB port.

Recommended: updated browser + data-capable USB cable.`,
    aboutBody: `PyBot Web
Web edition of PyBot to learn Python + robotics.

Features:
• Professional editor with examples.
• Python + Hardware mode.
• Python-only mode for classes without hardware.
• Built-in help and direct run flow.

Built by VIC.`,
  },
};

export function getLang() {
  return localStorage.getItem("pybot_lang") || "en";
}

export function setLang(lang) {
  localStorage.setItem("pybot_lang", lang);
}

export function t(key) {
  const lang = getLang();
  return STRINGS[lang]?.[key] ?? STRINGS.es[key] ?? key;
}

/**
 * Mensajes de hardwareBridge (PYBOT_USB:… / PYBOT_FIRMATA:…)
 * @param {string} message
 */
export function formatHardwareError(message) {
  const m = String(message ?? "");
  if (m.startsWith("PYBOT_USB:")) {
    const code = m.slice("PYBOT_USB:".length);
    const key = `usbErr_${code}`;
    const out = t(key);
    if (out !== key) return out;
  }
  if (m.startsWith("PYBOT_FIRMATA:")) {
    return t("usbErr_FIRMATA");
  }
  return m;
}
