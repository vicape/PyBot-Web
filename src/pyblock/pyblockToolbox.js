/**
 * PyBlock — Toolbox (categorías y bloques disponibles). Módulo nuevo y aislado.
 *
 * Incluye bloques propios de PyBot (control/hardware/salida) y bloques estándar
 * de Blockly (variables, funciones/procedimientos, lógica, matemática y texto).
 * Las entradas de hardware traen un número "shadow" por defecto, que se puede
 * reemplazar enchufando una variable o una operación.
 */

const numberShadow = (num) => ({
  shadow: { kind: "block", type: "math_number", fields: { NUM: num } },
});

const textShadow = (txt) => ({
  shadow: { kind: "block", type: "text", fields: { TEXT: txt } },
});

export const PYBLOCK_TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Control",
      colour: "210",
      contents: [
        { kind: "block", type: "pyblock_forever" },
        {
          kind: "block",
          type: "pyblock_repeat",
          inputs: { TIMES: numberShadow(10) },
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
      name: "Lógica",
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
      name: "Matemática",
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
      name: "Variables",
      colour: "330",
      custom: "VARIABLE",
    },
    {
      kind: "category",
      name: "Procedimientos y funciones",
      colour: "290",
      custom: "PROCEDURE",
    },
    {
      kind: "category",
      name: "Hardware",
      colour: "25",
      contents: [
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
      ],
    },
    {
      kind: "category",
      name: "Canvas",
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
      name: "Texto",
      colour: "160",
      contents: [
        { kind: "block", type: "text" },
        { kind: "block", type: "text_join" },
      ],
    },
    {
      kind: "category",
      name: "Salida",
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
      ],
    },
  ],
};
