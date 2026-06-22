/**
 * PyBlock — Definición de bloques.
 *
 * Módulo NUEVO y AISLADO. No toca nada del resto de PyBot.
 * Los bloques generan Python real de PyBot (ver pyblockGenerator.js).
 *
 * Importar este archivo tiene como efecto:
 *   - registrar los bloques propios de PyBot en Blockly,
 *   - cargar el idioma español para los bloques estándar (variables, lógica,
 *     funciones, etc. que ya vienen con Blockly).
 *
 * Los bloques de hardware usan entradas de valor (input_value) con un número
 * "shadow" por defecto: se ven como antes, pero ahora se les puede enchufar una
 * variable o una operación matemática.
 */

import * as Blockly from "blockly";
import * as EsMsg from "blockly/msg/es";
import { t } from "../i18n.js";

// Idioma español para los bloques estándar de Blockly (si falla, queda en inglés).
try {
  Blockly.setLocale(EsMsg);
} catch {
  /* no romper si la versión de Blockly no expone setLocale */
}

// Forma "hat"/cap para el bloque de inicio (si el renderer no lo soporta, queda
// como bloque superior normal: no rompe nada).
try {
  Blockly.Extensions.register("pyblock_start_hat", function () {
    this.hat = "cap";
  });
} catch {
  /* ya estaba registrada (re-import en dev) o no disponible */
}

const HUE_CONTROL = 210;
const HUE_HARDWARE = 25;
const HUE_OUTPUT = 160;
const HUE_CANVAS = 290;
const HUE_START = 120;

