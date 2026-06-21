/**
 * PyBlock — Toolbox (categorías y bloques disponibles). Módulo nuevo y aislado.
 */

export const PYBLOCK_TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Control",
      colour: "210",
      contents: [
        { kind: "block", type: "pyblock_forever" },
        { kind: "block", type: "pyblock_repeat" },
        { kind: "block", type: "pyblock_wait" },
      ],
    },
    {
      kind: "category",
      name: "Hardware",
      colour: "25",
      contents: [
        { kind: "block", type: "pyblock_pin_write" },
        { kind: "block", type: "pyblock_pin_read" },
        { kind: "block", type: "pyblock_analog_read" },
        { kind: "block", type: "pyblock_servo" },
        { kind: "block", type: "pyblock_motor" },
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
    {
      kind: "category",
      name: "Valores",
      colour: "330",
      contents: [
        { kind: "block", type: "math_number", fields: { NUM: 0 } },
        { kind: "block", type: "text" },
      ],
    },
  ],
};
