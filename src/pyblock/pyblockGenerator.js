/**
 * PyBlock — Generador: bloques -> Python real de PyBot.
 *
 * Módulo NUEVO y AISLADO. Usa el generador Python oficial de Blockly como base
 * (para indentación, variables, lógica, matemática, texto, funciones y
 * procedimientos estándar) y define la traducción de los bloques propios de
 * PyBot a su API (pin/servo/motor/wait/print).
 *
 * Importar este archivo registra los generadores. Exporta una función para
 * convertir un workspace en código Python.
 */

import { pythonGenerator, Order } from "blockly/python";

// PyBot usa indentación de 4 espacios.
pythonGenerator.INDENT = "    ";

function valOr(generator, block, name, fallback) {
  const code = generator.valueToCode(block, name, Order.NONE);
  return code && code.trim() !== "" ? code : fallback;
}

pythonGenerator.forBlock["pyblock_forever"] = function (block, generator) {
  const body = generator.statementToCode(block, "DO") || generator.INDENT + "pass\n";
  return "while True:\n" + body;
};

pythonGenerator.forBlock["pyblock_repeat"] = function (block, generator) {
  const times = valOr(generator, block, "TIMES", "10");
  const body = generator.statementToCode(block, "DO") || generator.INDENT + "pass\n";
  return "for i in range(" + times + "):\n" + body;
};

pythonGenerator.forBlock["pyblock_wait"] = function (block, generator) {
  const secs = valOr(generator, block, "SECS", "0.5");
  return "wait(" + secs + ")\n";
};

pythonGenerator.forBlock["pyblock_pin_write"] = function (block, generator) {
  const pin = valOr(generator, block, "PIN", "13");
  const val = valOr(generator, block, "VAL", "0");
  return 'pin("out", ' + pin + ", " + val + ")\n";
};

pythonGenerator.forBlock["pyblock_pin_read"] = function (block, generator) {
  const pin = valOr(generator, block, "PIN", "2");
  return ['pin("in", ' + pin + ")", Order.FUNCTION_CALL];
};

pythonGenerator.forBlock["pyblock_analog_read"] = function (block) {
  const ch = block.getFieldValue("CH");
  return ['pin("in", "A' + ch + '")', Order.FUNCTION_CALL];
};

pythonGenerator.forBlock["pyblock_servo"] = function (block, generator) {
  const pin = valOr(generator, block, "PIN", "9");
  const ang = valOr(generator, block, "ANG", "90");
  return "servo(" + pin + ", " + ang + ")\n";
};

pythonGenerator.forBlock["pyblock_motor"] = function (block, generator) {
  const pin = valOr(generator, block, "PIN", "10");
  const speed = valOr(generator, block, "SPEED", "0");
  return "motor(" + pin + ", " + speed + ")\n";
};

pythonGenerator.forBlock["pyblock_print"] = function (block, generator) {
  const value = generator.valueToCode(block, "VALUE", Order.NONE) || '""';
  return "print(" + value + ")\n";
};

// "cambiar variable por N" limpio: x = x + N (en vez del isinstance() de Blockly).
pythonGenerator.forBlock["math_change"] = function (block, generator) {
  const delta = generator.valueToCode(block, "DELTA", Order.ADDITIVE) || "0";
  const varName = generator.getVariableName(block.getFieldValue("VAR"));
  return varName + " = " + varName + " + " + delta + "\n";
};

/**
 * Convierte un workspace de Blockly en código Python de PyBot.
 * @param {import('blockly').Workspace} workspace
 * @returns {string}
 */
export function pyblockWorkspaceToPython(workspace) {
  if (!workspace) return "";
  const code = pythonGenerator.workspaceToCode(workspace);
  return (code ?? "").trimEnd();
}
