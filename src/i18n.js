const STRINGS = {
  es: {
    appTitle: "PyBot Web",
    brandSub: "by VIC · Python + Arduino en el navegador",
    explorer: "EXPLORADOR",
    examples: "EJEMPLOS",
    terminal: "TERMINAL",
    terminalOutput: "Salida",
    run: "Ejecutar",
    stop: "Detener",
    openFile: "Abrir .py",
    saveFile: "Guardar .py",
    connect: "Conectar USB",
    disconnect: "Desconectar",
    settings: "Configuración",
    settingsSectionWork: "Modo de trabajo",
    settingsSectionAppearance: "Apariencia",
    settingsSectionLangConn: "Idioma y conexión",
    menu: "Menu",
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
    accountMenu: "Cuenta / login",
    menuActions: "Acciones",
    menuSectionBoard: "Placa y conexión",
    menuBoardToolsLabel: "Herramientas de la placa",
    boardMenuTitle: "Placa",
    modeLabel: "Modo",
    modeHardware: "Python + Hardware",
    modePythonOnly: "Python Solo",
    boardLabel: "Placa",
    boardArduino: "Arduino Uno/Nano compatible",
    boardEsp32Mp: "ESP32 MicroPython - GPIO directo",
    boardEsp32Eda6: "ESP32 EDA6 / WEMOS",
    eda6ProfileLabel: "Perfil EDA6",
    eda6ProfileWemos: "WEMOS (recomendado)",
    eda6ProfileEsp32: "ESP32 (otro pinout)",
    eda6Hint: "Usá puertos 1 a 4 (no GPIO). Compatible con programas de Thonny.",
    eda6ProfileWarnEsp32:
      "Perfil ESP32 activo: puerto 1 servo = GPIO 33. Si tu placa es WEMOS, elegí perfil WEMOS (GPIO 25).",
    eda6ProfileWarnWemos:
      "Perfil WEMOS activo: puerto 1 servo = GPIO 25.",
    statusConnEsp32: "ESP32 conectada",
    eda6ConnectedWemos: "Perfil EDA6/WEMOS conectado. Puertos 1–4 listos.",
    eda6ConnectedEsp32: "Perfil EDA6/ESP32 conectado. Puertos 1–4 listos.",
    eda6Running: "Enviando programa EDA6 a la ESP32…",
    boardProgramRunning:
      "Programa en ejecución en la placa. Usá Detener para parar.",
    eda6RunUploading:
      "Subiendo librería EDA6 a la placa (puede tardar unos segundos)…",
    eda6RunSlowInject:
      "EDA6.py no está en la placa: se sube la librería completa (puede tardar unos segundos). Recomendado: Menú → Instalar librería EDA6.",
    eda6Installing: "Instalando EDA6.py en la placa…",
    eda6InstalledOk: "Librería EDA6 instalada correctamente en la placa.",
    eda6InstallFail: "No se pudo instalar EDA6.py. Reconectá la placa e intentá de nuevo.",
    eda6MissingLib:
      "Falta EDA6.py en la placa. Usá «Instalar librería EDA6» o «Grabar en ESP32».",
    eda6FlashedOk:
      "Programa EDA6 grabado. La placa se reinició. Desconectá PyBot: no reconectes si querés que el servo siga solo.",
    eda6MainDeleted:
      "main.py borrado. Tras reiniciar la placa, no ejecutará programa autónomo.",
    eda6VerifyOk: "EDA6.py está instalada en la placa.",
    eda6VerifyMissing: "EDA6.py no está en la placa. Instalala antes de grabar.",
    eda6FlashBtn: "Dejar programa en la placa",
    esp32FlashBtn: "Dejar programa en la placa",
    arduinoDownloadBtn: "Bajar a Arduino (correr solo)",
    arduinoDownloadMenuHint:
      "Graba tu programa en la placa para que funcione desconectada de la PC.",
    arduinoDownloadStart: "Preparando tu programa para el Arduino…",
    arduinoDownloadFlashing:
      "Instalando el intérprete PyBot en la placa (solo la primera vez)…",
    arduinoDownloadUploading: "Enviando el programa a la placa…",
    arduinoDownloadOk:
      "¡Listo! Tu programa quedó en el Arduino ({bytes} bytes). Ya podés desconectarlo de la PC: arranca solo al darle energía.",
    arduinoDownloadUnsupported:
      "Esto todavía no se puede bajar al Arduino (probalo en vivo):",
    editorLabel: "Editor",
    editorPython: "Python",
    editorPyblock: "PyBlock",
    pyblockLoading: "Cargando PyBlock…",
    pyblockEmpty:
      "PyBlock está vacío: arrastrá bloques para armar tu programa antes de ejecutar.",
    syntaxErrorPrefix: "Error de sintaxis:",
    lineWord: "línea",
    pyblockStart: "Inicio",
    pyblockStartTooltip: "Bloque de inicio: poné acá los bloques de tu programa.",
    arduinoNoFunctions:
      "Este programa usa procedimientos o funciones. Todavía no son compatibles con Bajar a Arduino. Ejecutalo en vivo o pasá a Python.",
    arduinoNoCanvas:
      "Los bloques Canvas solo funcionan en pantalla. No se pueden bajar al Arduino.",
    boardNoCanvas:
      "Los bloques Canvas solo funcionan en pantalla. No se pueden grabar en la placa.",
    esp32FlashOk:
      "Programa grabado en la ESP32. La placa se reinició y ya corre sola. Desconectá PyBot del USB: no vuelvas a conectar si querés que siga solo (conectar detiene el programa).",
    esp32FlashVerified: "Verificación OK: main.py de {size} bytes en la placa.",
    esp32FlashVerifyFail: "No se pudo verificar el programa en la placa antes de reiniciar.",
    esp32FlashVerifyMissing: "Falta main.py en la placa después de grabar.",
    esp32FlashVerifyCompile: "main.py tiene un error y no puede ejecutarse al arrancar.",
    esp32FlashVerifyEda6: "No se pudo importar EDA6.py. Reinstalá la librería EDA6.",
    esp32FlashVerifyHw: "No se pudo importar pybot_hw.py.",
    esp32ReconnectWarn:
      "Si la placa ya tiene un programa corriendo solo, conectar PyBot puede detenerlo. Usá «Recuperar REPL» solo para editar.",
    esp32RecoverReplBtn: "Recuperar REPL (detiene programa en placa)",
    esp32FlashHint:
      "Grabá el programa en la ESP32 para que siga corriendo al desconectar el USB de PyBot.",
    esp32MainPresent: "main.py está en la placa: al reiniciar corre el programa grabado.",
    esp32MainMissing: "No hay main.py en la placa. Grabá el programa para que corra solo.",
    esp32VerifyMainBtn: "Verificar programa en placa",
    eda6DeleteMainBtn: "Borrar programa de la placa",
    eda6InstallBtn: "Instalar librería EDA6",
    eda6VerifyBtn: "Verificar EDA6",
    eda6PortOutOfRange: "Puerto EDA6 fuera de rango. Usá 1, 2, 3 o 4.",
    eda6LcdNotFound:
      "LCD no detectado. Conectá un LCD I2C o quitá las funciones LCD del programa.",
    boardHint: "Elegí la placa antes de conectar el USB.",
    mpyConnected: "ESP32 MicroPython conectada. El programa correrá en la placa.",
    mpyRunning: "Enviando programa a la ESP32…",
    statusConnectedShort: "Conectado",
    statusDisconnectedShort: "Sin USB",
    pythonOnly: "Solo Python (sin Arduino)",
    pythonOnlyOn: "Solo Python activo",
    statusReady: "Listo",
    statusRunning: "Ejecutando…",
    statusConn: "Arduino conectado",
    statusDisc: "Sin Arduino",
    logDisconnected: "USB desconectado.",
    fileLoaded: "Archivo cargado:",
    fileSaved: "Archivo guardado:",
    needConnect:
      "Conectá el USB antes de ejecutar código de hardware, Arduino, ESP32 o EDA6 (pin, motor, servo, sensores, LCD); o activá Solo Python.",
    needHardwareMode: "Para conectar una placa, cambiá a Python + Hardware.",
    connectModalTitle: "Conexión USB",
    connectModalIntro:
      "Elegí el puerto de tu placa en el diálogo del navegador. Si no aparece, revisá los puntos de abajo.",
    connectModalChecksLabel: "Requisitos del sistema",
    connectCheck_webSerial: "Navegador compatible (Chrome o Edge actual)",
    connectCheck_https: "Sitio seguro (HTTPS o localhost)",
    connectCheck_knownPorts: "Esta PC ya autorizó {n} puerto(s) USB antes",
    connectModalConnecting: "Conectando…",
    connectModalPreparing: "Preparando tu Arduino…",
    connectShowHelp: "¿La placa no aparece?",
    connectHideHelp: "Ocultar ayuda",
    connectHelpTitle: "Si la placa no aparece",
    connectHelpStep1: "Usá un cable USB de datos (no solo de carga).",
    connectHelpStep2: "Desconectá y volvé a conectar la placa; probá otro puerto USB de la PC.",
    connectHelpStep3: "Cerrá Arduino IDE o Thonny si están abiertos, y volvé a pulsar Conectar USB.",
    connectHelpBrowser:
      "Usá Chrome o Edge actualizado. Firefox y Safari no soportan conexión USB desde el navegador.",
    connectHelpHttps:
      "Abrí PyBot desde https://… o desde localhost. Las páginas sin HTTPS bloquean el USB.",
    connectHelpPermission:
      "Permití el acceso USB cuando el navegador lo pida. Si cancelaste antes, recargá la página e intentá de nuevo.",
    connectModalFoot:
      "Podés desactivar este asistente en Configuración → «Asistente de conexión USB» (modo anterior).",
    connectAssistantLabel: "Asistente de conexión USB",
    connectAssistantOn: "Activado (recomendado)",
    connectAssistantOff: "Desactivado — conectar directo como antes",
    usbErr_MISSING_BROWSER:
      "Este dispositivo o navegador no tiene compatibilidad USB suficiente para esta función.",
    usbErr_HTTPS:
      "La aplicación debe abrirse en un entorno seguro para habilitar la conexión USB.",
    usbErr_LIST_EMPTY:
      "No se encontró la placa o se canceló la selección. Revisá el cable USB y probá de nuevo.",
    usbErr_PERMISSION:
      "La aplicación no tiene permisos para acceder al USB. Revisá permisos del navegador y del sistema.",
    usbErr_FIRMATA:
      "El dispositivo USB no respondió correctamente. Reiniciá la placa, cerrá otras apps que usen el puerto y volvé a intentar.",
    usbErr_FIRMATA_NO_FIRMATA:
      "No se pudo preparar el Arduino. Probá desconectarlo y volver a conectar.",
    usbErr_FIRMATA_FLASH_FAIL:
      "No pudimos preparar el Arduino. Revisá el cable USB, que sea Arduino Uno o Nano, y cerrá Arduino IDE o Thonny si están abiertos.",
    arduinoFirmataFlashing:
      "Preparando tu Arduino, esperá unos segundos…",
    arduinoFirmataFlashOk: "¡Listo! Tu Arduino ya está preparado.",
    arduinoConnected: "¡Arduino conectado!",
    usbErr_ESP32_NO_RESPONSE:
      "La placa ESP32 no respondió. Verificá que tenga cargado el firmware PyBot ESP32, el cable de datos y que ninguna otra app use el puerto.",
    usbErr_ESP32_BAD_FIRMWARE:
      "La placa respondió, pero no parece tener el firmware PyBot ESP32 correcto. Cargá firmware/pybot-esp32 y volvé a intentar.",
    usbErr_ESP32_GENERIC:
      "No se pudo conectar con la placa ESP32. Revisá el firmware PyBot ESP32, el cable y el puerto.",
    usbErr_MPY_NEEDS_PREP:
      "Esta ESP32 necesita ser preparada para PyBot con MicroPython. (Próximamente: botón “Preparar ESP32”.)",
    usbErr_MPY_BUSY:
      "El puerto está ocupado por otra aplicación. Cerrá Arduino IDE, Thonny u otra app que use el puerto y reintentá.",
    usbErr_MPY_REPL_FAIL:
      "No se pudo entrar al REPL de MicroPython en la ESP32. Reconectá la placa y reintentá.",
    usbErr_MPY_GENERIC:
      "No se pudo conectar con la ESP32 en modo MicroPython. Revisá el cable, el puerto y que tenga MicroPython.",
    pyodideLoad: "Cargando Python (primera vez puede tardar)…",
    statusMeta: "Python",
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
• Cable USB de datos; probá otro puerto USB.
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
    aboutName: "PyBot by VIC",
    aboutDesc: "Un IDE para programar Arduino con Python. Disenado para que chicos aprendan a programar.",
    aboutAuthor: "Autor",
    aboutVersion: "Version",
  },
  en: {
    appTitle: "PyBot Web",
    brandSub: "by VIC · Python + Arduino in the browser",
    explorer: "EXPLORER",
    examples: "EXAMPLES",
    terminal: "TERMINAL",
    terminalOutput: "Output",
    run: "Run",
    stop: "Stop",
    openFile: "Open .py",
    saveFile: "Save .py",
    connect: "Connect USB",
    disconnect: "Disconnect",
    settings: "Settings",
    settingsSectionWork: "Work mode",
    settingsSectionAppearance: "Appearance",
    settingsSectionLangConn: "Language & connection",
    menu: "Menu",
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
    accountMenu: "Account / login",
    menuActions: "Actions",
    menuSectionBoard: "Board & connection",
    menuBoardToolsLabel: "Board tools",
    boardMenuTitle: "Board",
    modeLabel: "Mode",
    modeHardware: "Python + Hardware",
    modePythonOnly: "Python only",
    boardLabel: "Board",
    boardArduino: "Arduino Uno/Nano compatible",
    boardEsp32Mp: "ESP32 MicroPython - direct GPIO",
    boardEsp32Eda6: "ESP32 EDA6 / WEMOS",
    eda6ProfileLabel: "EDA6 profile",
    eda6ProfileWemos: "WEMOS (recommended)",
    eda6ProfileEsp32: "ESP32 (alternate pinout)",
    eda6Hint: "Use ports 1 to 4 (not GPIO). Compatible with Thonny programs.",
    eda6ProfileWarnEsp32:
      "ESP32 profile active: servo port 1 = GPIO 33. If your board is WEMOS, choose WEMOS profile (GPIO 25).",
    eda6ProfileWarnWemos:
      "WEMOS profile active: servo port 1 = GPIO 25.",
    statusConnEsp32: "ESP32 connected",
    eda6ConnectedWemos: "EDA6/WEMOS profile connected. Ports 1–4 ready.",
    eda6ConnectedEsp32: "EDA6/ESP32 profile connected. Ports 1–4 ready.",
    eda6Running: "Sending EDA6 program to the ESP32…",
    boardProgramRunning:
      "Program running on the board. Use Stop to halt.",
    eda6RunUploading:
      "Uploading EDA6 library to the board (may take a few seconds)…",
    eda6RunSlowInject:
      "EDA6.py is not on the board: uploading the full library (may take a few seconds). Recommended: Menu → Install EDA6 library.",
    eda6Installing: "Installing EDA6.py on the board…",
    eda6InstalledOk: "EDA6 library installed successfully on the board.",
    eda6InstallFail: "Could not install EDA6.py. Reconnect the board and try again.",
    eda6MissingLib:
      "EDA6.py is missing on the board. Use “Install EDA6 library” or “Flash to ESP32”.",
    eda6FlashedOk:
      "EDA6 program saved. The board restarted. Disconnect PyBot; do not reconnect if you want it to keep running alone.",
    eda6MainDeleted:
      "main.py deleted. After reset, the board will not run an autonomous program.",
    eda6VerifyOk: "EDA6.py is installed on the board.",
    eda6VerifyMissing: "EDA6.py is not on the board. Install it before flashing.",
    eda6FlashBtn: "Save program to board",
    esp32FlashBtn: "Save program to board",
    arduinoDownloadBtn: "Download to Arduino (run standalone)",
    arduinoDownloadMenuHint:
      "Store your program on the board so it works disconnected from the PC.",
    arduinoDownloadStart: "Preparing your program for the Arduino…",
    arduinoDownloadFlashing:
      "Installing the PyBot interpreter on the board (first time only)…",
    arduinoDownloadUploading: "Sending the program to the board…",
    arduinoDownloadOk:
      "Done! Your program is now on the Arduino ({bytes} bytes). You can unplug it from the PC: it runs on its own when powered.",
    arduinoDownloadUnsupported:
      "This can't be downloaded to the Arduino yet (try it live):",
    editorLabel: "Editor",
    editorPython: "Python",
    editorPyblock: "PyBlock",
    pyblockLoading: "Loading PyBlock…",
    pyblockEmpty:
      "PyBlock is empty: drag some blocks to build your program before running.",
    syntaxErrorPrefix: "Syntax error:",
    lineWord: "line",
    pyblockStart: "Start",
    pyblockStartTooltip: "Start block: put your program blocks here.",
    arduinoNoFunctions:
      "This program uses procedures or functions. They are not yet supported by Download to Arduino. Run it live or switch to Python.",
    arduinoNoCanvas:
      "Canvas blocks only work on screen. They cannot be downloaded to the Arduino.",
    boardNoCanvas:
      "Canvas blocks only work on screen. They cannot be saved to the board.",
    esp32FlashOk:
      "Program saved on the ESP32. The board restarted. Disconnect PyBot: do not reconnect if you want it to keep running alone.",
    esp32FlashVerified: "Verification OK: main.py is {size} bytes on the board.",
    esp32FlashVerifyFail: "Could not verify the program on the board before restart.",
    esp32FlashVerifyMissing: "main.py is missing on the board after flashing.",
    esp32FlashVerifyCompile: "main.py has an error and cannot run on boot.",
    esp32FlashVerifyEda6: "Could not import EDA6.py. Reinstall the EDA6 library.",
    esp32FlashVerifyHw: "Could not import pybot_hw.py.",
    esp32ReconnectWarn:
      "If the board is already running a program on its own, connecting PyBot may stop it. Use «Recover REPL» only to edit.",
    esp32RecoverReplBtn: "Recover REPL (stops program on board)",
    esp32FlashHint:
      "Save the program on the ESP32 so it keeps running when you disconnect USB from PyBot.",
    esp32MainPresent: "main.py is on the board: it runs the saved program after reset.",
    esp32MainMissing: "No main.py on the board. Save the program to run autonomously.",
    esp32VerifyMainBtn: "Verify program on board",
    eda6DeleteMainBtn: "Delete program from board",
    eda6InstallBtn: "Install EDA6 library",
    eda6VerifyBtn: "Verify EDA6",
    eda6PortOutOfRange: "EDA6 port out of range. Use 1, 2, 3, or 4.",
    eda6LcdNotFound:
      "LCD not detected. Connect an I2C LCD or remove LCD functions from your program.",
    boardHint: "Pick the board before connecting USB.",
    mpyConnected: "ESP32 MicroPython connected. The program will run on the board.",
    mpyRunning: "Sending program to the ESP32…",
    statusConnectedShort: "Connected",
    statusDisconnectedShort: "No USB",
    pythonOnly: "Python only (no Arduino)",
    pythonOnlyOn: "Python only enabled",
    statusReady: "Ready",
    statusRunning: "Running…",
    statusConn: "Arduino connected",
    statusDisc: "No Arduino",
    logDisconnected: "USB disconnected.",
    fileLoaded: "File loaded:",
    fileSaved: "File saved:",
    needConnect:
      "Connect USB before running hardware, Arduino, ESP32 or EDA6 code (pin, motor, servo, sensors, LCD); or enable Python only.",
    needHardwareMode: "To connect a board, switch to Python + Hardware.",
    connectModalTitle: "USB connection",
    connectModalIntro:
      "Pick your board's port in the browser dialog. If nothing shows up, check the items below.",
    connectModalChecksLabel: "System requirements",
    connectCheck_webSerial: "Compatible browser (up-to-date Chrome or Edge)",
    connectCheck_https: "Secure site (HTTPS or localhost)",
    connectCheck_knownPorts: "This PC previously authorized {n} USB port(s)",
    connectModalConnecting: "Connecting…",
    connectModalPreparing: "Getting your Arduino ready…",
    connectShowHelp: "Board not showing up?",
    connectHideHelp: "Hide help",
    connectHelpTitle: "If the board does not show up",
    connectHelpStep1: "Use a data USB cable (not charge-only).",
    connectHelpStep2: "Unplug and replug the board; try another USB port on the PC.",
    connectHelpStep3: "Close Arduino IDE or Thonny if open, then click Connect USB again.",
    connectHelpBrowser:
      "Use up-to-date Chrome or Edge. Firefox and Safari do not support USB from the browser.",
    connectHelpHttps:
      "Open PyBot via https://… or localhost. Non-HTTPS pages block USB access.",
    connectHelpPermission:
      "Allow USB access when the browser asks. If you cancelled before, reload and try again.",
    connectModalFoot:
      "You can turn off this assistant in Settings → «USB connection assistant» (legacy mode).",
    connectAssistantLabel: "USB connection assistant",
    connectAssistantOn: "On (recommended)",
    connectAssistantOff: "Off — connect directly as before",
    usbErr_MISSING_BROWSER:
      "This device or browser lacks enough USB compatibility for this feature.",
    usbErr_HTTPS:
      "The app must run in a secure context to enable USB connection.",
    usbErr_LIST_EMPTY:
      "Board not found or selection was cancelled. Check the USB cable and try again.",
    usbErr_PERMISSION:
      "The app does not have USB access permissions. Check browser and system permissions.",
    usbErr_FIRMATA:
      "The USB device did not respond correctly. Restart the board, close other apps using the same port, and try again.",
    usbErr_FIRMATA_NO_FIRMATA:
      "Could not get the Arduino ready. Try unplugging it and connecting again.",
    usbErr_FIRMATA_FLASH_FAIL:
      "We could not get the Arduino ready. Check the USB cable, make sure it is an Arduino Uno or Nano, and close Arduino IDE or Thonny if they are open.",
    arduinoFirmataFlashing:
      "Getting your Arduino ready, please wait a few seconds…",
    arduinoFirmataFlashOk: "All set! Your Arduino is ready.",
    arduinoConnected: "Arduino connected!",
    usbErr_ESP32_NO_RESPONSE:
      "The ESP32 board did not respond. Make sure the PyBot ESP32 firmware is flashed, the cable carries data, and no other app is using the port.",
    usbErr_ESP32_BAD_FIRMWARE:
      "The board responded but does not seem to have the correct PyBot ESP32 firmware. Flash firmware/pybot-esp32 and try again.",
    usbErr_ESP32_GENERIC:
      "Could not connect to the ESP32 board. Check the PyBot ESP32 firmware, cable, and port.",
    usbErr_MPY_NEEDS_PREP:
      "This ESP32 needs to be prepared for PyBot with MicroPython. (Coming soon: a “Prepare ESP32” button.)",
    usbErr_MPY_BUSY:
      "The port is busy with another application. Close Arduino IDE, Thonny, or any app using the port and try again.",
    usbErr_MPY_REPL_FAIL:
      "Could not enter the MicroPython REPL on the ESP32. Reconnect the board and try again.",
    usbErr_MPY_GENERIC:
      "Could not connect to the ESP32 in MicroPython mode. Check the cable, port, and that MicroPython is installed.",
    pyodideLoad: "Loading Python (first load may take a while)…",
    statusMeta: "Python",
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
• Data-capable USB cable; try another USB port.
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
    aboutName: "PyBot by VIC",
    aboutDesc: "An IDE for programming Arduino with Python. Designed for kids learning to code.",
    aboutAuthor: "Author",
    aboutVersion: "Version",
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
    const code = m.slice("PYBOT_FIRMATA:".length);
    const key = `usbErr_FIRMATA_${code}`;
    const out = t(key);
    if (out !== key) return out;
    return t("usbErr_FIRMATA");
  }
  if (m.startsWith("PYBOT_ESP32:")) {
    const code = m.slice("PYBOT_ESP32:".length);
    const key = `usbErr_ESP32_${code}`;
    const out = t(key);
    if (out !== key) return out;
    return t("usbErr_ESP32_GENERIC");
  }
  if (m.startsWith("PYBOT_MPY:")) {
    const code = m.slice("PYBOT_MPY:".length);
    const key = `usbErr_MPY_${code}`;
    const out = t(key);
    if (out !== key) return out;
    return t("usbErr_MPY_GENERIC");
  }
  return m;
}

