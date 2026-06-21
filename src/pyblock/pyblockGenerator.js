/**
 * PyBlock — Generador: bloques -> Python real de PyBot.
 *
 * Módulo NUEVO y AISLADO. Usa el generador Python oficial de Blockly como base
 * (para indentación y bloques de valor estándar como número/texto) y define la
 * traducción de cada bloque PyBlock a la API de PyBot (pin/servo/motor/wait/print).
 *
 * Importar este archivo registra los generadores. Exporta una función para
 * convertir un workspace en código Python.
 */

import { pythonGenerator, Order } from "blockly/python";

// PyBot usa indentación de 4 espacios.
pythonGenerator.INDENT = "    ";

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return String(Math.trunc(n));
}

function numStr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  // Mantiene decimales (p. ej. 0.5) pero sin notación rara.
  return String(n);
}

pythonGenerator.forBlock["pyblock_forever"] = function (block, generator) {
  const body = generator.statementToCode(block, "DO") || generator.INDENT + "pass\n";
  return "while True:\n" + body;
};

pythonGenerator.forBlock["pyblock_repeat"] = function (block, generator) {
  const times = toInt(block.getFieldValue("TIMES"));
  const body = generator.statementToCode(block, "DO") || generator.INDENT + "pass\n";
  return "for i in range(" + times + "):\n" + body;
};

pythonGenerator.forBlock["pyblock_wait"] = function (block) {
  const secs = numStr(block.getFieldValue("SECS"));
  return "wait(" + secs + ")\n";
};

pythonGenerator.forBlock["pyblock_pin_write"] = function (block) {
  const pin = toInt(block.getFieldValue("PIN"));
  const val = block.getFieldValue("VAL");
  return 'pin("out", ' + pin + ", " + val + ")\n";
};

pythonGenerator.forBlock["pyblock_pin_read"] = function (block) {
  const pin = toInt(block.getFieldValue("PIN"));
  return ['pin("in", ' + pin + ")", Order.ATOMIC];
};

pythonGenerator.forBlock["pyblock_analog_read"] = function (block) {
  const ch = block.getFieldValue("CH");
  return ['pin("in", "A' + ch + '")', Order.ATOMIC];
};

pythonGenerator.forBlock["pyblock_servo"] = function (block) {
  const pin = toInt(block.getFieldValue("PIN"));
  const ang = toInt(block.getFieldValue("ANG"));
  return "servo(" + pin + ", " + ang + ")\n";
};

pythonGenerator.forBlock["pyblock_motor"] = function (block) {
  const pin = toInt(block.getFieldValue("PIN"));
  const speed = toInt(block.getFieldValue("SPEED"));
  return "motor(" + pin + ", " + speed + ")\n";
};

pythonGenerator.forBlock["pyblock_print"] = function (block, generator) {
  const value = generator.valueToCode(block, "VALUE", Order.NONE) || '""';
  return "print(" + value + ")\n";
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