Blockly.defineBlocksWithJsonArray([
  // ----- Inicio (bloque hat genérico) -----
  {
    type: "pyblock_start",
    message0: t("pyblockStart") + " %1",
    args0: [{ type: "input_statement", name: "DO" }],
    colour: HUE_START,
    extensions: ["pyblock_start_hat"],
    tooltip: t("pyblockStartTooltip"),
  },

  // ----- Control -----
  {
    type: "pyblock_forever",
    message0: "por siempre %1 %2",
    args0: [
      { type: "input_dummy" },
      { type: "input_statement", name: "DO" },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CONTROL,
    tooltip: "Repite los bloques de adentro para siempre (while True).",
  },
  {
    type: "pyblock_repeat",
    message0: "repetir %1 veces %2",
    args0: [
      { type: "input_value", name: "TIMES", check: "Number" },
      { type: "input_statement", name: "DO" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CONTROL,
    tooltip: "Repite los bloques de adentro N veces (for i in range(N)).",
  },
  {
    type: "pyblock_wait",
    message0: "esperar %1 segundos",
    args0: [{ type: "input_value", name: "SECS", check: "Number" }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CONTROL,
    tooltip: "Espera la cantidad de segundos indicada (wait).",
  },

  // ----- Hardware -----
  {
    type: "pyblock_pin_write",
    message0: "poner pin digital %1 en %2",
    args0: [
      { type: "input_value", name: "PIN", check: "Number" },
      { type: "input_value", name: "VAL", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_HARDWARE,
    tooltip: 'Escribe 1 o 0 en un pin digital (pin("out", pin, valor)).',
  },
  {
    type: "pyblock_pin_read",
    message0: "leer pin digital %1",
    args0: [{ type: "input_value", name: "PIN", check: "Number" }],
    inputsInline: true,
    output: "Number",
    colour: HUE_HARDWARE,
    tooltip: 'Lee un pin digital (pin("in", pin)).',
  },
  {
    type: "pyblock_analog_read",
    message0: "leer pin analógico A %1",
    args0: [
      {
        type: "field_dropdown",
        name: "CH",
        options: [
          ["0", "0"],
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
          ["5", "5"],
        ],
      },
    ],
    output: "Number",
    colour: HUE_HARDWARE,
    tooltip: 'Lee un pin analógico A0–A5 (pin("in", "A0")).',
  },
  {
    type: "pyblock_servo",
    message0: "servo pin %1 ángulo %2",
    args0: [
      { type: "input_value", name: "PIN", check: "Number" },
      { type: "input_value", name: "ANG", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_HARDWARE,
    tooltip: "Mueve un servo a un ángulo 0–180 (servo).",
  },
  {
    type: "pyblock_motor",
    message0: "motor pin %1 velocidad %2",
    args0: [
      { type: "input_value", name: "PIN", check: "Number" },
      { type: "input_value", name: "SPEED", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_HARDWARE,
    tooltip: "Controla un motor con velocidad -100..100 (motor).",
  },

  // ----- Salida -----
  {
    type: "pyblock_print",
    message0: "imprimir %1",
    args0: [{ type: "input_value", name: "VALUE" }],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_OUTPUT,
    tooltip: "Muestra un texto o valor en la terminal (print).",
  },

  // ----- Canvas / Dibujo -----
  {
    type: "pyblock_canvas_screen",
    message0: "crear pantalla ancho %1 alto %2",
    args0: [
      { type: "input_value", name: "W", check: "Number" },
      { type: "input_value", name: "H", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Crea la pantalla de dibujo (pantalla).",
  },
  {
    type: "pyblock_canvas_fill",
    message0: "fondo color %1",
    args0: [{ type: "input_value", name: "COLOR", check: "String" }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Pinta el fondo de la pantalla (fondo).",
  },
  {
    type: "pyblock_canvas_rect",
    message0: "dibujar rectángulo x %1 y %2 ancho %3 alto %4 color %5",
    args0: [
      { type: "input_value", name: "X", check: "Number" },
      { type: "input_value", name: "Y", check: "Number" },
      { type: "input_value", name: "W", check: "Number" },
      { type: "input_value", name: "H", check: "Number" },
      { type: "input_value", name: "COLOR", check: "String" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Dibuja un rectángulo (dibujar_rect).",
  },
  {
    type: "pyblock_canvas_circle",
    message0: "dibujar círculo x %1 y %2 radio %3 color %4",
    args0: [
      { type: "input_value", name: "X", check: "Number" },
      { type: "input_value", name: "Y", check: "Number" },
      { type: "input_value", name: "R", check: "Number" },
      { type: "input_value", name: "COLOR", check: "String" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Dibuja un círculo (dibujar_circulo).",
  },
  {
    type: "pyblock_canvas_line",
    message0: "dibujar línea x1 %1 y1 %2 x2 %3 y2 %4 color %5 grosor %6",
    args0: [
      { type: "input_value", name: "X1", check: "Number" },
      { type: "input_value", name: "Y1", check: "Number" },
      { type: "input_value", name: "X2", check: "Number" },
      { type: "input_value", name: "Y2", check: "Number" },
      { type: "input_value", name: "COLOR", check: "String" },
      { type: "input_value", name: "WIDTH", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Dibuja una línea (dibujar_linea).",
  },
  {
    type: "pyblock_canvas_text",
    message0: "escribir texto x %1 y %2 mensaje %3 color %4 tamaño %5",
    args0: [
      { type: "input_value", name: "X", check: "Number" },
      { type: "input_value", name: "Y", check: "Number" },
      { type: "input_value", name: "MSG", check: "String" },
      { type: "input_value", name: "COLOR", check: "String" },
      { type: "input_value", name: "SIZE", check: "Number" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Escribe un texto en la pantalla (texto).",
  },
  {
    type: "pyblock_canvas_update",
    message0: "actualizar pantalla",
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Muestra lo dibujado en la pantalla (actualizar).",
  },
  {
    type: "pyblock_canvas_clear",
    message0: "limpiar pantalla",
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CANVAS,
    tooltip: "Borra la pantalla (limpiar).",
  },
  {
    type: "pyblock_canvas_key",
    message0: "tecla presionada %1",
    args0: [{ type: "input_value", name: "KEY", check: "String" }],
    inputsInline: true,
    output: "Boolean",
    colour: HUE_CANVAS,
    tooltip: "Devuelve si una tecla está presionada (tecla).",
  },
]);