/**
 * Convierte errores de ejecución de Python en mensajes simples y educativos.
 * No expone trazas internas ni detalles técnicos complejos.
 * @param {string} message
 */
export function formatPythonError(message) {
  const m = String(message ?? "");
  const isEs = getLang() === "es";

  const pick = (es, en) => (isEs ? es : en);

  const unknown = pick(
    "No se pudo ejecutar el programa. Revisá la última parte de tu código y probá de nuevo.",
    "The program could not run. Check the last part of your code and try again.",
  );

  const firstDefinedName = m.match(/name ['"]([^'"]+)['"] is not defined/i)?.[1];

  if (/canvas_not_ready/i.test(m)) {
    return pick(
      "El canvas no está listo. Asegurate de llamar pantalla(ancho, alto) antes de dibujar.",
      "Canvas is not ready. Make sure to call pantalla(width, height) before drawing.",
    );
  }

  if (/SyntaxError|invalid syntax/i.test(m)) {
    return pick(
      "Error de sintaxis: hay una línea escrita con formato inválido. Revisá paréntesis, comillas, dos puntos y comas.",
      "Syntax error: one line has invalid format. Check parentheses, quotes, colons, and commas.",
    );
  }
  if (/IndentationError|unexpected indent|unindent does not match/i.test(m)) {
    return pick(
      "Error de indentación: la sangría no coincide. Usá la misma cantidad de espacios en bloques como if, for y def.",
      "Indentation error: spacing does not match. Use consistent indentation in blocks like if, for, and def.",
    );
  }
  if (/NameError/i.test(m)) {
    if (firstDefinedName) {
      return pick(
        `Nombre no definido: "${firstDefinedName}". Puede estar mal escrito o no fue creado antes de usarlo.`,
        `Undefined name: "${firstDefinedName}". It may be misspelled or used before being created.`,
      );
    }
    return pick(
      "Nombre no definido: hay una variable o función que no existe todavía.",
      "Undefined name: a variable or function does not exist yet.",
    );
  }
  if (/TypeError/i.test(m)) {
    return pick(
      "Tipo de dato incorrecto: una operación recibió un valor de tipo no esperado. Revisá si usás texto, número o lista correctamente.",
      "Wrong data type: an operation received an unexpected value type. Check whether you are using text, number, or list correctly.",
    );
  }
  if (/ESP32_GPIO_ONLY/.test(m)) {
    return pick(
      "En ESP32 usá número de GPIO, por ejemplo 34 (no A0–A5).",
      "On ESP32 use a GPIO number, e.g. 34 (not A0–A5).",
    );
  }
  if (/EDA6_PORT_RANGE/.test(m)) {
    return pick(t("eda6PortOutOfRange"), t("eda6PortOutOfRange"));
  }
  if (/EDA6_LCD_MISSING/.test(m)) {
    return pick(t("eda6LcdNotFound"), t("eda6LcdNotFound"));
  }
  if (/EDA6_MISSING_LIB|No module named 'EDA6'|No module named EDA6/.test(m)) {
    return pick(t("eda6MissingLib"), t("eda6MissingLib"));
  }
  if (/INSTALL_FAIL/.test(m)) {
    return pick(t("eda6InstallFail"), t("eda6InstallFail"));
  }
  if (/FLASH_VERIFY_FAIL:missing_main/.test(m)) {
    return pick(t("esp32FlashVerifyMissing"), t("esp32FlashVerifyMissing"));
  }
  if (/FLASH_VERIFY_FAIL:compile/.test(m)) {
    return pick(t("esp32FlashVerifyCompile"), t("esp32FlashVerifyCompile"));
  }
  if (/FLASH_VERIFY_FAIL:eda6/.test(m)) {
    return pick(t("esp32FlashVerifyEda6"), t("esp32FlashVerifyEda6"));
  }
  if (/FLASH_VERIFY_FAIL:pybot_hw/.test(m)) {
    return pick(t("esp32FlashVerifyHw"), t("esp32FlashVerifyHw"));
  }
  if (/FLASH_VERIFY_FAIL/.test(m)) {
    return pick(t("esp32FlashVerifyFail"), t("esp32FlashVerifyFail"));
  }
  if (/\bREPL_FAIL\b/.test(m)) {
    return pick(
      "No se pudo entrar al REPL de la ESP32. Reconectá la placa y volvé a ejecutar.",
      "Could not enter the ESP32 REPL. Reconnect the board and run again.",
    );
  }
  if (/\bRUN_FAIL\b/.test(m)) {
    return pick(
      "No se pudo ejecutar el programa en la ESP32. Reconectá la placa y probá de nuevo.",
      "Could not run the program on the ESP32. Reconnect the board and try again.",
    );
  }
  if (/\bNO_RESPONSE\b/.test(m)) {
    return pick(
      "La placa ESP32 no respondió a tiempo. Revisá la conexión USB y el firmware PyBot ESP32.",
      "The ESP32 board did not respond in time. Check the USB connection and the PyBot ESP32 firmware.",
    );
  }
  if (/\bBAD_FIRMWARE\b/.test(m)) {
    return pick(
      "El firmware de la placa ESP32 no es el esperado. Cargá firmware/pybot-esp32.",
      "The ESP32 firmware is not the expected one. Flash firmware/pybot-esp32.",
    );
  }
  if (/\bINVALID_PIN\b/.test(m)) {
    return pick(
      "Pin inválido para esta placa: revisá el número de GPIO que estás usando.",
      "Invalid pin for this board: check the GPIO number you are using.",
    );
  }
  if (/\bINVALID_CMD\b|\bCMD_FAILED\b/.test(m)) {
    return pick(
      "La placa no pudo ejecutar el comando: revisá el modo y los argumentos de pin/servo/motor.",
      "The board could not run the command: check the mode and arguments of pin/servo/motor.",
    );
  }
  if (/ValueError|pin_args|invalid_analog|invalid_value/i.test(m)) {
    return pick(
      "Valor o argumentos inválidos: revisá los parámetros de la función (cantidad, orden y rango).",
      "Invalid value or arguments: check function parameters (count, order, and range).",
    );
  }
  if (/ZeroDivisionError|division by zero/i.test(m)) {
    return pick(
      "División por cero: no se puede dividir por 0. Cambiá ese valor antes de calcular.",
      "Division by zero: you cannot divide by 0. Change that value before calculating.",
    );
  }
  if (/IndexError|list index out of range/i.test(m)) {
    return pick(
      "Índice fuera de rango: intentaste acceder a una posición que no existe en la lista.",
      "Index out of range: you tried to access a list position that does not exist.",
    );
  }
  if (/KeyError/i.test(m)) {
    return pick(
      "Clave inexistente: esa clave no está en el diccionario.",
      "Missing key: that key is not in the dictionary.",
    );
  }
  if (/AttributeError/i.test(m)) {
    return pick(
      "Atributo o método no disponible: revisá el nombre y si ese objeto soporta esa operación.",
      "Attribute or method not available: check the name and whether the object supports that operation.",
    );
  }
  if (/ModuleNotFoundError|No module named/i.test(m)) {
    return pick(
      "Módulo no encontrado: intentaste importar algo que no está disponible en este entorno.",
      "Module not found: you tried to import something unavailable in this environment.",
    );
  }
  if (/RecursionError/i.test(m)) {
    return pick(
      "Recursión muy profunda: una función se está llamando demasiadas veces. Revisá la condición de corte.",
      "Recursion too deep: a function is calling itself too many times. Check the stop condition.",
    );
  }
  if (/time_sleep_blocked/i.test(m)) {
    return pick(
      "Para hacer pausas, usá la función wait() en lugar de time.sleep() en esta versión.",
      "To pause the program, use wait() instead of time.sleep() in this version.",
    );
  }
  if (/SystemExit|exit\(/i.test(m)) {
    return pick(
      "Programa terminado por exit() o quit().",
      "Program terminated by exit() or quit().",
    );
  }
  if (/PermissionError|Permission.*denied|access.*blocked|secure context/i.test(m)) {
    return pick(
      "Permiso o acceso bloqueado: revisá permisos y volvé a intentar.",
      "Permission or access blocked: review permissions and try again.",
    );
  }

  return unknown;
}
