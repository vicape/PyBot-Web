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
    theme: "Tema",
    themeDark: "Oscuro",
    themeLight: "Claro",
    language: "Idioma",
    close: "Cerrar",
    clearConsole: "Limpiar consola",
    statusReady: "Listo",
    statusRunning: "Ejecutando…",
    statusConn: "Arduino conectado",
    statusDisc: "Sin Arduino",
    logDisconnected: "USB desconectado.",
    needConnect: "Conectá el USB antes de ejecutar código con pin/motor/servo.",
    pyodideLoad: "Cargando Python (primera vez puede tardar)…",
    statusMeta: "Python · mismo estilo que escritorio",
    helpBody: `Es el mismo Python y la misma forma de escribir que en PyBot de escritorio (sin async ni await en tu código):

  pin("out", 2, 1)
  pin("in", 7)
  pin("in", "A0")
  x = pin("in", "A0")
  servo(10, 90)
  motor(10, 50)
  wait(1)

Plantilla típica:

  def main():
      ...

  main()

Por dentro el navegador usa Pyodide; las llamadas al USB se resuelven con run_sync (recomendado Chrome actualizado).

Si pegaste código viejo con await, al ejecutar se intenta adaptar solo.

Chrome + cable USB + StandardFirmata en el Arduino.`,
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
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    language: "Language",
    close: "Close",
    clearConsole: "Clear console",
    statusReady: "Ready",
    statusRunning: "Running…",
    statusConn: "Arduino connected",
    statusDisc: "No Arduino",
    logDisconnected: "USB disconnected.",
    needConnect: "Connect USB before running code that uses pin/motor/servo.",
    pyodideLoad: "Loading Python (first load may take a while)…",
    statusMeta: "Python · same style as desktop",
    helpBody: `Same Python and the same way of writing as desktop PyBot (no async/await in your code):

  pin("out", 2, 1)
  pin("in", 7)
  pin("in", "A0")
  x = pin("in", "A0")
  servo(10, 90)
  motor(10, 50)
  wait(1)

Typical template:

  def main():
      ...

  main()

The browser runs Pyodide; USB calls use run_sync under the hood (Chrome recommended).

If you paste older code with await, the runner tries to adapt it.

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
