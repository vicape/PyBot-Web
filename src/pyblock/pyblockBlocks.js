/**
 * PyBlock — Definición de bloques.
 *
 * Módulo NUEVO y AISLADO. No toca nada del resto de PyBot.
 * Los bloques generan Python real de PyBot (ver pyblockGenerator.js).
 *
 * `definePyblockBlocks(lang)` fija el idioma de los bloques estándar de
 * Blockly (variables, lógica, funciones, etc.) y (re)define los bloques
 * propios de PyBot con sus textos en el idioma indicado. Se puede llamar
 * de nuevo cuando el usuario cambia el idioma de la app: los bloques ya
 * colocados en el workspace se vuelven a crear a partir del estado
 * guardado, así que adoptan el nuevo texto.
 *
 * Los bloques de hardware usan entradas de valor (input_value) con un número
 * "shadow" por defecto: se ven como antes, pero ahora se les puede enchufar una
 * variable o una operación matemática.
 */

import * as Blockly from "blockly";
import * as EsMsg from "blockly/msg/es";
import * as EnMsg from "blockly/msg/en";
import { t } from "../i18n.js";

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

/**
 * Fija el idioma de los bloques estándar de Blockly y (re)define los
 * bloques propios de PyBot en el idioma actual de la app.
 * @param {"es"|"en"} lang
 */
export function definePyblockBlocks(lang) {
  try {
    Blockly.setLocale(lang === "en" ? EnMsg : EsMsg);
  } catch {
    /* no romper si la versión de Blockly no expone setLocale */
  }

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
      message0: t("pyblockMsgForever"),
      args0: [
        { type: "input_dummy" },
        { type: "input_statement", name: "DO" },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CONTROL,
      tooltip: t("pyblockTipForever"),
    },
    {
      type: "pyblock_repeat",
      message0: t("pyblockMsgRepeat"),
      args0: [
        { type: "input_value", name: "TIMES", check: "Number" },
        { type: "input_statement", name: "DO" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CONTROL,
      tooltip: t("pyblockTipRepeat"),
    },
    {
      type: "pyblock_wait",
      message0: t("pyblockMsgWait"),
      args0: [{ type: "input_value", name: "SECS", check: "Number" }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CONTROL,
      tooltip: t("pyblockTipWait"),
    },

    // ----- Hardware -----
    {
      type: "pyblock_pin_write",
      message0: t("pyblockMsgPinWrite"),
      args0: [
        { type: "input_value", name: "PIN", check: "Number" },
        { type: "input_value", name: "VAL", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_HARDWARE,
      tooltip: t("pyblockTipPinWrite"),
    },
    {
      type: "pyblock_pin_read",
      message0: t("pyblockMsgPinRead"),
      args0: [{ type: "input_value", name: "PIN", check: "Number" }],
      inputsInline: true,
      output: "Number",
      colour: HUE_HARDWARE,
      tooltip: t("pyblockTipPinRead"),
    },
    {
      type: "pyblock_analog_read",
      message0: t("pyblockMsgAnalogRead"),
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
      tooltip: t("pyblockTipAnalogRead"),
    },
    {
      type: "pyblock_servo",
      message0: t("pyblockMsgServo"),
      args0: [
        { type: "input_value", name: "PIN", check: "Number" },
        { type: "input_value", name: "ANG", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_HARDWARE,
      tooltip: t("pyblockTipServo"),
    },
    {
      type: "pyblock_motor",
      message0: t("pyblockMsgMotor"),
      args0: [
        { type: "input_value", name: "PIN", check: "Number" },
        { type: "input_value", name: "SPEED", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_HARDWARE,
      tooltip: t("pyblockTipMotor"),
    },

    // ----- Salida -----
    {
      type: "pyblock_print",
      message0: t("pyblockMsgPrint"),
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: HUE_OUTPUT,
      tooltip: t("pyblockTipPrint"),
    },

    // ----- Canvas / Dibujo -----
    {
      type: "pyblock_canvas_screen",
      message0: t("pyblockMsgCanvasScreen"),
      args0: [
        { type: "input_value", name: "W", check: "Number" },
        { type: "input_value", name: "H", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CANVAS,
      tooltip: t("pyblockTipCanvasScreen"),
    },
    {
      type: "pyblock_canvas_fill",
      message0: t("pyblockMsgCanvasFill"),
      args0: [{ type: "input_value", name: "COLOR", check: "String" }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CANVAS,
      tooltip: t("pyblockTipCanvasFill"),
    },
    {
      type: "pyblock_canvas_rect",
      message0: t("pyblockMsgCanvasRect"),
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
      tooltip: t("pyblockTipCanvasRect"),
    },
    {
      type: "pyblock_canvas_circle",
      message0: t("pyblockMsgCanvasCircle"),
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
      tooltip: t("pyblockTipCanvasCircle"),
    },
    {
      type: "pyblock_canvas_line",
      message0: t("pyblockMsgCanvasLine"),
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
      tooltip: t("pyblockTipCanvasLine"),
    },
    {
      type: "pyblock_canvas_text",
      message0: t("pyblockMsgCanvasText"),
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
      tooltip: t("pyblockTipCanvasText"),
    },
    {
      type: "pyblock_canvas_update",
      message0: t("pyblockMsgCanvasUpdate"),
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CANVAS,
      tooltip: t("pyblockTipCanvasUpdate"),
    },
    {
      type: "pyblock_canvas_clear",
      message0: t("pyblockMsgCanvasClear"),
      previousStatement: null,
      nextStatement: null,
      colour: HUE_CANVAS,
      tooltip: t("pyblockTipCanvasClear"),
    },
    {
      type: "pyblock_canvas_key",
      message0: t("pyblockMsgCanvasKey"),
      args0: [{ type: "input_value", name: "KEY", check: "String" }],
      inputsInline: true,
      output: "Boolean",
      colour: HUE_CANVAS,
      tooltip: t("pyblockTipCanvasKey"),
    },
  ]);
}
