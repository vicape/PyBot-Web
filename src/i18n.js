const STRINGS = {
  es: {
    appTitle: "PyBot Web",
    brandSub: "",
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
    pyblockCatControl: "Control",
    pyblockCatLogic: "Lógica",
    pyblockCatMath: "Matemática",
    pyblockCatVariables: "Variables",
    pyblockCatProcedures: "Procedimientos y funciones",
    pyblockCatHardware: "Hardware",
    pyblockCatCanvas: "Canvas",
    pyblockCatText: "Texto",
    pyblockCatOutput: "Salida",
    pyblockGeneratedLabel: "Python generado",
    pyblockCopyBtn: "Copiar a Python",
    pyblockEmptyCode: "# Arrastrá bloques desde la izquierda para generar Python.",
    repFlow: "Diagrama de flujo",
    repPseudo: "Pseudocódigo",
    repPython: "Python",
    repBlocks: "Bloques",
    repTabsLabel: "Cómo ver el programa",
    viewAsLabel: "Ver como",
    flowZoomLabel: "Zoom del diagrama",
    flowZoomIn: "Acercar",
    flowZoomOut: "Alejar",
    flowZoomReset: "Restablecer zoom",
    flowCopyBtn: "Copiar imagen (para pegar en un documento)",
    flowEditorHint: "Armá el programa con figuras. Tocá + para agregar una figura y escribí adentro.",
    flowInsert: "Agregar figura",
    flowDelete: "Borrar figura",
    flowBranchThen: "Si es verdadero",
    flowBranchElse: "Si no",
    flowBranchBody: "Repetir",
    flowShapeProcess: "Proceso (cálculo)",
    flowShapeOutput: "Mostrar (salida)",
    flowShapeInput: "Pedir dato (entrada)",
    flowShapeDecision: "Decisión (si…)",
    flowShapeWhile: "Bucle mientras",
    flowShapeFor: "Bucle contar",
    flowShapeFunc: "Función",
    pyblockMsgWhile: "mientras %1 hacer %2",
    pyblockTipWhile:
      'Repite los bloques de adentro mientras la condición sea verdadera (while <condición>). Si dejás el bloque "verdadero" enchufado, se repite para siempre.',
    pyblockMsgRepeat: "repetir %1 veces %2",
    pyblockTipRepeat: "Repite los bloques de adentro N veces (for i in range(N)).",
    pyblockMsgWait: "esperar %1 segundos",
    pyblockTipWait: "Espera la cantidad de segundos indicada (wait).",
    pyblockMsgInput: "pedir %1 con mensaje %2",
    pyblockTipInput:
      "Pide un dato al usuario por la consola (input). Si elegís \"número\", ya lo convierte automáticamente (int(input(...))).",
    pyblockInputTypeText: "texto",
    pyblockInputTypeNumber: "número",
    pyblockMsgPinWrite: "poner pin digital %1 en %2",
    pyblockTipPinWrite: 'Escribe 1 o 0 en un pin digital (pin("out", pin, valor)).',
    pyblockMsgPinRead: "leer pin digital %1",
    pyblockTipPinRead: 'Lee un pin digital (pin("in", pin)).',
    pyblockMsgAnalogRead: "leer pin analógico A %1",
    pyblockTipAnalogRead: 'Lee un pin analógico A0–A5 (pin("in", "A0")).',
    pyblockMsgServo: "servo pin %1 ángulo %2",
    pyblockTipServo: "Mueve un servo a un ángulo 0–180 (servo).",
    pyblockMsgMotor: "motor pin %1 velocidad %2",
    pyblockTipMotor: "Controla un motor con velocidad -100..100 (motor).",
    pyblockEda6PortLabel: "puerto",
    pyblockMsgEda6SalidaDigital: "salidaDigital puerto %1 valor %2",
    pyblockTipEda6SalidaDigital:
      "Enciende (1) o apaga (0) una salida digital de la placa EDA6 (salidaDigital(puerto, valor)).",
    pyblockMsgEda6EntradaDigital: "entradaDigital puerto %1",
    pyblockTipEda6EntradaDigital:
      "Lee una entrada digital (0 o 1) de la placa EDA6 (entradaDigital(puerto)).",
    pyblockMsgEda6EntradaAnalogica: "entradaAnalogica puerto %1",
    pyblockTipEda6EntradaAnalogica:
      "Lee una entrada analógica de la placa EDA6 como porcentaje 0–100 (entradaAnalogica(puerto)).",
    pyblockMsgEda6Servomotor: "servomotor puerto %1 ángulo %2",
    pyblockTipEda6Servomotor:
      "Mueve un servomotor a un ángulo 0–180 en la placa EDA6 (servomotor(puerto, ángulo)).",
    pyblockMsgEda6MotorRC: "motorRC puerto %1 velocidad %2",
    pyblockTipEda6MotorRC:
      "Controla un motor RC con velocidad -100..100 en la placa EDA6 (motorRC(puerto, velocidad)).",
    pyblockMsgEda6SensorDistancia: "sensorDistancia puerto %1",
    pyblockTipEda6SensorDistancia:
      "Devuelve la distancia en cm medida por el sensor ultrasónico de la placa EDA6 (sensorDistancia(puerto)).",
    pyblockMsgEda6Detener: "detenerTodo",
    pyblockTipEda6Detener:
      "Detiene motores y apaga todas las salidas de la placa EDA6 (detenerTodo()).",
    pyblockMsgEda6PrintLCD: "printLCD columna %1 fila %2 texto %3",
    pyblockTipEda6PrintLCD:
      "Escribe un texto en la pantalla LCD de la placa EDA6 (printLCD(columna, fila, texto)).",
    pyblockMsgEda6LimpiarLCD: "limpiarLCD",
    pyblockTipEda6LimpiarLCD: "Borra la pantalla LCD de la placa EDA6 (limpiarLCD()).",
    pyblockEda6On: "encendida",
    pyblockEda6Off: "apagada",
    pyblockMsgEda6LuzLCD: "luzLCD %1",
    pyblockTipEda6LuzLCD:
      "Enciende o apaga la luz de fondo de la pantalla LCD de la placa EDA6 (luzLCD(estado)).",
    pyblockMsgPrint: "imprimir %1",
    pyblockTipPrint: "Muestra un texto o valor en la terminal (print).",
    pyblockMsgCanvasScreen: "crear pantalla ancho %1 alto %2",
    pyblockTipCanvasScreen: "Crea la pantalla de dibujo (pantalla).",
    pyblockMsgCanvasFill: "fondo color %1",
    pyblockTipCanvasFill: "Pinta el fondo de la pantalla (fondo).",
    pyblockMsgCanvasRect: "dibujar rectángulo x %1 y %2 ancho %3 alto %4 color %5",
    pyblockTipCanvasRect: "Dibuja un rectángulo (dibujar_rect).",
    pyblockMsgCanvasCircle: "dibujar círculo x %1 y %2 radio %3 color %4",
    pyblockTipCanvasCircle: "Dibuja un círculo (dibujar_circulo).",
    pyblockMsgCanvasLine: "dibujar línea x1 %1 y1 %2 x2 %3 y2 %4 color %5 grosor %6",
    pyblockTipCanvasLine: "Dibuja una línea (dibujar_linea).",
    pyblockMsgCanvasText: "escribir texto x %1 y %2 mensaje %3 color %4 tamaño %5",
    pyblockTipCanvasText: "Escribe un texto en la pantalla (texto).",
    pyblockMsgCanvasUpdate: "actualizar pantalla",
    pyblockTipCanvasUpdate: "Muestra lo dibujado en la pantalla (actualizar).",
    pyblockMsgCanvasClear: "limpiar pantalla",
    pyblockTipCanvasClear: "Borra la pantalla (limpiar).",
    pyblockMsgCanvasKey: "tecla presionada %1",
    pyblockTipCanvasKey: "Devuelve si una tecla está presionada (tecla).",
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
    bleInstallBtn: "Instalar PyBot Bluetooth",
    pybotInstallBtn: "Instalar PyBot",
    pybotUpdateBtn: "Actualizar PyBot",
    bleInstallMenuHint:
      "Prepara la ESP32 para usarse sin cables por Bluetooth desde PyBot. No borra el programa del alumno (pybot_app).",
    bleInstallStart: "Instalando PyBot Bluetooth en la ESP32 (por USB)…",
    bleInstallLibs: "Instalando librerías en la placa (MicroPython + EDA6)…",
    bleInstallProgress: "Instalando runtime BLE… {pct}%",
    bleInstallVerifying: "Verificando el runtime en la placa…",
    bleInstallResetting: "Reiniciando la ESP32…",
    bleInstallOk: "PyBot Bluetooth instalado correctamente. ({size} bytes)",
    bleInstallReady: "El ESP32 ya puede utilizarse mediante Bluetooth.",
    bleInstallUnplug: "Podés desconectar el cable de datos.",
    bleClearAppBtn: "Borrar programa BLE de la placa (USB)",
    bleClearAppHint:
      "Recuperación: borra pybot_app.py/json (programa bajado por Bluetooth) sin quitar el runtime. Usalo si el programa quedó permanente y no responde al Stop.",
    bleClearAppStart: "Borrando el programa persistente por USB…",
    bleClearAppOk:
      "Programa persistente borrado. El runtime Bluetooth sigue. Reconectá por Bluetooth si hace falta.",
    memDiagBtn: "Diagnóstico de memoria (USB)",
    memDiagMenuHint:
      "Revisa por USB si la ESP32 se queda sin memoria al preparar el runtime o activar Bluetooth. Solo lectura: no borra nada ni reinicia.",
    memDiagStart: "Ejecutando diagnóstico de memoria por USB (solo lectura)…",
    memDiagResult:
      "RAM libre: {mem} bytes · main.py: {main} bytes · Compilación del runtime: {compile} · BLE activa: {ble}",
    memDiagNA: "no existe",
    memDiagError: "Error",
    memDiagNotTested: "no probado",
    memDiagConclusionMemory:
      "Confirmado: la placa se queda sin memoria al preparar el runtime (por eso no aparece por Bluetooth).",
    memDiagConclusionOk:
      "La memoria no parece ser el problema; el runtime compila y BLE activa correctamente.",
    memDiagConclusionUnknown:
      "Diagnóstico incompleto: no se pudo determinar si es un problema de memoria. Revisá la conexión USB e intentá de nuevo.",
    bleConnectMenuBtn: "Conectar por Bluetooth (BLE)",
    bleConnectMenuHint:
      "Conectá una ESP32 con PyBot Bluetooth ya instalado, sin cables.",
    blePanelTitle: "Conexión Bluetooth (BLE)",
    blePanelIntro:
      "Conectá tu ESP32 con PyBot Bluetooth instalado. Elegí el dispositivo PYBOT-XXXXXX en el diálogo del navegador.",
    blePanelFoot:
      "El Bluetooth es independiente del USB: no reemplaza la conexión por cable.",
    bleConnect: "Conectar Bluetooth",
    bleConnecting: "Conectando…",
    bleDisconnect: "Desconectar Bluetooth",
    bleConnectedLabel: "Bluetooth conectado",
    bleDeviceInfo: "Datos del dispositivo",
    bleDiagTitle: "Diagnóstico BLE",
    bleLedOn: "LED ON",
    bleLedOff: "LED OFF",
    bleLogEmpty: "Las respuestas del dispositivo aparecerán acá.",
    bleLogConnected: "Conectado a {name}.",
    bleLogDisconnected: "Bluetooth desconectado.",
    bleUnsupported:
      "Este navegador no soporta Web Bluetooth. Usá Chrome o Edge de escritorio.",
    bleCancelled: "Conexión Bluetooth cancelada.",
    bleConnectFail: "No se pudo conectar por Bluetooth. Reintentá.",
    bleNotConnected: "No hay conexión Bluetooth activa.",
    bleTimeout: "sin respuesta (timeout)",
    bleSendFail: "error al enviar",
    bleRunConnected: "Bluetooth conectado a {name}. El programa correrá por BLE.",
    bleRunHint:
      "Ejecutá con el botón Ejecutar: la salida llega por Bluetooth. Detené con Detener.",
    bleRunDisconnected: "Bluetooth de ejecución desconectado.",
    bleRunDisconnectedErr:
      "Se perdió el Bluetooth durante la ejecución. El programa temporal se detuvo.",
    bleFirmwareOutdated:
      "Runtime viejo: esta placa no puede ejecutar programas por Bluetooth. Actualizala con “Instalar PyBot Bluetooth” por USB.",
    bleStopRuntimeOld:
      "Runtime {installed}: el Stop por Bluetooth no es fiable (hace falta {min}+). Actualizá por OTA en el panel Bluetooth o con “Instalar PyBot Bluetooth” por USB.",
    boardProgramStopped: "Programa detenido.",
    stoppingMsg: "Deteniendo…",
    statusStopping: "Deteniendo",
    bleDeployRunNow: "Ejecutando el programa en la placa…",
    bleAppSectionLabel: "App en la placa (Bluetooth)",
    bleDeployBtn: "Bajar a ESP32 (Bluetooth)",
    bleDeployHint:
      "Guarda el programa en la ESP32 por Bluetooth. La placa lo ejecuta sola, sin la computadora.",
    bleDeployStart: "Bajando programa a la ESP32 por Bluetooth…",
    bleDeployProgress: "Transfiriendo… {pct}%",
    bleDeployVerifying: "Verificando en la placa (tamaño + hash)…",
    bleDeployVerified: "Verificación OK: {size} bytes guardados en la ESP32.",
    bleDeployOk:
      "Programa verificado y guardado en ESP32. La placa puede ejecutarlo sin la computadora.",
    bleDeployAutostart: "Autostart activado: al encender, la placa corre el programa sola.",
    bleDeployUnsupported:
      "Esta placa necesita actualizar PyBot Bluetooth para usar Bajar a ESP32. Reinstalá el runtime por USB.",
    bleDeployTooLong: "El programa es demasiado grande para bajarlo por Bluetooth.",
    bleDeployDisconnected:
      "Se perdió el Bluetooth durante la bajada. Se conservó la app anterior intacta.",
    bleDeployFail: "No se pudo bajar el programa por Bluetooth ({code}).",
    bleAppStatusUnknown: "Programa en placa: (consultando…)",
    bleAppStatusInstalled: "Programa en placa: Sí",
    bleAppStatusNotInstalled: "Programa en placa: No",
    bleAppAutostartOn: "Autostart: activado",
    bleAppAutostartOff: "Autostart: desactivado",
    bleAppRunningTag: "en ejecución",
    bleAppSafeTag: "modo seguro",
    bleAppRefresh: "Actualizar estado",
    bleAppRunSaved: "Ejecutar guardado",
    bleAppStopBtn: "Detener",
    bleAppDeleteBtn: "Borrar de la placa",
    bleAppAutostartEnableBtn: "Activar autostart",
    bleAppAutostartDisableBtn: "Desactivar autostart",
    bleAppRunningMsg: "Ejecutando el programa guardado en la ESP32…",
    bleAppStopping: "Deteniendo el programa de la placa…",
    bleAppDeleted: "Programa borrado de la placa. El runtime Bluetooth sigue activo.",
    bleAppAutostartEnabled: "Autostart activado.",
    bleAppAutostartDisabled: "Autostart desactivado.",
    bleUpdateSectionLabel: "Runtime Bluetooth (OTA)",
    bleUpdateInstalled: "Runtime instalado: {version}",
    bleUpdateLatest: "Última versión: {version}",
    bleUpdateChecking: "Comprobando versión del runtime…",
    bleUpdateUpToDate: "El runtime Bluetooth está actualizado.",
    bleUpdateAvailable: "Actualización de PyBot Bluetooth disponible {from}→{to}",
    bleUpdateBtn: "Actualizar PyBot Bluetooth",
    bleUpdating: "Actualizando…",
    bleUpdateNeedsUsb:
      "Esta placa necesita una última actualización por USB para habilitar futuras actualizaciones por Bluetooth.",
    bleUpdateStart: "Actualizando el runtime por Bluetooth… No apagues la placa.",
    bleUpdateTransfer: "Actualizando… {pct}%",
    bleUpdateFinished: "Finalizado",
    bleUpdateVerifying: "Verificando…",
    bleUpdateApplying: "Aplicando…",
    bleUpdateRestarting: "Reiniciando…",
    bleUpdateReconnecting: "Reconectando…",
    bleUpdateOk: "PyBot Bluetooth actualizado correctamente.",
    bleUpdateAppliedNoReconnect:
      "La actualización fue instalada. La placa se reinició. Volvé a conectar por Bluetooth para verificar la nueva versión.",
    bleUpdateMismatch:
      "La actualización se aplicó, pero la versión reportada no coincide. Reintentá o reinstalá por USB.",
    bleUpdateUnsupported:
      "Esta placa no soporta la actualización por Bluetooth. Actualizala por USB (Instalar PyBot Bluetooth).",
    bleUpdateFail: "No se pudo actualizar el runtime por Bluetooth ({code}).",
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
      "Esta ESP32 no tiene MicroPython. Usá «Preparar ESP32» para instalarlo desde el navegador (sin Thonny ni Arduino IDE).",
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
    prepareEsp32Btn: "Preparar ESP32",
    prepareEsp32MenuHint:
      "Instala MicroPython oficial y PyBot en una ESP32 virgen, desde Chrome o Edge por USB. No copia el programa del editor.",
    prepareEsp32Title: "Preparar ESP32",
    prepareEsp32Intro:
      "Vamos a dejar la placa lista para PyBot: MicroPython oficial + runtime (Bluetooth nativo, EDA6 y red). Elegí el puerto USB cuando el navegador lo pida.",
    prepareEsp32BoardState: "Estado de la placa",
    prepareEsp32ConfirmFlash:
      "Esto BORRA toda la memoria flash de la ESP32 e instala MicroPython + PyBot. No se puede deshacer. El programa que estás editando NO se copia a la placa.",
    prepareEsp32ConfirmInstall:
      "Esta ESP32 ya tiene MicroPython, pero no PyBot. Vamos a instalar el runtime (BLE nativo, EDA6, red) sin volver a grabar el firmware. No se copia el programa del editor.",
    prepareEsp32ConfirmUpdate:
      "Esta ESP32 tiene una versión anterior de PyBot. Vamos a actualizar el runtime por USB, sin reflash de MicroPython. No se copia el programa del editor.",
    prepareEsp32ConfirmReinstall:
      "La placa ya está preparada. Reinstalar borra el flash y vuelve a grabar MicroPython + PyBot. Se pierde lo que haya en la placa (incluido pybot_app). El editor no se copia.",
    prepareEsp32ConfirmYes: "Continuar",
    prepareEsp32ConfirmNo: "Cancelar",
    prepareEsp32Cancel: "Cerrar",
    prepareEsp32Retry: "Reintentar",
    prepareEsp32Reinstall: "Reinstalar",
    prepareEsp32Ready: "ESP32 lista. Ya podés usarla por USB o instalar/conectar Bluetooth.",
    prepareEsp32Already:
      "Esta ESP32 ya está preparada para PyBot. No hace falta borrar el flash. Cerrá o, si hace falta, reinstalar con confirmación.",
    prepareEsp32BootHelp: "No entramos al bootloader automáticamente",
    prepareEsp32BootHelp1:
      "Mantené el botón BOOT (IO0) de la ESP32, pulsá RESET, soltá RESET y después soltá BOOT.",
    prepareEsp32BootHelp2: "Dejá el cable USB conectado y pulsá Reintentar.",
    prepareEsp32Unsupported:
      "Esta placa es {chip}. PyBot todavía no puede grabar MicroPython en esa familia (solo ESP32 clásico / WROOM). No se flasheó ninguna imagen incorrecta.",
    prepareEsp32ShowLog: "Ver log técnico",
    prepareEsp32HideLog: "Ocultar log técnico",
    prepareEsp32Progress: "{pct}%",
    prepareEsp32Critical: "No cierres esta ventana ni desconectes el USB mientras se graba la flash.",
    prepareEsp32Foot: "Hace falta Chrome o Edge, HTTPS o localhost, y un cable USB de datos.",
    prepareState_VIRGIN: "Virgen (sin MicroPython)",
    prepareState_MPY_ONLY: "MicroPython sin PyBot",
    prepareState_OLD_PYBOT: "PyBot desactualizado",
    prepareState_READY: "PyBot al día",
    preparePhase_IDLE: "Listo para empezar.",
    preparePhase_SELECTING_PORT: "Elegí el puerto USB de la ESP32 en el diálogo del navegador…",
    preparePhase_PROBING: "Reconociendo qué hay en la placa…",
    preparePhase_ALREADY_PREPARED: "La placa ya está preparada.",
    preparePhase_CONFIRM_FLASH: "Confirmá el borrado e instalación de MicroPython.",
    preparePhase_CONFIRM_INSTALL: "Confirmá la instalación de PyBot (sin reflash).",
    preparePhase_CONFIRM_UPDATE: "Confirmá la actualización de PyBot (sin reflash).",
    preparePhase_CONFIRM_REINSTALL: "Confirmá la reinstalación completa.",
    preparePhase_CONNECTING_BOOTLOADER: "Entrando al bootloader (DTR/RTS)…",
    preparePhase_NEED_BOOT_BUTTON: "Hace falta el botón BOOT.",
    preparePhase_IDENTIFYING_CHIP: "Identificando el chip…",
    preparePhase_UNSUPPORTED_VARIANT: "Esta variante de chip todavía no está soportada.",
    preparePhase_LOADING_FIRMWARE: "Cargando el firmware oficial de MicroPython…",
    preparePhase_VERIFYING_IMAGE_HASH: "Verificando SHA-256 de la imagen…",
    preparePhase_ERASING: "Borrando la flash…",
    preparePhase_FLASHING: "Grabando MicroPython…",
    preparePhase_VERIFYING_FLASH: "Comprobando lo grabado en flash…",
    preparePhase_RESETTING: "Reiniciando la placa…",
    preparePhase_WAITING_REPL: "Esperando el REPL de MicroPython…",
    preparePhase_INSTALLING_PYBOT: "Instalando PyBot en la placa…",
    preparePhase_VERIFYING_FILES: "Verificando los archivos de PyBot…",
    preparePhase_RESETTING_PYBOT: "Reiniciando tras instalar PyBot…",
    preparePhase_READY: "ESP32 lista.",
    preparePhase_ERROR: "Algo falló. Podés reintentar.",
    preparePhase_CANCELLED: "Cancelado.",
    mpyStateMpyOnly:
      "La ESP32 tiene MicroPython, pero todavía no PyBot. Usá «Instalar PyBot Bluetooth» (sin reflash) o «Preparar ESP32».",
    mpyStateOldPybot:
      "La ESP32 tiene una versión anterior de PyBot. Usá «Actualizar PyBot» / «Instalar PyBot Bluetooth» para actualizar, sin reflash.",
    mpyStateReady: "ESP32 con PyBot al día. Ya podés trabajar por USB o Bluetooth.",
    provErr_PORT_CANCELLED: "No se eligió ningún puerto USB.",
    provErr_PORT_PERMISSION: "El navegador no permitió acceder al USB.",
    provErr_BUSY: "El puerto USB está ocupado. Cerrá Thonny, Arduino IDE u otra app y reintentá.",
    provErr_BOOTLOADER_FAIL:
      "No se pudo entrar al bootloader. Probá el botón BOOT o revisá el cable USB de datos.",
    provErr_VARIANT_UNSUPPORTED: "Esta familia de ESP32 todavía no está soportada.",
    provErr_FIRMWARE_FETCH_FAIL: "No se pudo cargar el firmware de MicroPython desde la app.",
    provErr_FIRMWARE_HASH_MISMATCH:
      "El firmware descargado no coincide con el SHA-256 esperado. No se flasheó nada.",
    provErr_ERASE_FAIL: "Falló el borrado de la flash. Reintentá; si sigue, usá el botón BOOT.",
    provErr_FLASH_FAIL: "Falló la grabación de MicroPython. Reintentá; la placa no quedó lista.",
    provErr_FLASH_VERIFY_FAIL: "La verificación de la flash falló. Reintentá; no está lista.",
    provErr_RESET_FAIL: "No se pudo reiniciar la placa después de grabar.",
    provErr_REPL_TIMEOUT:
      "MicroPython no respondió en el REPL. Reconectá el USB y reintentá. No se declara lista.",
    provErr_INSTALL_FAIL: "No se pudieron instalar los archivos de PyBot. Reintentá.",
    provErr_VERIFY_FILES_FAIL: "Faltan archivos de PyBot en la placa. Reintentá la instalación.",
    provErr_CANCELLED: "Preparación cancelada.",
    provErr_UNKNOWN: "No se pudo preparar la ESP32. Revisá el cable y reintentá.",
  },
  en: {
    appTitle: "PyBot Web",
    brandSub: "",
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
    pyblockCatControl: "Control",
    pyblockCatLogic: "Logic",
    pyblockCatMath: "Math",
    pyblockCatVariables: "Variables",
    pyblockCatProcedures: "Functions",
    pyblockCatHardware: "Hardware",
    pyblockCatCanvas: "Canvas",
    pyblockCatText: "Text",
    pyblockCatOutput: "Output",
    pyblockGeneratedLabel: "Generated Python",
    pyblockCopyBtn: "Copy to Python",
    pyblockEmptyCode: "# Drag blocks from the left to generate Python.",
    repFlow: "Flowchart",
    repPseudo: "Pseudocode",
    repPython: "Python",
    repBlocks: "Blocks",
    repTabsLabel: "How to view the program",
    viewAsLabel: "View as",
    flowZoomLabel: "Diagram zoom",
    flowZoomIn: "Zoom in",
    flowZoomOut: "Zoom out",
    flowZoomReset: "Reset zoom",
    flowCopyBtn: "Copy image (to paste in a document)",
    flowEditorHint: "Build your program with shapes. Tap + to add a shape and type inside it.",
    flowInsert: "Add shape",
    flowDelete: "Delete shape",
    flowBranchThen: "If true",
    flowBranchElse: "Otherwise",
    flowBranchBody: "Repeat",
    flowShapeProcess: "Process (calculation)",
    flowShapeOutput: "Show (output)",
    flowShapeInput: "Ask (input)",
    flowShapeDecision: "Decision (if…)",
    flowShapeWhile: "While loop",
    flowShapeFor: "Count loop",
    flowShapeFunc: "Function",
    pyblockMsgWhile: "while %1 do %2",
    pyblockTipWhile:
      'Repeats the blocks inside while the condition is true (while <condition>). Leave the "true" block plugged in to repeat forever.',
    pyblockMsgRepeat: "repeat %1 times %2",
    pyblockTipRepeat: "Repeats the blocks inside N times (for i in range(N)).",
    pyblockMsgWait: "wait %1 seconds",
    pyblockTipWait: "Waits the given number of seconds (wait).",
    pyblockMsgInput: "input %1 with message %2",
    pyblockTipInput:
      'Asks the user for a value through the console (input). If you pick "number", it converts it automatically (int(input(...))).',
    pyblockInputTypeText: "text",
    pyblockInputTypeNumber: "number",
    pyblockMsgPinWrite: "set digital pin %1 to %2",
    pyblockTipPinWrite: 'Writes 1 or 0 to a digital pin (pin("out", pin, value)).',
    pyblockMsgPinRead: "read digital pin %1",
    pyblockTipPinRead: 'Reads a digital pin (pin("in", pin)).',
    pyblockMsgAnalogRead: "read analog pin A %1",
    pyblockTipAnalogRead: 'Reads an analog pin A0-A5 (pin("in", "A0")).',
    pyblockMsgServo: "servo pin %1 angle %2",
    pyblockTipServo: "Moves a servo to an angle 0-180 (servo).",
    pyblockMsgMotor: "motor pin %1 speed %2",
    pyblockTipMotor: "Controls a motor with speed -100..100 (motor).",
    pyblockEda6PortLabel: "port",
    pyblockMsgEda6SalidaDigital: "salidaDigital port %1 value %2",
    pyblockTipEda6SalidaDigital:
      "Turns an EDA6 digital output on (1) or off (0) (salidaDigital(port, value)).",
    pyblockMsgEda6EntradaDigital: "entradaDigital port %1",
    pyblockTipEda6EntradaDigital:
      "Reads an EDA6 digital input (0 or 1) (entradaDigital(port)).",
    pyblockMsgEda6EntradaAnalogica: "entradaAnalogica port %1",
    pyblockTipEda6EntradaAnalogica:
      "Reads an EDA6 analog input as a 0–100 percentage (entradaAnalogica(port)).",
    pyblockMsgEda6Servomotor: "servomotor port %1 angle %2",
    pyblockTipEda6Servomotor:
      "Moves an EDA6 servo to an angle 0–180 (servomotor(port, angle)).",
    pyblockMsgEda6MotorRC: "motorRC port %1 speed %2",
    pyblockTipEda6MotorRC:
      "Controls an EDA6 RC motor with speed -100..100 (motorRC(port, speed)).",
    pyblockMsgEda6SensorDistancia: "sensorDistancia port %1",
    pyblockTipEda6SensorDistancia:
      "Returns the distance in cm from the EDA6 ultrasonic sensor (sensorDistancia(port)).",
    pyblockMsgEda6Detener: "detenerTodo",
    pyblockTipEda6Detener:
      "Stops motors and turns off every EDA6 output (detenerTodo()).",
    pyblockMsgEda6PrintLCD: "printLCD column %1 row %2 text %3",
    pyblockTipEda6PrintLCD:
      "Writes text on the EDA6 LCD screen (printLCD(column, row, text)).",
    pyblockMsgEda6LimpiarLCD: "limpiarLCD",
    pyblockTipEda6LimpiarLCD: "Clears the EDA6 LCD screen (limpiarLCD()).",
    pyblockEda6On: "on",
    pyblockEda6Off: "off",
    pyblockMsgEda6LuzLCD: "luzLCD %1",
    pyblockTipEda6LuzLCD:
      "Turns the EDA6 LCD backlight on or off (luzLCD(state)).",
    pyblockMsgPrint: "print %1",
    pyblockTipPrint: "Shows a text or value in the terminal (print).",
    pyblockMsgCanvasScreen: "create screen width %1 height %2",
    pyblockTipCanvasScreen: "Creates the drawing screen (screen).",
    pyblockMsgCanvasFill: "background color %1",
    pyblockTipCanvasFill: "Fills the screen background (fill).",
    pyblockMsgCanvasRect: "draw rectangle x %1 y %2 width %3 height %4 color %5",
    pyblockTipCanvasRect: "Draws a rectangle (draw_rect).",
    pyblockMsgCanvasCircle: "draw circle x %1 y %2 radius %3 color %4",
    pyblockTipCanvasCircle: "Draws a circle (draw_circle).",
    pyblockMsgCanvasLine: "draw line x1 %1 y1 %2 x2 %3 y2 %4 color %5 width %6",
    pyblockTipCanvasLine: "Draws a line (draw_line).",
    pyblockMsgCanvasText: "write text x %1 y %2 message %3 color %4 size %5",
    pyblockTipCanvasText: "Writes text on the screen (text).",
    pyblockMsgCanvasUpdate: "update screen",
    pyblockTipCanvasUpdate: "Shows what was drawn on screen (update).",
    pyblockMsgCanvasClear: "clear screen",
    pyblockTipCanvasClear: "Clears the screen (clear).",
    pyblockMsgCanvasKey: "key pressed %1",
    pyblockTipCanvasKey: "Returns whether a key is pressed (key).",
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
    bleInstallBtn: "Install PyBot Bluetooth",
    pybotInstallBtn: "Install PyBot",
    pybotUpdateBtn: "Update PyBot",
    bleInstallMenuHint:
      "Prepares the ESP32 to be used wirelessly over Bluetooth from PyBot. Does not delete the student app (pybot_app).",
    bleInstallStart: "Installing PyBot Bluetooth on the ESP32 (over USB)…",
    bleInstallLibs: "Installing libraries on the board (MicroPython + EDA6)…",
    bleInstallProgress: "Installing BLE runtime… {pct}%",
    bleInstallVerifying: "Verifying the runtime on the board…",
    bleInstallResetting: "Restarting the ESP32…",
    bleInstallOk: "PyBot Bluetooth installed successfully. ({size} bytes)",
    bleInstallReady: "The ESP32 can now be used over Bluetooth.",
    bleInstallUnplug: "You can unplug the data cable.",
    bleClearAppBtn: "Clear BLE program from board (USB)",
    bleClearAppHint:
      "Recovery: deletes pybot_app.py/json (Bluetooth-deployed program) without removing the runtime. Use if the program is stuck and Stop does nothing.",
    bleClearAppStart: "Clearing the persistent program over USB…",
    bleClearAppOk:
      "Persistent program cleared. Bluetooth runtime remains. Reconnect over Bluetooth if needed.",
    memDiagBtn: "Memory diagnostic (USB)",
    memDiagMenuHint:
      "Checks over USB whether the ESP32 runs out of memory while preparing the runtime or activating Bluetooth. Read-only: it does not delete anything or restart.",
    memDiagStart: "Running memory diagnostic over USB (read-only)…",
    memDiagResult:
      "Free RAM: {mem} bytes · main.py: {main} bytes · Runtime compilation: {compile} · BLE activation: {ble}",
    memDiagNA: "not found",
    memDiagError: "Error",
    memDiagNotTested: "not tested",
    memDiagConclusionMemory:
      "Confirmed: the board runs out of memory while preparing the runtime (that is why it does not show up over Bluetooth).",
    memDiagConclusionOk:
      "Memory does not seem to be the problem; the runtime compiles and BLE activates correctly.",
    memDiagConclusionUnknown:
      "Incomplete diagnostic: could not determine whether it is a memory problem. Check the USB connection and try again.",
    bleConnectMenuBtn: "Connect over Bluetooth (BLE)",
    bleConnectMenuHint:
      "Connect an ESP32 that already has PyBot Bluetooth installed, wirelessly.",
    blePanelTitle: "Bluetooth connection (BLE)",
    blePanelIntro:
      "Connect your ESP32 with PyBot Bluetooth installed. Pick the PYBOT-XXXXXX device in the browser dialog.",
    blePanelFoot:
      "Bluetooth is independent from USB: it does not replace the cable connection.",
    bleConnect: "Connect Bluetooth",
    bleConnecting: "Connecting…",
    bleDisconnect: "Disconnect Bluetooth",
    bleConnectedLabel: "Bluetooth connected",
    bleDeviceInfo: "Device info",
    bleDiagTitle: "BLE diagnostics",
    bleLedOn: "LED ON",
    bleLedOff: "LED OFF",
    bleLogEmpty: "Device responses will appear here.",
    bleLogConnected: "Connected to {name}.",
    bleLogDisconnected: "Bluetooth disconnected.",
    bleUnsupported:
      "This browser does not support Web Bluetooth. Use desktop Chrome or Edge.",
    bleCancelled: "Bluetooth connection cancelled.",
    bleConnectFail: "Could not connect over Bluetooth. Please retry.",
    bleNotConnected: "No active Bluetooth connection.",
    bleTimeout: "no response (timeout)",
    bleSendFail: "send error",
    bleRunConnected: "Bluetooth connected to {name}. The program will run over BLE.",
    bleRunHint:
      "Run with the Run button: output arrives over Bluetooth. Stop with Stop.",
    bleRunDisconnected: "Execution Bluetooth disconnected.",
    bleRunDisconnectedErr:
      "Bluetooth was lost while running. The temporary program was stopped.",
    bleFirmwareOutdated:
      "Old runtime: this board cannot run programs over Bluetooth. Update it with “Install PyBot Bluetooth” over USB.",
    bleStopRuntimeOld:
      "Runtime {installed}: Bluetooth Stop is unreliable (need {min}+). Update via OTA in the Bluetooth panel or “Install PyBot Bluetooth” over USB.",
    boardProgramStopped: "Program stopped.",
    stoppingMsg: "Stopping…",
    statusStopping: "Stopping",
    bleDeployRunNow: "Running the program on the board…",
    bleAppSectionLabel: "App on board (Bluetooth)",
    bleDeployBtn: "Download to ESP32 (Bluetooth)",
    bleDeployHint:
      "Saves the program to the ESP32 over Bluetooth. The board runs it on its own, without the computer.",
    bleDeployStart: "Downloading program to the ESP32 over Bluetooth…",
    bleDeployProgress: "Transferring… {pct}%",
    bleDeployVerifying: "Verifying on the board (size + hash)…",
    bleDeployVerified: "Verification OK: {size} bytes saved to the ESP32.",
    bleDeployOk:
      "Program verified and saved to ESP32. The board can run it without the computer.",
    bleDeployAutostart: "Autostart enabled: on power-up the board runs the program by itself.",
    bleDeployUnsupported:
      "This board needs a PyBot Bluetooth update to use Download to ESP32. Reinstall the runtime over USB.",
    bleDeployTooLong: "The program is too large to download over Bluetooth.",
    bleDeployDisconnected:
      "Bluetooth was lost during the download. The previous app was kept intact.",
    bleDeployFail: "Could not download the program over Bluetooth ({code}).",
    bleAppStatusUnknown: "Program on board: (checking…)",
    bleAppStatusInstalled: "Program on board: Yes",
    bleAppStatusNotInstalled: "Program on board: No",
    bleAppAutostartOn: "Autostart: on",
    bleAppAutostartOff: "Autostart: off",
    bleAppRunningTag: "running",
    bleAppSafeTag: "safe mode",
    bleAppRefresh: "Refresh status",
    bleAppRunSaved: "Run saved program",
    bleAppStopBtn: "Stop",
    bleAppDeleteBtn: "Delete from board",
    bleAppAutostartEnableBtn: "Enable autostart",
    bleAppAutostartDisableBtn: "Disable autostart",
    bleAppRunningMsg: "Running the program saved on the ESP32…",
    bleAppStopping: "Stopping the program on the board…",
    bleAppDeleted: "Program deleted from the board. The Bluetooth runtime is still active.",
    bleAppAutostartEnabled: "Autostart enabled.",
    bleAppAutostartDisabled: "Autostart disabled.",
    bleUpdateSectionLabel: "Bluetooth runtime (OTA)",
    bleUpdateInstalled: "Installed runtime: {version}",
    bleUpdateLatest: "Latest version: {version}",
    bleUpdateChecking: "Checking runtime version…",
    bleUpdateUpToDate: "The Bluetooth runtime is up to date.",
    bleUpdateAvailable: "PyBot Bluetooth update available {from}→{to}",
    bleUpdateBtn: "Update PyBot Bluetooth",
    bleUpdating: "Updating…",
    bleUpdateNeedsUsb:
      "This board needs one last update over USB to enable future Bluetooth updates.",
    bleUpdateStart: "Updating the runtime over Bluetooth… Do not power off the board.",
    bleUpdateTransfer: "Updating… {pct}%",
    bleUpdateFinished: "Completed",
    bleUpdateVerifying: "Verifying…",
    bleUpdateApplying: "Applying…",
    bleUpdateRestarting: "Restarting…",
    bleUpdateReconnecting: "Reconnecting…",
    bleUpdateOk: "PyBot Bluetooth updated successfully.",
    bleUpdateAppliedNoReconnect:
      "The update was installed. The board restarted. Reconnect over Bluetooth to verify the new version.",
    bleUpdateMismatch:
      "The update was applied, but the reported version does not match. Retry or reinstall over USB.",
    bleUpdateUnsupported:
      "This board does not support Bluetooth updates. Update it over USB (Install PyBot Bluetooth).",
    bleUpdateFail: "Could not update the runtime over Bluetooth ({code}).",
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
      "This ESP32 does not have MicroPython. Use “Prepare ESP32” to install it from the browser (no Thonny or Arduino IDE).",
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
    prepareEsp32Btn: "Prepare ESP32",
    prepareEsp32MenuHint:
      "Installs official MicroPython and PyBot on a blank ESP32 from Chrome or Edge over USB. Does not copy the editor program.",
    prepareEsp32Title: "Prepare ESP32",
    prepareEsp32Intro:
      "We’ll get the board ready for PyBot: official MicroPython plus the runtime (native Bluetooth, EDA6, and networking). Pick the USB port when the browser asks.",
    prepareEsp32BoardState: "Board status",
    prepareEsp32ConfirmFlash:
      "This ERASES the entire ESP32 flash and installs MicroPython + PyBot. It cannot be undone. The program you are editing is NOT copied to the board.",
    prepareEsp32ConfirmInstall:
      "This ESP32 already has MicroPython but not PyBot. We’ll install the runtime (native BLE, EDA6, networking) without reflashing firmware. The editor program is not copied.",
    prepareEsp32ConfirmUpdate:
      "This ESP32 has an older PyBot. We’ll update the runtime over USB without reflashing MicroPython. The editor program is not copied.",
    prepareEsp32ConfirmReinstall:
      "This board is already prepared. Reinstalling erases flash and writes MicroPython + PyBot again. Anything on the board (including pybot_app) is lost. The editor is not copied.",
    prepareEsp32ConfirmYes: "Continue",
    prepareEsp32ConfirmNo: "Cancel",
    prepareEsp32Cancel: "Close",
    prepareEsp32Retry: "Retry",
    prepareEsp32Reinstall: "Reinstall",
    prepareEsp32Ready: "ESP32 ready. You can use it over USB or connect Bluetooth.",
    prepareEsp32Already:
      "This ESP32 is already prepared for PyBot. There is no need to erase flash. Close, or reinstall with confirmation if you really need to.",
    prepareEsp32BootHelp: "Automatic bootloader entry failed",
    prepareEsp32BootHelp1:
      "Hold the ESP32 BOOT (IO0) button, press RESET, release RESET, then release BOOT.",
    prepareEsp32BootHelp2: "Leave the USB cable connected and click Retry.",
    prepareEsp32Unsupported:
      "This board is {chip}. PyBot cannot flash MicroPython on that family yet (classic ESP32 / WROOM only). No incorrect image was written.",
    prepareEsp32ShowLog: "Show technical log",
    prepareEsp32HideLog: "Hide technical log",
    prepareEsp32Progress: "{pct}%",
    prepareEsp32Critical: "Do not close this window or unplug USB while flash is being written.",
    prepareEsp32Foot: "You need Chrome or Edge, HTTPS or localhost, and a USB data cable.",
    prepareState_VIRGIN: "Blank (no MicroPython)",
    prepareState_MPY_ONLY: "MicroPython without PyBot",
    prepareState_OLD_PYBOT: "Outdated PyBot",
    prepareState_READY: "PyBot up to date",
    preparePhase_IDLE: "Ready to start.",
    preparePhase_SELECTING_PORT: "Pick the ESP32 USB port in the browser dialog…",
    preparePhase_PROBING: "Checking what is on the board…",
    preparePhase_ALREADY_PREPARED: "The board is already prepared.",
    preparePhase_CONFIRM_FLASH: "Confirm erasing flash and installing MicroPython.",
    preparePhase_CONFIRM_INSTALL: "Confirm installing PyBot (no reflash).",
    preparePhase_CONFIRM_UPDATE: "Confirm updating PyBot (no reflash).",
    preparePhase_CONFIRM_REINSTALL: "Confirm a full reinstall.",
    preparePhase_CONNECTING_BOOTLOADER: "Entering the bootloader (DTR/RTS)…",
    preparePhase_NEED_BOOT_BUTTON: "The BOOT button is needed.",
    preparePhase_IDENTIFYING_CHIP: "Identifying the chip…",
    preparePhase_UNSUPPORTED_VARIANT: "This chip variant is not supported yet.",
    preparePhase_LOADING_FIRMWARE: "Loading official MicroPython firmware…",
    preparePhase_VERIFYING_IMAGE_HASH: "Verifying the image SHA-256…",
    preparePhase_ERASING: "Erasing flash…",
    preparePhase_FLASHING: "Writing MicroPython…",
    preparePhase_VERIFYING_FLASH: "Checking the data written to flash…",
    preparePhase_RESETTING: "Resetting the board…",
    preparePhase_WAITING_REPL: "Waiting for the MicroPython REPL…",
    preparePhase_INSTALLING_PYBOT: "Installing PyBot on the board…",
    preparePhase_VERIFYING_FILES: "Verifying PyBot files…",
    preparePhase_RESETTING_PYBOT: "Resetting after installing PyBot…",
    preparePhase_READY: "ESP32 ready.",
    preparePhase_ERROR: "Something went wrong. You can retry.",
    preparePhase_CANCELLED: "Cancelled.",
    mpyStateMpyOnly:
      "The ESP32 has MicroPython but not PyBot yet. Use “Install PyBot Bluetooth” (no reflash) or “Prepare ESP32”.",
    mpyStateOldPybot:
      "The ESP32 has an older PyBot. Use “Update PyBot” / “Install PyBot Bluetooth” to update it, without reflashing.",
    mpyStateReady: "ESP32 with up-to-date PyBot. You can work over USB or Bluetooth.",
    provErr_PORT_CANCELLED: "No USB port was selected.",
    provErr_PORT_PERMISSION: "The browser did not allow USB access.",
    provErr_BUSY: "The USB port is busy. Close Thonny, Arduino IDE, or another app and retry.",
    provErr_BOOTLOADER_FAIL:
      "Could not enter the bootloader. Try the BOOT button or check the USB data cable.",
    provErr_VARIANT_UNSUPPORTED: "This ESP32 family is not supported yet.",
    provErr_FIRMWARE_FETCH_FAIL: "Could not load the MicroPython firmware from the app.",
    provErr_FIRMWARE_HASH_MISMATCH:
      "The downloaded firmware does not match the expected SHA-256. Nothing was flashed.",
    provErr_ERASE_FAIL: "Flash erase failed. Retry; if it keeps failing, use the BOOT button.",
    provErr_FLASH_FAIL: "Writing MicroPython failed. Retry; the board is not ready.",
    provErr_FLASH_VERIFY_FAIL: "Flash verification failed. Retry; the board is not ready.",
    provErr_RESET_FAIL: "Could not reset the board after flashing.",
    provErr_REPL_TIMEOUT:
      "MicroPython did not answer on the REPL. Replug USB and retry. The board is not marked ready.",
    provErr_INSTALL_FAIL: "Could not install PyBot files. Retry.",
    provErr_VERIFY_FILES_FAIL: "PyBot files are missing on the board. Retry the install.",
    provErr_CANCELLED: "Preparation cancelled.",
    provErr_UNKNOWN: "Could not prepare the ESP32. Check the cable and retry.",
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

  if (/BLE_PROGRAM_TOO_LONG/i.test(m)) {
    return pick(
      "El programa es demasiado grande para enviarlo por Bluetooth. Reducilo o grabalo en la placa por USB.",
      "The program is too large to send over Bluetooth. Shorten it or flash it to the board over USB.",
    );
  }
  if (/BLE_RUNTIME_OUTDATED/i.test(m)) {
    return pick(
      "La placa tiene una versión vieja del PyBot BLE Runtime que no puede ejecutar programas por Bluetooth. Conectala por USB y usá “Instalar PyBot Bluetooth” para actualizarla, después reconectá por Bluetooth.",
      "The board has an old version of the PyBot BLE Runtime that cannot run programs over Bluetooth. Connect it over USB and use “Install PyBot Bluetooth” to update it, then reconnect over Bluetooth.",
    );
  }
  if (/BLE_RUN_ERROR:BUSY/i.test(m)) {
    return pick(
      "La placa sigue ocupada con el programa anterior. Esperá un momento o pulsá Stop y volvé a intentar.",
      "The board is still busy with the previous program. Wait a moment or press Stop and try again.",
    );
  }
  if (/BLE_RUN_NO_READY/i.test(m)) {
    return pick(
      "La placa no confirmó el inicio por Bluetooth (sin RUN:READY). Si el runtime es anterior a 3.2.5, actualizalo por OTA o “Instalar PyBot Bluetooth” por USB; si no, reconectá y probá de nuevo.",
      "The board did not confirm start over Bluetooth (no RUN:READY). If the runtime is older than 3.2.5, update via OTA or “Install PyBot Bluetooth” over USB; otherwise reconnect and try again.",
    );
  }
  if (/BLE_RUN_INTERNAL/i.test(m)) {
    return pick(
      "La placa falló al preparar la ejecución por Bluetooth. Reinstalá “Instalar PyBot Bluetooth” por USB (runtime 3.2.5+) y volvé a conectar.",
      "The board failed while preparing Bluetooth execution. Reinstall “Install PyBot Bluetooth” over USB (runtime 3.2.5+) and reconnect.",
    );
  }
  if (/BLE_CLEAR_APP_FAILED/i.test(m)) {
    return pick(
      "No se pudo borrar pybot_app.py por USB. Reintentá «Recuperar REPL» y «Borrar programa BLE de la placa».",
      "Could not delete pybot_app.py over USB. Try «Recover REPL» and «Clear BLE program from board» again.",
    );
  }
  if (/BLE_RUN_ERROR:LOAD/i.test(m)) {
    return pick(
      "La placa no pudo cargar el módulo de ejecución. Reinstalá “Instalar PyBot Bluetooth” por USB.",
      "The board could not load the run module. Reinstall “Install PyBot Bluetooth” over USB.",
    );
  }
  if (/BLE_RUN_DISCONNECTED|BLE_NOT_CONNECTED/i.test(m)) {
    return pick(
      "Se perdió la conexión Bluetooth. Reconectá la placa.",
      "The Bluetooth connection was lost. Reconnect the board.",
    );
  }
  if (/BLE_RUN_BUSY/i.test(m)) {
    return pick(
      "Ya hay un programa ejecutándose por Bluetooth. Detenelo antes de correr otro.",
      "A program is already running over Bluetooth. Stop it before running another.",
    );
  }

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
