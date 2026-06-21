/**
 * PyBlock — Definición de bloques (MVP).
 *
 * Módulo NUEVO y AISLADO. No toca nada del resto de PyBot.
 * Los bloques generan Python real de PyBot (ver pyblockGenerator.js).
 *
 * Importar este archivo tiene como efecto registrar los bloques en Blockly.
 */

import * as Blockly from "blockly";

const HUE_CONTROL = 210;
const HUE_HARDWARE = 25;
const HUE_OUTPUT = 160;

Blockly.defineBlocksWithJsonArray([
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
      { type: "field_number", name: "TIMES", value: 10, min: 0, precision: 1 },
      { type: "input_statement", name: "DO" },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_CONTROL,
    tooltip: "Repite los bloques de adentro N veces (for i in range(N)).",
  },
  {
    type: "pyblock_wait",
    message0: "esperar %1 segundos",
    args0: [{ type: "field_number", name: "SECS", value: 0.5, min: 0 }],
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
      { type: "field_number", name: "PIN", value: 13, min: 0, precision: 1 },
      {
        type: "field_dropdown",
        name: "VAL",
        options: [
          ["1", "1"],
          ["0", "0"],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_HARDWARE,
    tooltip: 'Escribe 1 o 0 en un pin digital (pin("out", pin, valor)).',
  },
  {
    type: "pyblock_pin_read",
    message0: "leer pin digital %1",
    args0: [{ type: "field_number", name: "PIN", value: 2, min: 0, precision: 1 }],
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
      { type: "field_number", name: "PIN", value: 9, min: 0, precision: 1 },
      { type: "field_number", name: "ANG", value: 90, min: 0, max: 180, precision: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_HARDWARE,
    tooltip: "Mueve un servo a un ángulo 0–180 (servo).",
  },
  {
    type: "pyblock_motor",
    message0: "motor pin %1 velocidad %2",
    args0: [
      { type: "field_number", name: "PIN", value: 10, min: 0, precision: 1 },
      { type: "field_number", name: "SPEED", value: 80, min: -100, max: 100, precision: 1 },
    ],
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
]);
