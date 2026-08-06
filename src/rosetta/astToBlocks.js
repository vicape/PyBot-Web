/**
 * Rosetta — Generador AST -> Bloques (Blockly serialization JSON).
 *
 * Cierra el circuito: permite ver como BLOQUES un programa escrito en Python,
 * pseudocodigo o flowchart. Produce el JSON de serializacion de Blockly que
 * PyBlockEditor carga en el workspace.
 *
 * Cubre el subconjunto comun (asignaciones, while, for, if, print, input,
 * aritmetica, comparaciones, logica) y ademas remapea la API de PyBot
 * (pin/servo/motor/wait/canvas) a sus bloques propios, para que el ida y vuelta
 * con esos bloques no se pierda. Lo que no tiene bloque equivalente cae a un
 * bloque de texto visible (marcador) para no romper la estructura.
 */

import { exprToPython } from "./pythonGen.js";

let _idc = 1;
const nid = () => "rb" + _idc++;

const CMP_OP = { "==": "EQ", "!=": "NEQ", "<": "LT", "<=": "LTE", ">": "GT", ">=": "GTE" };
const ARITH_OP = { "+": "ADD", "-": "MINUS", "*": "MULTIPLY", "/": "DIVIDE", "**": "POWER" };

function varField(name) {
  return { id: name };
}

// -------------------------- Expresiones -------------------------------------

function textBlock(text) {
  return { type: "text", id: nid(), fields: { TEXT: text } };
}

function exprToBlock(node) {
  if (!node) return textBlock("");
  switch (node.type) {
    case "Num":
      return { type: "math_number", id: nid(), fields: { NUM: node.value } };
    case "Str":
      return textBlock(node.value);
    case "Bool":
      return { type: "logic_boolean", id: nid(), fields: { BOOL: node.value ? "TRUE" : "FALSE" } };
    case "Name":
      if (node.id === "None") return { type: "logic_null", id: nid() };
      if (node.id === "True" || node.id === "False")
        return { type: "logic_boolean", id: nid(), fields: { BOOL: node.id === "True" ? "TRUE" : "FALSE" } };
      return { type: "variables_get", id: nid(), fields: { VAR: varField(node.id) } };
    case "Input":
      return {
        type: "pyblock_input",
        id: nid(),
        fields: { TYPE: "TEXT" },
        inputs: { MSG: { block: exprToBlock(node.prompt ?? { type: "Str", value: "" }) } },
      };
    case "BinOp": {
      if (node.op === "%") {
        return {
          type: "math_modulo",
          id: nid(),
          inputs: {
            DIVIDEND: { block: exprToBlock(node.left) },
            DIVISOR: { block: exprToBlock(node.right) },
          },
        };
      }
      const op = ARITH_OP[node.op] ?? "ADD";
      return {
        type: "math_arithmetic",
        id: nid(),
        fields: { OP: op },
        inputs: { A: { block: exprToBlock(node.left) }, B: { block: exprToBlock(node.right) } },
      };
    }
    case "Compare":
      return {
        type: "logic_compare",
        id: nid(),
        fields: { OP: CMP_OP[node.op] ?? "EQ" },
        inputs: { A: { block: exprToBlock(node.left) }, B: { block: exprToBlock(node.right) } },
      };
    case "BoolOp": {
      // logic_operation es binario: plegamos a la izquierda.
      const opName = node.op === "or" ? "OR" : "AND";
      let acc = exprToBlock(node.values[0]);
      for (let i = 1; i < node.values.length; i++) {
        acc = {
          type: "logic_operation",
          id: nid(),
          fields: { OP: opName },
          inputs: { A: { block: acc }, B: { block: exprToBlock(node.values[i]) } },
        };
      }
      return acc;
    }
    case "UnaryOp":
      if (node.op === "not") {
        return {
          type: "logic_negate",
          id: nid(),
          inputs: { BOOL: { block: exprToBlock(node.operand) } },
        };
      }
      return {
        type: "math_single",
        id: nid(),
        fields: { OP: "NEG" },
        inputs: { NUM: { block: exprToBlock(node.operand) } },
      };
    case "Call": {
      const mapped = mapCallExpr(node);
      if (mapped) return mapped;
      return textBlock(exprToPython(node));
    }
    default:
      // Subscript, Attribute, List, etc.: marcador de texto visible.
      return textBlock(exprToPython(node));
  }
}

