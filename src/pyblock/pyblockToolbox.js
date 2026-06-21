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
