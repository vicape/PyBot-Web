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
    language: "Idioma",
    close: "Cerrar",
    clearConsole: "Limpiar consola",
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
      "Web Serial no está disponible. Usá Google Chrome o Microsoft Edge actualizado (no Firefox ni Safari).",
    usbErr_HTTPS:
      "Abrí PyBot con https:// o solo en localhost — Web Serial no funciona en sitios inseguros (http en otra máquina).",
    usbErr_LIST_EMPTY:
      "No elegiste puerto, la lista salió vacía, o cancelaste. En una PC “nueva” casi siempre falta: (1) Driver USB-serial para tu placa: CH340 o CP210x (buscá en Google “CH340 driver Windows”). (2) Cable USB que lleve datos, no solo carga. (3) Otro puerto USB del PC. (4) En Windows: Administrador de dispositivos → debería verse un “Puerto COM”. Sin COM, el navegador no puede listar el Arduino.",
    usbErr_PERMISSION:
      "El navegador bloqueó el USB. Revisá el candado de la barra de direcciones y permití el acceso al puerto serie.",
    usbErr_FIRMATA:
      "El puerto abrió pero no respondió como StandardFirmata. Subí el sketch “StandardFirmata” desde el IDE de Arduino, cerrá el Monitor Serie del IDE (solo un programa puede usar el COM) y volvé a conectar. Detalle técnico:",
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

Por dentro Pyodide adapta el código para ejecutar hardware de forma compatible.

USB / puerto no aparece:
• Solo Chrome o Edge (Chromium). HTTPS o localhost.
• Driver CH340 o CP2102 según el chip de tu placa; cable de datos; otro USB.
• En el Arduino: StandardFirmata cargado; cerrar Monitor Serie del IDE.

Chrome + cable USB + StandardFirmata en el Arduino.`,
    aboutBody: `PyBot Web
Versión web del entorno PyBot para aprender Python + robótica.

Características:
• Editor profesional con ejemplos.
• Modo Arduino (Web Serial + Firmata).
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
    language: "Language",
    close: "Close",
    clearConsole: "Clear console",
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
      "Web Serial is not available. Use Google Chrome or Microsoft Edge (not Firefox or Safari).",
    usbErr_HTTPS:
      "Open PyBot over https:// or localhost only — Web Serial does not work on insecure http (except localhost).",
    usbErr_LIST_EMPTY:
      "No port selected, the list was empty, or you cancelled. On a fresh PC you usually need: (1) USB–serial driver for your board: CH340 or CP210x (search “CH340 driver Windows”). (2) A USB cable that carries data, not charge-only. (3) Another USB port. (4) In Windows Device Manager you should see a COM port — without COM, the browser cannot list the Arduino.",
    usbErr_PERMISSION:
      "The browser blocked USB access. Check the site permissions icon and allow serial port access.",
    usbErr_FIRMATA:
      "The port opened but did not answer as StandardFirmata. Upload the “StandardFirmata” sketch from the Arduino IDE, close the IDE Serial Monitor (only one app can use the COM port), and connect again. Technical detail:",
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

Pyodide adapts code internally to run hardware calls safely.

USB / empty port list:
• Chrome or Edge (Chromium) only. HTTPS or localhost.
• CH340 or CP2102 driver depending on your board; data-capable cable; try another USB port.
• On the Arduino: StandardFirmata uploaded; close the IDE Serial Monitor.

Chrome + USB + StandardFirmata on the Arduino.`,
    aboutBody: `PyBot Web
Web edition of PyBot to learn Python + robotics.

Features:
• Professional editor with examples.
• Arduino mode (Web Serial + Firmata).
• Python-only mode for classes without hardware.
• Built-in help and direct run flow.

Built by VIC.`,
  },
};

export function getLang() {
  return localStorage.getItem("pybot_lang") || "es";
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
    const detail = m.slice("PYBOT_FIRMATA:".length);
    return `${t("usbErr_FIRMATA")} ${detail}`;
  }
  return m;
}