function isName(node, id) {
  return node && node.type === "Name" && node.id === id;
}

// Los puertos EDA6 son un dropdown 1-4. Sólo se pueden representar como bloque
// nativo si el argumento es un literal entero 1..4; si no, devolvemos null y el
// llamador cae a un marcador de texto (raw) para no perder el código.
function eda6PortField(node) {
  if (node && node.type === "Num" && Number.isInteger(node.value) && node.value >= 1 && node.value <= 4) {
    return String(node.value);
  }
  return null;
}

// Estado on/off de luzLCD: dropdown "1"/"0".
function eda6StateField(node) {
  if (node && node.type === "Num") return node.value ? "1" : "0";
  if (node && node.type === "Bool") return node.value ? "1" : "0";
  return null;
}

// Remapea llamadas de la API PyBot que devuelven valor.
function mapCallExpr(call) {
  const f = call.func;
  const a = call.args;
  if (isName(f, "pin") && a.length >= 2 && a[0].type === "Str") {
    if (a[0].value === "in") {
      // pin("in","A0") -> analog_read ; pin("in", p) -> pin_read
      if (a[1].type === "Str" && /^A\d+$/.test(a[1].value)) {
        return { type: "pyblock_analog_read", id: nid(), fields: { CH: a[1].value.slice(1) } };
      }
      return { type: "pyblock_pin_read", id: nid(), inputs: { PIN: { block: exprToBlock(a[1]) } } };
    }
  }
  if (isName(f, "tecla") && a.length >= 1) {
    return { type: "pyblock_canvas_key", id: nid(), inputs: { KEY: { block: exprToBlock(a[0]) } } };
  }
  // Funciones EDA6 que devuelven valor: entradaDigital / entradaAnalogica /
  // sensorDistancia. Sólo se mapean si el puerto es un literal 1-4; si no,
  // cae a un marcador de texto con el código original (sin romper).
  const eda6Reporter = {
    entradaDigital: "pyblock_eda6_entrada_digital",
    entradaAnalogica: "pyblock_eda6_entrada_analogica",
    sensorDistancia: "pyblock_eda6_sensor_distancia",
  };
  if (f && f.type === "Name" && eda6Reporter[f.id] && a.length >= 1) {
    const port = eda6PortField(a[0]);
    if (port !== null) return { type: eda6Reporter[f.id], id: nid(), fields: { N: port } };
  }
  return null;
}

// -------------------------- Sentencias --------------------------------------

function valueInput(node) {
  return { block: exprToBlock(node) };
}

