/**
 * Rosetta — Generador AST -> Pseudocodigo (notacion aprobada del IB).
 *
 * Convenciones IB que aplicamos:
 *  - Asignacion:      X = expr
 *  - Salida:          output A, B
 *  - Entrada:         input X   (con output previo si habia prompt)
 *  - Condicional:     if <c> then / else if <c> then / else / end if
 *  - Bucle pre-test:  loop while <c> ... end loop
 *  - Bucle post-test: loop ... until <c>
 *  - Bucle contado:   loop X from A to B [step S] ... end loop   (B inclusivo)
 *  - Recorrer:        loop X in ITER ... end loop
 *  - Subprograma:     function name(params) ... end function
 *  - Comparadores:    = ≠ < ≤ > ≥      Booleanos: AND OR NOT      div / mod
 *  - Collections:     COL.addItem(x), COL.getNext(), COL.hasNext(), ...
 */

const INDENT = "    ";

function pad(level) {
  return INDENT.repeat(level);
}

const PREC = {
  or: 1,
  and: 2,
  not: 3,
  compare: 4,
  add: 5,
  mul: 6,
  unary: 7,
  power: 8,
  atom: 10,
};

function precOf(node) {
  switch (node.type) {
    case "BoolOp":
      return node.op === "or" ? PREC.or : PREC.and;
    case "Compare":
      return PREC.compare;
    case "UnaryOp":
      return node.op === "not" ? PREC.not : PREC.unary;
    case "BinOp":
      if (node.op === "+" || node.op === "-") return PREC.add;
      if (node.op === "**") return PREC.power;
      return PREC.mul;
    default:
      return PREC.atom;
  }
}

const COMPARE_MAP = { "==": "=", "!=": "≠", "<=": "≤", ">=": "≥", "<": "<", ">": ">" };
const BINOP_MAP = { "//": "div", "%": "mod", "**": "^" };

function wrap(code, node, parentPrec) {
  return precOf(node) < parentPrec ? `(${code})` : code;
}

