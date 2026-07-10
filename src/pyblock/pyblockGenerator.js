/**
 * PyBlock โ�� Generador: bloques -> Python real de PyBot.
 *
 * Mรณdulo NUEVO y AISLADO. Usa el generador Python oficial de Blockly como base
 * (para indentaciรณn, variables, lรณgica, matemรกtica, texto, funciones y
 * procedimientos estรกndar) y define la traducciรณn de los bloques propios de
 * PyBot a su API (pin/servo/motor/wait/print).
 *
 * Importar este archivo registra los generadores. Exporta una funciรณn para
 * convertir un workspace en cรณdigo Python.
 */

import { pythonGenerator, Order } from "blockly/python";

// PyBot usa indentaciรณn de 4 espacios.
pythonGenerator.INDENT = "    ";

function valOr(generator, block, name, fallback) {
  const code = generator.valueToCode(block, name, Order.NONE);
  return code && code.trim() !== "" ? code : fallback;
}

// Bloque de inicio (hat, estilo Scratch): no genera codigo propio. Los bloques
// apilados debajo se encadenan solos via el next-connection estandar de
// Blockly (Generator.scrub_), igual que si estuvieran sueltos en el nivel
// principal.
pythonGenerator.forBlock["pyblock_start"] = function () {
  return "";
};

pythonGenerator.forBlock["pyblock_while"] = function (block, generator) {
  const cond = generator.valueToCode(block, "COND", Order.NONE) || "True";
  const body = generator.statementToCode(block, "DO") || generator.INDENT + "pass\n";
  return "while " + cond + ":\n" + body;
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

pythonGenerator.forBlock["pyblock_input"] = function (block, generator) {
  const type = block.getFieldValue("TYPE");
  const msg = generator.valueToCode(block, "MSG", Order.NONE) || '""';
  const code = "input(" + msg + ")";
  if (type === "NUMBER") {
    return ["int(" + code + ")", Order.FUNCTION_CALL];
  }
  return [code, Order.FUNCTION_CALL];
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

// ----- Canvas / Dibujo (usa las funciones canvas ya existentes en el runtime) -----
pythonGenerator.forBlock["pyblock_canvas_screen"] = function (block, generator) {
  const w = valOr(generator, block, "W", "400");
  const h = valOr(generator, block, "H", "300");
  return "pantalla(" + w + ", " + h + ")\n";
};

pythonGenerator.forBlock["pyblock_canvas_fill"] = function (block, generator) {
  const color = valOr(generator, block, "COLOR", '"black"');
  return "fondo(" + color + ")\n";
};

pythonGenerator.forBlock["pyblock_canvas_rect"] = function (block, generator) {
  const x = valOr(generator, block, "X", "10");
  const y = valOr(generator, block, "Y", "10");
  const w = valOr(generator, block, "W", "80");
  const h = valOr(generator, block, "H", "40");
  const color = valOr(generator, block, "COLOR", '"white"');
  return "dibujar_rect(" + x + ", " + y + ", " + w + ", " + h + ", " + color + ")\n";
};

pythonGenerator.forBlock["pyblock_canvas_circle"] = function (block, generator) {
  const x = valOr(generator, block, "X", "100");
  const y = valOr(generator, block, "Y", "100");
  const r = valOr(generator, block, "R", "30");
  const color = valOr(generator, block, "COLOR", '"red"');
  return "dibujar_circulo(" + x + ", " + y + ", " + r + ", " + color + ")\n";
};

pythonGenerator.forBlock["pyblock_canvas_line"] = function (block, generator) {
  const x1 = valOr(generator, block, "X1", "0");
  const y1 = valOr(generator, block, "Y1", "0");
  const x2 = valOr(generator, block, "X2", "100");
  const y2 = valOr(generator, block, "Y2", "100");
  const color = valOr(generator, block, "COLOR", '"white"');
  const width = valOr(generator, block, "WIDTH", "2");
  return (
    "dibujar_linea(" + x1 + ", " + y1 + ", " + x2 + ", " + y2 + ", " + color + ", " + width + ")\n"
  );
};

pythonGenerator.forBlock["pyblock_canvas_text"] = function (block, generator) {
  const x = valOr(generator, block, "X", "20");
  const y = valOr(generator, block, "Y", "30");
  const msg = valOr(generator, block, "MSG", '"Hola"');
  const color = valOr(generator, block, "COLOR", '"white"');
  const size = valOr(generator, block, "SIZE", "18");
  return "texto(" + x + ", " + y + ", " + msg + ", " + color + ", " + size + ")\n";
};

pythonGenerator.forBlock["pyblock_canvas_update"] = function () {
  return "actualizar()\n";
};

pythonGenerator.forBlock["pyblock_canvas_clear"] = function () {
  return "limpiar()\n";
};

pythonGenerator.forBlock["pyblock_canvas_key"] = function (block, generator) {
  const key = valOr(generator, block, "KEY", '"ArrowRight"');
  return ["tecla(" + key + ")", Order.FUNCTION_CALL];
};

// "cambiar variable por N" limpio: x = x + N (en vez del isinstance() de Blockly).
pythonGenerator.forBlock["math_change"] = function (block, generator) {
  const delta = generator.valueToCode(block, "DELTA", Order.ADDITIVE) || "0";
  const varName = generator.getVariableName(block.getFieldValue("VAR"));
  return varName + " = " + varName + " + " + delta + "\n";
};

/**
 * Convierte un workspace de Blockly en cรณdigo Python de PyBot.
 * @param {import('blockly').Workspace} workspace
 * @returns {string}
 */
export function pyblockWorkspaceToPython(workspace) {
  if (!workspace) return "";
  const code = pythonGenerator.workspaceToCode(workspace);
  return (code ?? "").trimEnd();
}