// Remapea llamadas de la API PyBot usadas como sentencia.
function mapCallStmt(call) {
  const f = call.func;
  const a = call.args;
  const io = (type, names) => {
    const inputs = {};
    names.forEach((n, i) => {
      if (a[i] !== undefined) inputs[n] = valueInput(a[i]);
    });
    return { type, id: nid(), inputs };
  };
  if (isName(f, "wait")) return io("pyblock_wait", ["SECS"]);
  if (isName(f, "servo")) return io("pyblock_servo", ["PIN", "ANG"]);
  if (isName(f, "motor")) return io("pyblock_motor", ["PIN", "SPEED"]);
  if (isName(f, "pantalla")) return io("pyblock_canvas_screen", ["W", "H"]);
  if (isName(f, "fondo")) return io("pyblock_canvas_fill", ["COLOR"]);
  if (isName(f, "dibujar_rect")) return io("pyblock_canvas_rect", ["X", "Y", "W", "H", "COLOR"]);
  if (isName(f, "dibujar_circulo")) return io("pyblock_canvas_circle", ["X", "Y", "R", "COLOR"]);
  if (isName(f, "dibujar_linea"))
    return io("pyblock_canvas_line", ["X1", "Y1", "X2", "Y2", "COLOR", "WIDTH"]);
  if (isName(f, "texto")) return io("pyblock_canvas_text", ["X", "Y", "MSG", "COLOR", "SIZE"]);
  if (isName(f, "actualizar")) return { type: "pyblock_canvas_update", id: nid() };
  if (isName(f, "limpiar")) return { type: "pyblock_canvas_clear", id: nid() };
  if (isName(f, "pin") && a.length >= 3 && a[0].type === "Str" && a[0].value === "out") {
    return {
      type: "pyblock_pin_write",
      id: nid(),
      inputs: { PIN: valueInput(a[1]), VAL: valueInput(a[2]) },
    };
  }
  // Funciones EDA6 usadas como sentencia. El puerto es un dropdown (field N):
  // sólo se mapea a bloque nativo si es un literal 1-4; si no, devolvemos null
  // (el ExprStmt cae al marcador de texto, sin perder ni romper el código).
  if (isName(f, "detenerTodo")) return { type: "pyblock_eda6_detener", id: nid() };
  if (isName(f, "limpiarLCD")) return { type: "pyblock_eda6_limpiar_lcd", id: nid() };
  if (isName(f, "salidaDigital") && a.length >= 2) {
    const port = eda6PortField(a[0]);
    if (port !== null)
      return { type: "pyblock_eda6_salida_digital", id: nid(), fields: { N: port }, inputs: { VAL: valueInput(a[1]) } };
  }
  if (isName(f, "servomotor") && a.length >= 2) {
    const port = eda6PortField(a[0]);
    if (port !== null)
      return { type: "pyblock_eda6_servomotor", id: nid(), fields: { N: port }, inputs: { ANG: valueInput(a[1]) } };
  }
  if (isName(f, "motorRC") && a.length >= 2) {
    const port = eda6PortField(a[0]);
    if (port !== null)
      return { type: "pyblock_eda6_motor_rc", id: nid(), fields: { N: port }, inputs: { SPEED: valueInput(a[1]) } };
  }
  if (isName(f, "printLCD") && a.length >= 3) {
    return {
      type: "pyblock_eda6_print_lcd",
      id: nid(),
      inputs: { COL: valueInput(a[0]), FILA: valueInput(a[1]), TEXT: valueInput(a[2]) },
    };
  }
  if (isName(f, "luzLCD") && a.length >= 1) {
    const estado = eda6StateField(a[0]);
    if (estado !== null) return { type: "pyblock_eda6_luz_lcd", id: nid(), fields: { ESTADO: estado } };
  }
  return null;
}

function textJoinBlock(args) {
  const block = { type: "text_join", id: nid(), extraState: { itemCount: args.length }, inputs: {} };
  args.forEach((arg, i) => {
    block.inputs["ADD" + i] = valueInput(arg);
  });
  return block;
}

function stmtToBlock(stmt) {
  switch (stmt.type) {
    case "Assign": {
      if (stmt.target.type !== "Name") return null;
      return {
        type: "variables_set",
        id: nid(),
        fields: { VAR: varField(stmt.target.id) },
        inputs: { VALUE: valueInput(stmt.value) },
      };
    }
    case "AugAssign": {
      if (stmt.target.type !== "Name") return null;
      const combined = {
        type: "BinOp",
        op: stmt.op,
        left: { type: "Name", id: stmt.target.id },
        right: stmt.value,
      };
      return {
        type: "variables_set",
        id: nid(),
        fields: { VAR: varField(stmt.target.id) },
        inputs: { VALUE: valueInput(combined) },
      };
    }
    case "Output": {
      const value =
        stmt.args.length === 1 ? exprToBlock(stmt.args[0]) : textJoinBlock(stmt.args);
      return { type: "pyblock_print", id: nid(), inputs: { VALUE: { block: value } } };
    }
    case "ExprStmt": {
      if (stmt.expr.type === "Call") {
        const mapped = mapCallStmt(stmt.expr);
        if (mapped) return mapped;
      }
      return null; // llamada sin bloque equivalente: se omite
    }
    case "While":
      return {
        type: "pyblock_while",
        id: nid(),
        inputs: {
          COND: { block: exprToBlock(stmt.test) },
          ...chainInput("DO", stmt.body),
        },
      };
    case "ForRange":
      return forRangeToBlock(stmt);
    case "ForEach":
      return {
        type: "controls_forEach",
        id: nid(),
        fields: { VAR: varField(stmt.varName) },
        inputs: { LIST: { block: exprToBlock(stmt.iter) }, ...chainInput("DO", stmt.body) },
      };
    case "If":
      return ifToBlock(stmt);
    default:
      // Break, Continue, Return, FuncDef, Raw: sin bloque (por ahora).
      return null;
  }
}

