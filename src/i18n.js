const STRINGS = {
  es: {
    appTitle: "PyBot Web by VIC",
    explorer: "EXPLORADOR",
    examples: "EJEMPLOS",
    terminal: "TERMINAL",
    run: "Ejecutar",
    stop: "Detener",
    connect: "Conectar USB",
    disconnect: "Desconectar",
    settings: "Configuración",
    help: "Ayuda",
    theme: "Tema",
    themeDark: "Oscuro",
    themeLight: "Claro",
    language: "Idioma",
    close: "Cerrar",
    statusReady: "Listo",
    statusRunning: "Ejecutando…",
    statusConn: "Arduino conectado",
    statusDisc: "Sin Arduino",
    needConnect: "Conectá el USB antes de ejecutar código con pin/motor/servo.",
    pyodideLoad: "Cargando Python (primera vez puede tardar)…",
    helpBody: `PyBot Web usa Python en el navegador (Pyodide) con la misma API que PyBot de escritorio, pero con async/await:

  await pin("out", 2, 1)
  await pin("in", 7)
  await pin("in", "A0")
  await servo(10, 90)
  await motor(10, 50)
  await wait(1)

Siempre usá async def main(): ... y al final (Pyodide ya tiene event loop activo):
  await main()
  (no uses asyncio.run(main()) — falla en el navegador)

Chrome + cable USB + StandardFirmata en el Arduino.`,
  },
  en: {
    appTitle: "PyBot Web by VIC",
    explorer: "EXPLORER",
    examples: "EXAMPLES",
    terminal: "TERMINAL",
    run: "Run",
    stop: "Stop",
    connect: "Connect USB",
    disconnect: "Disconnect",
    settings: "Settings",
    help: "Help",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    language: "Language",
    close: "Close",
    statusReady: "Ready",
    statusRunning: "Running…",
    statusConn: "Arduino connected",
    statusDisc: "No Arduino",
    needConnect: "Connect USB before running code that uses pin/motor/servo.",
    pyodideLoad: "Loading Python (first load may take a while)…",
    helpBody: `PyBot Web runs Python in the browser (Pyodide) with the same API as desktop PyBot, using async/await:

  await pin("out", 2, 1)
  await pin("in", 7)
  await pin("in", "A0")
  await servo(10, 90)
  await motor(10, 50)
  await wait(1)

Always use async def main(): ... and end with (Pyodide already runs an event loop):
  await main()
  (do not use asyncio.run(main()) — it fails in the browser)

Chrome + USB + StandardFirmata on the Arduino.`,
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
