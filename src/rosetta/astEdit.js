/**
 * Rosetta — Helpers para EDITAR el AST desde el editor de diagrama de flujo.
 *
 * El editor de flowchart es "estructurado": no se dibuja libre, se arma con
 * figuras (proceso, entrada, salida, decision, bucles, funcion) que se insertan
 * en la estructura. Cada figura es un nodo del AST, asi la conversion a Python,
 * pseudocodigo y bloques siempre queda limpia.
 *
 * Aca viven: las plantillas de nodos nuevos, el texto editable de cada figura,
 * y como volver a parsear ese texto a un nodo.
 */

import { S, E } from "./ast.js";
import { pythonToAst } from "./pythonParser.js";
import { exprToPython } from "./pythonGen.js";

// Tipos de figura que ofrece la paleta.
export const SHAPE_KINDS = [
  "process",
  "output",
  "input",
  "decision",
  "while",
  "for",
  "func",
];

// Metadatos de cada figura para la UI (icono/forma + etiqueta i18n key).
export const SHAPE_META = {
  process: { shape: "rect", key: "flowShapeProcess" },
  output: { shape: "io", key: "flowShapeOutput" },
  input: { shape: "io", key: "flowShapeInput" },
  decision: { shape: "diamond", key: "flowShapeDecision" },
  while: { shape: "diamond", key: "flowShapeWhile" },
  for: { shape: "diamond", key: "flowShapeFor" },
  func: { shape: "terminal", key: "flowShapeFunc" },
};

// Crea un nodo nuevo con valores por defecto editables.
export function makeNode(kind) {
  switch (kind) {
    case "process":
      return S.assign(E.name("x"), E.num(0));
    case "output":
      return S.output([E.str("Hola")]);
    case "input":
      return S.assign(E.name("dato"), E.input(E.str("Ingresá un dato: ")));
    case "decision":
      return S.ifStmt(E.compare("==", E.name("x"), E.num(0)), [], []);
    case "while":
      return S.whileStmt(E.compare("<", E.name("x"), E.num(10)), []);
    case "for":
      return S.forRange("i", [E.num(0), E.num(10)], []);
    case "func":
      return S.funcDef("miFuncion", [], []);
    default:
      return S.raw("");
  }
}

// Devuelve la "categoria" de figura de un nodo del AST (para icono/edicion).
export function nodeKind(stmt) {
  switch (stmt.type) {
    case "Assign":
      return stmt.value && stmt.value.type === "Input" ? "input" : "process";
    case "AugAssign":
    case "ExprStmt":
    case "Return":
    case "Break":
    case "Continue":
    case "Raw":
      return "process";
    case "Output":
      return "output";
    case "If":
      return "decision";
    case "While":
    case "Until":
      return "while";
    case "ForRange":
    case "ForEach":
      return "for";
    case "FuncDef":
      return "func";
    default:
      return "process";
  }
}

export function nodeShape(stmt) {
  return SHAPE_META[nodeKind(stmt)]?.shape ?? "rect";
}

// Texto editable que se muestra en la figura.
export function editableText(stmt) {
  switch (stmt.type) {
    case "Assign":
      if (stmt.value.type === "Input") {
        const p = stmt.value.prompt ? exprToPython(stmt.value.prompt) : "";
        return `${exprToPython(stmt.target)} = input(${p})`;
      }
      return `${exprToPython(stmt.target)} = ${exprToPython(stmt.value)}`;
    case "AugAssign":
      return `${exprToPython(stmt.target)} ${stmt.op}= ${exprToPython(stmt.value)}`;
    case "Output":
      return stmt.args.map(exprToPython).join(", ");
    case "ExprStmt":
      return exprToPython(stmt.expr);
    case "Return":
      return stmt.value ? `return ${exprToPython(stmt.value)}` : "return";
    case "Break":
      return "break";
    case "Continue":
      return "continue";
    case "If":
      return exprToPython(stmt.test);
    case "While":
      return exprToPython(stmt.test);
    case "Until":
      return exprToPython(stmt.test);
    case "ForRange":
      return `${stmt.varName} in range(${stmt.rangeArgs.map(exprToPython).join(", ")})`;
    case "ForEach":
      return `${stmt.varName} in ${exprToPython(stmt.iter)}`;
    case "FuncDef":
      return `${stmt.name}(${stmt.params.join(", ")})`;
    case "Raw":
      return stmt.text;
    default:
      return "";
  }
}

// Parsea una expresion suelta desde texto (para condiciones).
function parseExprText(text) {
  try {
    const prog = pythonToAst(`__rosetta__ = (${text})`);
    const first = prog.body[0];
    if (first && first.type === "Assign") return first.value;
  } catch {
    /* fallthrough */
  }
  return E.name(text.trim() || "True");
}

/**
 * Aplica el texto editado a un nodo. Devuelve un nodo nuevo (conservando los
 * cuerpos/ramas del original cuando corresponde). Nunca lanza.
 */
export function applyText(stmt, text) {
  const t = text.trim();
  try {
    switch (stmt.type) {
      case "Assign":
      case "AugAssign":
      case "ExprStmt":
      case "Return":
      case "Break":
      case "Continue":
      case "Raw": {
        const prog = pythonToAst(t || "pass");
        const node = prog.body[0];
        if (node && node.type !== "Raw") return node;
        return S.raw(t);
      }
      case "Output": {
        const prog = pythonToAst(`print(${t})`);
        const node = prog.body[0];
        if (node && node.type === "Output") return node;
        return S.output([E.str(t)]);
      }
      case "If":
        return { ...stmt, test: parseExprText(t) };
      case "While":
        return { ...stmt, test: parseExprText(t) };
      case "Until":
        return { ...stmt, test: parseExprText(t) };
      case "ForRange":
      case "ForEach": {
        const prog = pythonToAst(`for ${t}:\n    pass`);
        const node = prog.body[0];
        if (node && (node.type === "ForRange" || node.type === "ForEach")) {
          return { ...node, body: stmt.body };
        }
        return stmt;
      }
      case "FuncDef": {
        const prog = pythonToAst(`def ${t}:\n    pass`);
        const node = prog.body[0];
        if (node && node.type === "FuncDef") {
          return { ...node, body: stmt.body };
        }
        return stmt;
      }
      default:
        return stmt;
    }
  } catch {
    return stmt;
  }
}

// Listas de hijos editables de un nodo compuesto (para render recursivo).
// Devuelve [{ label, list }] donde list es el array real (mutable) del AST.
export function childLists(stmt, labels) {
  switch (stmt.type) {
    case "If":
      return [
        { label: labels.then, list: stmt.body, kind: "then" },
        { label: labels.else, list: stmt.orelse, kind: "else" },
      ];
    case "While":
    case "Until":
    case "ForRange":
    case "ForEach":
      return [{ label: labels.body, list: stmt.body, kind: "body" }];
    case "FuncDef":
      return [{ label: labels.body, list: stmt.body, kind: "body" }];
    default:
      return [];
  }
}
