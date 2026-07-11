/**
 * Rosetta — Generador AST -> Python.
 *
 * Reconstruye Python valido y ejecutable (el mismo que corre PyBot en Pyodide)
 * a partir del AST comun. Se usa cuando el alumno autor en otra superficie
 * (pseudocodigo o flowchart) y queremos correrlo o verlo como Python.
 */

const INDENT = "    ";

function pad(level) {
  return INDENT.repeat(level);
}

// Precedencias para parentizar lo justo y necesario.
const PREC = {
  BoolOpOr: 1,
  BoolOpAnd: 2,
  Not: 3,
  Compare: 4,
  Add: 5,
  Mul: 6,
  Unary: 7,
  Power: 8,
  Postfix: 9,
  Atom: 10,
};

function precOf(node) {
  switch (node.type) {
    case "BoolOp":
      return node.op === "or" ? PREC.BoolOpOr : PREC.BoolOpAnd;
    case "Compare":
      return PREC.Compare;
    case "UnaryOp":
      return node.op === "not" ? PREC.Not : PREC.Unary;
    case "BinOp":
      if (node.op === "+" || node.op === "-") return PREC.Add;
      if (node.op === "**") return PREC.Power;
      return PREC.Mul;
    default:
      return PREC.Atom;
  }
}

function wrap(childCode, childNode, parentPrec) {
  return precOf(childNode) < parentPrec ? `(${childCode})` : childCode;
}

function pyStr(value) {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function exprToPython(node) {
  if (!node) return "";
  switch (node.type) {
    case "Num":
      return String(node.value);
    case "Str":
      return (node.prefix ?? "") + pyStr(node.value);
    case "Bool":
      return node.value ? "True" : "False";
    case "Name":
      return node.id;
    case "List":
      return `[${node.elts.map(exprToPython).join(", ")}]`;
    case "Subscript":
      return `${exprToPython(node.obj)}[${exprToPython(node.index)}]`;
    case "Attribute":
      return `${exprToPython(node.obj)}.${node.attr}`;
    case "Call":
      return `${exprToPython(node.func)}(${node.args.map(exprToPython).join(", ")})`;
    case "Input":
      return node.prompt ? `input(${exprToPython(node.prompt)})` : "input()";
    case "BinOp": {
      const p = precOf(node);
      const l = wrap(exprToPython(node.left), node.left, p);
      const r = wrap(exprToPython(node.right), node.right, node.op === "**" ? p : p + 1);
      return `${l} ${node.op} ${r}`;
    }
    case "Compare": {
      const p = precOf(node);
      const l = wrap(exprToPython(node.left), node.left, p + 1);
      const r = wrap(exprToPython(node.right), node.right, p + 1);
      return `${l} ${node.op} ${r}`;
    }
    case "BoolOp": {
      const p = precOf(node);
      return node.values.map((v) => wrap(exprToPython(v), v, p + 1)).join(` ${node.op} `);
    }
    case "UnaryOp": {
      if (node.op === "not") return `not ${wrap(exprToPython(node.operand), node.operand, PREC.Not)}`;
      return `-${wrap(exprToPython(node.operand), node.operand, PREC.Unary)}`;
    }
    default:
      return "";
  }
}

function stmtToPython(node, level, out) {
  const ind = pad(level);
  switch (node.type) {
    case "Assign":
      out.push(`${ind}${exprToPython(node.target)} = ${exprToPython(node.value)}`);
      break;
    case "AugAssign":
      out.push(`${ind}${exprToPython(node.target)} ${node.op}= ${exprToPython(node.value)}`);
      break;
    case "Output":
      out.push(`${ind}print(${node.args.map(exprToPython).join(", ")})`);
      break;
    case "ExprStmt":
      out.push(`${ind}${exprToPython(node.expr)}`);
      break;
    case "Return":
      out.push(`${ind}return${node.value ? " " + exprToPython(node.value) : ""}`);
      break;
    case "Break":
      out.push(`${ind}break`);
      break;
    case "Continue":
      out.push(`${ind}continue`);
      break;
    case "If":
      out.push(`${ind}if ${exprToPython(node.test)}:`);
      blockToPython(node.body, level + 1, out);
      writeOrelse(node.orelse, level, out);
      break;
    case "While":
      out.push(`${ind}while ${exprToPython(node.test)}:`);
      blockToPython(node.body, level + 1, out);
      break;
    case "Until":
      // Python no tiene "until": lo emulamos con while True + break.
      out.push(`${ind}while True:`);
      blockToPython(node.body, level + 1, out);
      out.push(`${pad(level + 1)}if ${exprToPython(node.test)}:`);
      out.push(`${pad(level + 2)}break`);
      break;
    case "ForRange":
      out.push(`${ind}for ${node.varName} in range(${node.rangeArgs.map(exprToPython).join(", ")}):`);
      blockToPython(node.body, level + 1, out);
      break;
    case "ForEach":
      out.push(`${ind}for ${node.varName} in ${exprToPython(node.iter)}:`);
      blockToPython(node.body, level + 1, out);
      break;
    case "FuncDef":
      out.push(`${ind}def ${node.name}(${node.params.join(", ")}):`);
      blockToPython(node.body, level + 1, out);
      break;
    case "Raw":
      out.push(`${ind}${node.text}`);
      break;
    default:
      break;
  }
}

function writeOrelse(orelse, level, out) {
  if (!orelse || orelse.length === 0) return;
  const ind = pad(level);
  // elif: un unico If dentro del orelse.
  if (orelse.length === 1 && orelse[0].type === "If") {
    const elifNode = orelse[0];
    out.push(`${ind}elif ${exprToPython(elifNode.test)}:`);
    blockToPython(elifNode.body, level + 1, out);
    writeOrelse(elifNode.orelse, level, out);
    return;
  }
  out.push(`${ind}else:`);
  blockToPython(orelse, level + 1, out);
}

function blockToPython(body, level, out) {
  if (!body || body.length === 0) {
    out.push(`${pad(level)}pass`);
    return;
  }
  for (const stmt of body) stmtToPython(stmt, level, out);
}

/**
 * @param {{type:'Program', body:Array}} ast
 * @returns {string}
 */
export function astToPython(ast) {
  if (!ast || !ast.body) return "";
  const out = [];
  for (const stmt of ast.body) stmtToPython(stmt, 0, out);
  return out.join("\n");
}