function forRangeToBlock(stmt) {
  const args = stmt.rangeArgs;
  let start;
  let stopEx;
  let step = null;
  if (args.length === 1) {
    start = { type: "Num", value: 0 };
    stopEx = args[0];
  } else {
    start = args[0];
    stopEx = args[1];
    step = args[2] ?? null;
  }
  const toIncl =
    stopEx.type === "Num"
      ? { type: "Num", value: stopEx.value - 1 }
      : { type: "BinOp", op: "-", left: stopEx, right: { type: "Num", value: 1 } };
  return {
    type: "controls_for",
    id: nid(),
    fields: { VAR: varField(stmt.varName) },
    inputs: {
      FROM: valueInput(start),
      TO: valueInput(toIncl),
      BY: valueInput(step ?? { type: "Num", value: 1 }),
      ...chainInput("DO", stmt.body),
    },
  };
}

function ifToBlock(stmt) {
  // Aplana la cadena if / elif (elif = If unico dentro de orelse) / else.
  const clauses = [];
  let cur = stmt;
  let elseBody = null;
  for (;;) {
    clauses.push({ test: cur.test, body: cur.body });
    if (cur.orelse && cur.orelse.length === 1 && cur.orelse[0].type === "If") {
      cur = cur.orelse[0];
      continue;
    }
    if (cur.orelse && cur.orelse.length > 0) elseBody = cur.orelse;
    break;
  }
  const block = {
    type: "controls_if",
    id: nid(),
    extraState: { elseIfCount: clauses.length - 1, hasElse: !!elseBody },
    inputs: {},
  };
  if (clauses.length === 1 && !elseBody) delete block.extraState;
  clauses.forEach((c, i) => {
    block.inputs["IF" + i] = { block: exprToBlock(c.test) };
    Object.assign(block.inputs, chainInput("DO" + i, c.body));
  });
  if (elseBody) Object.assign(block.inputs, chainInput("ELSE", elseBody));
  return block;
}

// Construye un input de tipo "statement" (cuerpo) encadenando sentencias.
function chainInput(name, body) {
  const first = stmtsToChain(body);
  return first ? { [name]: { block: first } } : {};
}

function stmtsToChain(list) {
  const blocks = [];
  for (const s of list || []) {
    const b = stmtToBlock(s);
    if (b) blocks.push(b);
  }
  if (!blocks.length) return null;
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}

// Junta los nombres de variables para declararlas en el workspace.
function collectVars(ast) {
  const names = new Set();
  const RESERVED = new Set(["None", "True", "False"]);
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    // Toda variable referenciada debe declararse para que Blockly la cargue.
    if (n.type === "Name" && !RESERVED.has(n.id)) names.add(n.id);
    if ((n.type === "ForRange" || n.type === "ForEach") && n.varName) names.add(n.varName);
    // El nombre de funcion de una llamada no es una variable.
    if (n.type === "Call") {
      (n.args || []).forEach(visit);
      return;
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return [...names];
}

/**
 * Convierte el AST comun en JSON de serializacion de Blockly.
 * @param {{type:'Program', body:Array}} ast
 * @returns {object} JSON para Blockly.serialization.workspaces.load
 */
export function astToBlockly(ast) {
  _idc = 1;
  const body = ast && ast.body ? ast.body : [];
  const chain = stmtsToChain(body);
  const start = { type: "pyblock_start", id: nid(), x: 40, y: 40 };
  if (chain) start.next = { block: chain };
  const variables = collectVars(ast).map((name) => ({ name, id: name }));
  return {
    variables,
    blocks: { languageVersion: 0, blocks: [start] },
  };
}
