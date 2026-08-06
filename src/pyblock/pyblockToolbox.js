/**
 * PyBlock — Toolbox (categorías y bloques disponibles). Módulo nuevo y aislado.
 *
 * Incluye bloques propios de PyBot (control/hardware/salida) y bloques estándar
 * de Blockly (variables, funciones/procedimientos, lógica, matemática y texto).
 * Las entradas de hardware traen un número "shadow" por defecto, que se puede
 * reemplazar enchufando una variable o una operación.
 *
 * `getPyblockToolbox()` construye la toolbox con los nombres de categoría en
 * el idioma actual de la app; se puede volver a llamar cuando el idioma
 * cambia (ver PyBlockEditor.jsx).
 */

import { t } from "../i18n.js";

const numberShadow = (num) => ({
  shadow: { kind: "block", type: "math_number", fields: { NUM: num } },
});

const textShadow = (txt) => ({
  shadow: { kind: "block", type: "text", fields: { TEXT: txt } },
});

const trueShadow = () => ({
  shadow: { kind: "block", type: "logic_boolean", fields: { BOOL: "TRUE" } },
});

// Bloques de hardware genéricos (API pin/servo/motor) para arduino-firmata y
// esp32-micropython. Comparten la misma API pin(...), así que se reutilizan.
const genericHardwareContents = () => [
  {
    kind: "block",
    type: "pyblock_pin_write",
    inputs: { PIN: numberShadow(13), VAL: numberShadow(1) },
  },
  {
    kind: "block",
    type: "pyblock_pin_read",
    inputs: { PIN: numberShadow(2) },
  },
  { kind: "block", type: "pyblock_analog_read" },
  {
    kind: "block",
    type: "pyblock_servo",
    inputs: { PIN: numberShadow(9), ANG: numberShadow(90) },
  },
  {
    kind: "block",
    type: "pyblock_motor",
    inputs: { PIN: numberShadow(10), SPEED: numberShadow(80) },
  },
];

// Bloques de hardware EDA6: representan las funciones reales de EDA6.py con el
// mismo nombre que en Python. Puertos 1-4 (dropdown). Sólo para esp32-eda6.
const eda6HardwareContents = () => [
  {
    kind: "block",
    type: "pyblock_eda6_salida_digital",
    inputs: { VAL: numberShadow(1) },
  },
  { kind: "block", type: "pyblock_eda6_entrada_digital" },
  { kind: "block", type: "pyblock_eda6_entrada_analogica" },
  {
    kind: "block",
    type: "pyblock_eda6_servomotor",
    inputs: { ANG: numberShadow(90) },
  },
  {
    kind: "block",
    type: "pyblock_eda6_motor_rc",
    inputs: { SPEED: numberShadow(0) },
  },
  { kind: "block", type: "pyblock_eda6_sensor_distancia" },
  { kind: "block", type: "pyblock_eda6_detener" },
  {
    kind: "block",
    type: "pyblock_eda6_print_lcd",
    inputs: {
      COL: numberShadow(0),
      FILA: numberShadow(0),
      TEXT: textShadow("Hola"),
    },
  },
  { kind: "block", type: "pyblock_eda6_limpiar_lcd" },
  { kind: "block", type: "pyblock_eda6_luz_lcd" },
];

/**
 * Construye la toolbox de PyBlock. La categoría Hardware depende del `boardType`
 * seleccionado: los bloques EDA6 reales para "esp32-eda6", y los bloques
 * genéricos (pin/servo/motor) para el resto.
 * @param {string} [boardType] - "arduino-firmata" | "esp32-micropython" | "esp32-eda6"
 */