function pseudoStr(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

export function exprToPseudo(node) {
  if (!node) return "";
  switch (node.type) {
    case "Num":
      return String(node.value);
    case "Str":
      return pseudoStr(node.value);
    case "Bool":
      return node.value ? "true" : "false";
    case "Name":
      return node.id;
    case "List":
      return `[${node.elts.map(exprToPseudo).join(", ")}]`;
    case "Subscript":
      return `${exprToPseudo(node.obj)}[${exprToPseudo(node.index)}]`;
    case "Attribute":
      return `${exprToPseudo(node.obj)}.${node.attr}`;
    case "Call":
      return `${exprToPseudo(node.func)}(${node.args.map(exprToPseudo).join(", ")})`;
    case "Input":
      return node.prompt ? `input(${exprToPseudo(node.prompt)})` : "input()";
    case "BinOp": {
      const p = precOf(node);
      const l = wrap(exprToPseudo(node.left), node.left, p);
      const r = wrap(exprToPseudo(node.right), node.right, p + 1);
      const op = BINOP_MAP[node.op] ?? node.op;
      return `${l} ${op} ${r}`;
    }
    case "Compare": {
      const p = precOf(node);
      const l = wrap(exprToPseudo(node.left), node.left, p + 1);
      const r = wrap(exprToPseudo(node.right), node.right, p + 1);
      return `${l} ${COMPARE_MAP[node.op] ?? node.op} ${r}`;
    }
    case "BoolOp": {
      const p = precOf(node);
      const kw = node.op === "or" ? "OR" : "AND";
      return node.values.map((v) => wrap(exprToPseudo(v), v, p + 1)).join(` ${kw} `);
    }
    case "UnaryOp": {
      if (node.op === "not")
        return `NOT ${wrap(exprToPseudo(node.operand), node.operand, PREC.not)}`;
      return `-${wrap(exprToPseudo(node.operand), node.operand, PREC.unary)}`;
    }
    default:
      return "";
  }
}

// B inclusivo para un range: dado el "stop" exclusivo de Python, resta 1.
function minusOne(node) {
  if (node.type === "Num" && typeof node.value === "number") {
    return { type: "Num", value: node.value - 1 };
  }
  return { type: "BinOp", op: "-", left: node, right: { type: "Num", value: 1 } };
}

function forRangeHeader(node) {
  const args = node.rangeArgs;
  let start;
  let stopExclusive;
  let step = null;
  if (args.length === 1) {
    start = { type: "Num", value: 0 };
    stopExclusive = args[0];
  } else {
    start = args[0];
    stopExclusive = args[1];
    step = args[2] ?? null;
  }
  let header = `loop ${node.varName} from ${exprToPseudo(start)} to ${exprToPseudo(minusOne(stopExclusive))}`;
  if (step) header += ` step ${exprToPseudo(step)}`;
  return header;
}

function stmtToPseudo(node, level, out) {
  const ind = pad(level);
  switch (node.type) {
    case "Assign":
      // input X   (si el valor es una entrada)
      if (node.value.type === "Input") {
        if (node.value.prompt) out.push(`${ind}output ${exprToPseudo(node.value.prompt)}`);
        out.push(`${ind}input ${exprToPseudo(node.target)}`);
      } else {
        out.push(`${ind}${exprToPseudo(node.target)} = ${exprToPseudo(node.value)}`);
      }
      break;
    case "AugAssign":
      out.push(
        `${ind}${exprToPseudo(node.target)} = ${exprToPseudo(node.target)} ${BINOP_MAP[node.op] ?? node.op} ${exprToPseudo(node.value)}`,
      );
      break;
    case "Output":
      out.push(`${ind}output ${node.args.map(exprToPseudo).join(", ")}`);
      break;
    case "ExprStmt":
      out.push(`${ind}${exprToPseudo(node.expr)}`);
      break;
    case "Return":
      out.push(`${ind}return${node.value ? " " + exprToPseudo(node.value) : ""}`);
      break;
    case "Break":
      out.push(`${ind}break`);
      break;
    case "Continue":
      out.push(`${ind}continue`);
      break;
    case "If":
      out.push(`${ind}if ${exprToPseudo(node.test)} then`);
      blockToPseudo(node.body, level + 1, out);
      writeOrelse(node.orelse, level, out);
      out.push(`${ind}end if`);
      break;
    case "While":
      out.push(`${ind}loop while ${exprToPseudo(node.test)}`);
      blockToPseudo(node.body, level + 1, out);
      out.push(`${ind}end loop`);
      break;
    case "Until":
      out.push(`${ind}loop`);
      blockToPseudo(node.body, level + 1, out);
      out.push(`${ind}until ${exprToPseudo(node.test)}`);
      break;
    case "ForRange":
      out.push(`${ind}${forRangeHeader(node)}`);
      blockToPseudo(node.body, level + 1, out);
      out.push(`${ind}end loop`);
      break;
    case "ForEach":
      out.push(`${ind}loop ${node.varName} in ${exprToPseudo(node.iter)}`);
      blockToPseudo(node.body, level + 1, out);
      out.push(`${ind}end loop`);
      break;
    case "FuncDef":
      out.push(`${ind}function ${node.name}(${node.params.join(", ")})`);
      blockToPseudo(node.body, level + 1, out);
      out.push(`${ind}end function`);
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
  if (orelse.length === 1 && orelse[0].type === "If") {
    const elifNode = orelse[0];
    out.push(`${ind}else if ${exprToPseudo(elifNode.test)} then`);
    blockToPseudo(elifNode.body, level + 1, out);
    writeOrelse(elifNode.orelse, level, out);
    return;
  }
  out.push(`${ind}else`);
  blockToPseudo(orelse, level + 1, out);
}

function blockToPseudo(body, level, out) {
  if (!body || body.length === 0) return;
  for (const stmt of body) stmtToPseudo(stmt, level, out);
}

/**
 * @param {{type:'Program', body:Array}} ast
 * @returns {string}
 */
export function astToPseudocode(ast) {
  if (!ast || !ast.body) return "";
  const out = [];
  for (const stmt of ast.body) stmtToPseudo(stmt, 0, out);
  return out.join("\n");
}
