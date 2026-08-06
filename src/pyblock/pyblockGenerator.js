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

// ----- Hardware EDA6 (placa esp32-eda6) -----
// Cada generador emite EXACTAMENTE la llamada a la función pública de EDA6.py,
// sin async/await. El puerto sale de un dropdown (cadena "1".."4").
pythonGenerator.forBlock["pyblock_eda6_salida_digital"] = function (block, generator) {
  const n = block.getFieldValue("N");
  const val = valOr(generator, block, "VAL", "1");
  return "salidaDigital(" + n + ", " + val + ")\n";
};

pythonGenerator.forBlock["pyblock_eda6_entrada_digital"] = function (block) {
  const n = block.getFieldValue("N");
  return ["entradaDigital(" + n + ")", Order.FUNCTION_CALL];
};

pythonGenerator.forBlock["pyblock_eda6_entrada_analogica"] = function (block) {
  const n = block.getFieldValue("N");
  return ["entradaAnalogica(" + n + ")", Order.FUNCTION_CALL];
};

pythonGenerator.forBlock["pyblock_eda6_servomotor"] = function (block, generator) {
  const n = block.getFieldValue("N");
  const ang = valOr(generator, block, "ANG", "90");
  return "servomotor(" + n + ", " + ang + ")\n";
};

pythonGenerator.forBlock["pyblock_eda6_motor_rc"] = function (block, generator) {
  const n = block.getFieldValue("N");
  const speed = valOr(generator, block, "SPEED", "0");
  return "motorRC(" + n + ", " + speed + ")\n";
};

pythonGenerator.forBlock["pyblock_eda6_sensor_distancia"] = function (block) {
  const n = block.getFieldValue("N");
  return ["sensorDistancia(" + n + ")", Order.FUNCTION_CALL];
};

pythonGenerator.forBlock["pyblock_eda6_detener"] = function () {
  return "detenerTodo()\n";
};

pythonGenerator.forBlock["pyblock_eda6_print_lcd"] = function (block, generator) {
  const col = valOr(generator, block, "COL", "0");
  const fila = valOr(generator, block, "FILA", "0");
  const txt = valOr(generator, block, "TEXT", '""');
  return "printLCD(" + col + ", " + fila + ", " + txt + ")\n";
};

pythonGenerator.forBlock["pyblock_eda6_limpiar_lcd"] = function () {
  return "limpiarLCD()\n";
};

pythonGenerator.forBlock["pyblock_eda6_luz_lcd"] = function (block) {
  const estado = block.getFieldValue("ESTADO");
  return "luzLCD(" + estado + ")\n";
};

// Junta las piezas de un bloque "crear texto con" (text_join) sin usar join().
function textJoinItems(block, generator) {
  const n = block.itemCount_ ?? 0;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const code = generator.valueToCode(block, "ADD" + i, Order.NONE);
    parts.push(code && code.trim() !== "" ? code : '""');
  }
  return parts;
}

pythonGenerator.forBlock["pyblock_print"] = function (block, generator) {
  // Si adentro hay "crear texto con", usamos la forma natural de Python:
  // print(a, " ", b) en vez de print("".join([...])). Asi se ve igual en
  // Python, pseudocodigo (output a, " ", b) y diagrama de flujo.
  const valueBlock = block.getInputTargetBlock("VALUE");
  if (valueBlock && valueBlock.type === "text_join") {
    const parts = textJoinItems(valueBlock, generator);
    return "print(" + (parts.length ? parts.join(", ") : '""') + ")\n";
  }
  const value = generator.valueToCode(block, "VALUE", Order.NONE) || '""';
  return "print(" + value + ")\n";
};

// "crear texto con" fuera de un print: concatenacion legible en vez de join().
pythonGenerator.forBlock["text_join"] = function (block, generator) {
  const parts = textJoinItems(block, generator);
  if (parts.length === 0) return ['""', Order.ATOMIC];
  if (parts.length === 1) return ["str(" + parts[0] + ")", Order.FUNCTION_CALL];
  return [parts.map((p) => "str(" + p + ")").join(" + "), Order.ADDITIVE];
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

// Blockly declara por defecto todas las variables como "x = None" al comienzo
// del programa. Eso ensucia el codigo, rompe la fidelidad del ida y vuelta con
// Python/pseudo (el original no las tiene) y confunde a quien recien aprende.
// Como los bloques asignan las variables antes de usarlas, quitamos esas
// declaraciones automaticas.
if (!pythonGenerator.__pybotNoAutoVars) {
  pythonGenerator.__pybotNoAutoVars = true;
  const origFinish = pythonGenerator.finish.bind(pythonGenerator);
  pythonGenerator.finish = function (code) {
    if (this.definitions_) delete this.definitions_["variables"];
    return origFinish(code);
  };
}

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
