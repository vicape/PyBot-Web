/**
 * Rosetta — AST comun (IR central).
 *
 * Este arbol es el "centro" del sistema de conversion entre representaciones:
 *
 *        Flowchart
 *            |
 *   Pseudo -- [ AST ] -- Python
 *            |
 *         PyBlock
 *
 * Cada superficie solo necesita: parsear a este AST (import) y generar desde
 * este AST (export). El AST cubre la interseccion "estructurada" que las cuatro
 * representaciones pueden expresar (secuencia, decision, iteracion, E/S, arrays,
 * funciones y las Collections del IB). No incluye construcciones exclusivas de
 * Python que no se pueden dibujar en un flowchart limpio (comprensiones,
 * lambdas, try/except, clases, decoradores).
 *
 * Convencion: cada nodo tiene un campo `type` (string discriminante).
 */

// ---------------------------------------------------------------------------
// Sentencias
// ---------------------------------------------------------------------------

export const S = {
  program: (body = []) => ({ type: "Program", body }),

  /** target = value  (target es Name | Subscript) */
  assign: (target, value) => ({ type: "Assign", target, value }),

  /** target op= value  (op: '+', '-', '*', '/') */
  augassign: (target, op, value) => ({ type: "AugAssign", target, op, value }),

  /** output arg1, arg2, ...  (viene de print(...)) */
  output: (args = []) => ({ type: "Output", args }),

  /**
   * Sentencia que es solo una expresion (por ej. una llamada a funcion/metodo
   * cuyo resultado se descarta: miColeccion.addItem(x), saludar()).
   */
  exprStmt: (expr) => ({ type: "ExprStmt", expr }),

  /** if test: body [elif/else en orelse] */
  ifStmt: (test, body = [], orelse = []) => ({ type: "If", test, body, orelse }),

  /** while test: body  (loop while) */
  whileStmt: (test, body = []) => ({ type: "While", test, body }),

  /**
   * loop until test: body  (post-test). Semanticamente: se ejecuta el cuerpo y
   * se repite HASTA que test sea verdadero.
   */
  untilStmt: (test, body = []) => ({ type: "Until", test, body }),

  /**
   * loop VAR from A to B [step]  (bucle contado / for sobre range()).
   * Guardamos los argumentos crudos de range() (1, 2 o 3 expresiones) para que
   * el round-trip a Python sea exacto. El pseudo/flowchart calculan el rango
   * inclusivo (from A to B-1) para mostrarlo estilo IB.
   *   range(n)        -> [n]
   *   range(a, b)     -> [a, b]
   *   range(a, b, s)  -> [a, b, s]
   */
  forRange: (varName, rangeArgs = [], body = []) => ({
    type: "ForRange",
    varName,
    rangeArgs,
    body,
  }),

  /** for VAR in iterable: body  (recorrer una lista/coleccion) */
  forEach: (varName, iter, body = []) => ({ type: "ForEach", varName, iter, body }),

  /** def name(params): body */
  funcDef: (name, params = [], body = []) => ({ type: "FuncDef", name, params, body }),

  /** return [value] */
  returnStmt: (value = null) => ({ type: "Return", value }),

  breakStmt: () => ({ type: "Break" }),
  continueStmt: () => ({ type: "Continue" }),

  /** Linea que no pudimos mapear al subconjunto: se conserva textual. */
  raw: (text) => ({ type: "Raw", text }),
};

// ---------------------------------------------------------------------------
// Expresiones
// ---------------------------------------------------------------------------

export const E = {
  num: (value) => ({ type: "Num", value }),
  /** prefix conserva f/r/b de Python para round-trip (f-strings). */
  str: (value, prefix = "") => ({ type: "Str", value, prefix }),
  bool: (value) => ({ type: "Bool", value }),
  name: (id) => ({ type: "Name", id }),
  list: (elts = []) => ({ type: "List", elts }),

  /** obj[index] */
  subscript: (obj, index) => ({ type: "Subscript", obj, index }),

  /** obj.attr  (para metodos de Collection: col.getNext) */
  attribute: (obj, attr) => ({ type: "Attribute", obj, attr }),

  /** func(args...)  func es Name | Attribute */
  call: (func, args = []) => ({ type: "Call", func, args }),

  /** input(prompt)  -> se representa aparte para que el pseudo use `input` */
  input: (prompt = null) => ({ type: "Input", prompt }),

  /** left op right  (op aritmetico: + - * / div mod) */
  binop: (op, left, right) => ({ type: "BinOp", op, left, right }),

  /** left op right  (op de comparacion: = != < <= > >=) */
  compare: (op, left, right) => ({ type: "Compare", op, left, right }),

  /** op de union booleana: 'and' | 'or' con lista de operandos */
  boolop: (op, values = []) => ({ type: "BoolOp", op, values }),

  /** not x | -x */
  unaryop: (op, operand) => ({ type: "UnaryOp", op, operand }),
};

// Nombres de metodos de Collection del IB que reconocemos especialmente.
export const COLLECTION_METHODS = new Set([
  "addItem",
  "getNext",
  "resetNext",
  "hasNext",
  "isEmpty",
]);

// Utilidad: recorre el AST aplicando fn a cada nodo (pre-order).
export function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) walk(child, fn);
    } else if (val && typeof val === "object" && typeof val.type === "string") {
      walk(val, fn);
    }
  }
}