export function getPyblockToolbox(boardType) {
  const hardwareContents =
    boardType === "esp32-eda6" ? eda6HardwareContents() : genericHardwareContents();
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: t("pyblockStart"),
        colour: "120",
        contents: [{ kind: "block", type: "pyblock_start" }],
      },
      {
        kind: "category",
        name: t("pyblockCatControl"),
        colour: "210",
        contents: [
          {
            kind: "block",
            type: "pyblock_while",
            inputs: { COND: trueShadow() },
          },
          {
            kind: "block",
            type: "pyblock_repeat",
            inputs: { TIMES: numberShadow(10) },
          },
          {
            kind: "block",
            type: "controls_for",
            inputs: {
              FROM: numberShadow(1),
              TO: numberShadow(10),
              BY: numberShadow(1),
            },
          },
          {
            kind: "block",
            type: "pyblock_wait",
            inputs: { SECS: numberShadow(0.5) },
          },
          { kind: "block", type: "controls_if" },
        ],
      },
      {
        kind: "category",
        name: t("pyblockCatLogic"),
        colour: "210",
        contents: [
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
        ],
      },
      {
        kind: "category",
        name: t("pyblockCatMath"),
        colour: "230",
        contents: [
          { kind: "block", type: "math_number", fields: { NUM: 0 } },
          {
            kind: "block",
            type: "math_arithmetic",
            inputs: { A: numberShadow(1), B: numberShadow(1) },
          },
          {
            kind: "block",
            type: "math_modulo",
            inputs: { DIVIDEND: numberShadow(10), DIVISOR: numberShadow(2) },
          },
        ],
      },
      {
        kind: "category",
        name: t("pyblockCatVariables"),
        colour: "330",
        custom: "VARIABLE",
      },
      {
        kind: "category",
        name: t("pyblockCatProcedures"),
        colour: "290",
        custom: "PROCEDURE",
      },
      {
        kind: "category",
        name: t("pyblockCatHardware"),
        colour: "25",
        contents: hardwareContents,
      },
      {
        kind: "category",
        name: t("pyblockCatCanvas"),
        colour: "290",
        contents: [
          {
            kind: "block",
            type: "pyblock_canvas_screen",
            inputs: { W: numberShadow(400), H: numberShadow(300) },
          },
          {
            kind: "block",
            type: "pyblock_canvas_fill",
            inputs: { COLOR: textShadow("black") },
          },
          {
            kind: "block",
            type: "pyblock_canvas_rect",
            inputs: {
              X: numberShadow(10),
              Y: numberShadow(10),
              W: numberShadow(80),
              H: numberShadow(40),
              COLOR: textShadow("white"),
            },
          },
          {
            kind: "block",
            type: "pyblock_canvas_circle",
            inputs: {
              X: numberShadow(100),
              Y: numberShadow(100),
              R: numberShadow(30),
              COLOR: textShadow("red"),
            },
          },
          {
            kind: "block",
            type: "pyblock_canvas_line",
            inputs: {
              X1: numberShadow(0),
              Y1: numberShadow(0),
              X2: numberShadow(100),
              Y2: numberShadow(100),
              COLOR: textShadow("white"),
              WIDTH: numberShadow(2),
            },
          },
          {
            kind: "block",
            type: "pyblock_canvas_text",
            inputs: {
              X: numberShadow(20),
              Y: numberShadow(30),
              MSG: textShadow("Hola"),
              COLOR: textShadow("white"),
              SIZE: numberShadow(18),
            },
          },
          { kind: "block", type: "pyblock_canvas_update" },
          { kind: "block", type: "pyblock_canvas_clear" },
          {
            kind: "block",
            type: "pyblock_canvas_key",
            inputs: { KEY: textShadow("ArrowRight") },
          },
        ],
      },
      {
        kind: "category",
        name: t("pyblockCatText"),
        colour: "160",
        contents: [
          { kind: "block", type: "text" },
          { kind: "block", type: "text_join" },
        ],
      },
      {
        kind: "category",
        name: t("pyblockCatOutput"),
        colour: "160",
        contents: [
          {
            kind: "block",
            type: "pyblock_print",
            inputs: {
              VALUE: {
                shadow: { kind: "block", type: "text", fields: { TEXT: "Hola" } },
              },
            },
          },
          {
            kind: "block",
            type: "pyblock_input",
            inputs: { MSG: textShadow("¿Cómo te llamás?") },
          },
        ],
      },
    ],
  };
}
