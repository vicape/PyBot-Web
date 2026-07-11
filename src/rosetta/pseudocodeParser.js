/**
 * Rosetta — Parser de Pseudocodigo IB -> AST comun.
 *
 * A diferencia del parser de Python (que usa indentacion), aca la estructura
 * viene dada por palabras clave delimitadoras: `then`, `else`, `end if`,
 * `end loop`, `until`, `end function`. Eso lo hace robusto a la indentacion.
 *
 * Nunca lanza: lo que no reconoce queda como nodo Raw.
 */

import { S, E } from "./ast.js";

// Operadores de comparacion pseudo -> python.
const CMP_TO_PY = {
  "=": "==",
  "==": "==",
  "≠": "!=",
  "!=": "!=",
  "≤": "<=",
  "<=": "<=",
  "≥": ">=",
  ">=": ">=",
  "<": "<",
  ">": ">",
};

// Palabras clave (estructura + operadores textuales).
const STRUCT_KW = new Set([
  "if",
  "then",
  "else",
  "end",
  "loop",
  "while",
  "until",
  "from",
  "to",
  "step",
  "in",
  "function",
  "method",
  "return",
  "break",
  "continue",
  "output",
  "input",
]);
const WORD_OPS = new Set(["and", "or", "not", "div", "mod", "true", "false"]);

function tokenizeLine(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "#") break;
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < n) {
        if (line[j] === "\\" && j + 1 < n) {
          const map = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' };
          value += map[line[j + 1]] ?? line[j + 1];
          j += 2;
          continue;
        }
        if (line[j] === quote) break;
        value += line[j];
        j++;
      }
      tokens.push({ kind: "str", value });
      i = j + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      let dot = false;
      while (j < n && ((line[j] >= "0" && line[j] <= "9") || (line[j] === "." && !dot))) {
        if (line[j] === ".") dot = true;
        j++;
      }
      tokens.push({ kind: "num", value: line.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const lower = word.toLowerCase();
      if (STRUCT_KW.has(lower) || WORD_OPS.has(lower)) {
        tokens.push({ kind: "kw", value: lower, orig: word });
      } else {
        tokens.push({ kind: "name", value: word });
      }
      i = j;
      continue;
    }
    // simbolos unicode de comparacion
    if (c === "≠" || c === "≤" || c === "≥") {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "**"].includes(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%()[],:.<>=^".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    tokens.push({ kind: "op", value: c });
    i++;
  }
  return tokens;
}

function lineMarker(tokens) {
  if (!tokens.length) return "";
  const w1 = tokens[0].kind === "kw" ? tokens[0].value : null;
  const w2 = tokens[1] && tokens[1].kind === "kw" ? tokens[1].value : null;
  if (w1 === "end") return "end " + (w2 ?? "");
  if (w1 === "else" && w2 === "if") return "else if";
  if (w1 === "else") return "else";
  if (w1 === "until") return "until";
  return w1 ?? "";
}

class Parser {
  constructor(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    this.lines = [];
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      this.lines.push({ tokens: tokenizeLine(trimmed), raw: trimmed });
    }
    this.pos = 0;
  }

  peek() {
    return this.pos < this.lines.length ? this.lines[this.pos] : null;
  }

  markerAt() {
    const line = this.peek();
    return line ? lineMarker(line.tokens) : null;
  }

  parseProgram() {
    return S.program(this.parseStatements(new Set()));
  }

  parseStatements(stopSet) {
    const body = [];
    while (this.pos < this.lines.length) {
      const marker = this.markerAt();
      if (stopSet.has(marker)) break;
      body.push(this.parseStatement());
    }
    return body;
  }

  parseStatement() {
    const line = this.lines[this.pos];
    const marker = lineMarker(line.tokens);
    switch (marker) {
      case "if":
        return this.parseIf();
      case "loop":
        return this.parseLoop();
      case "while":
        return this.parseWhileBare();
      case "function":
      case "method":
        return this.parseFunction();
      case "output":
        return this.parseOutput();
      case "input":
        return this.parseInput();
      case "return": {
        this.pos++;
        const ts = new TS(line.tokens);
        ts.next(); // return
        const value = ts.atEnd() ? null : ts.parseExpression();
        return S.returnStmt(value);
      }
      case "break":
        this.pos++;
        return S.breakStmt();
      case "continue":
        this.pos++;
        return S.continueStmt();
      default:
        this.pos++;
        return this.parseSimple(line);
    }
  }

  parseSimple(line) {
    try {
      const split = findAssign(line.tokens);
      if (split) {
        const target = new TS(line.tokens.slice(0, split.index)).parseExpression();
        const value = new TS(line.tokens.slice(split.index + 1)).parseExpression();
        if (split.op === "=") return S.assign(target, value);
        return S.augassign(target, split.op[0], value);
      }
      const expr = new TS(line.tokens).parseExpression();
      return S.exprStmt(expr);
    } catch {
      return S.raw(line.raw);
    }
  }

  parseOutput() {
    const line = this.lines[this.pos];
    this.pos++;
    const rest = line.tokens.slice(1);
    const args = splitTopLevelCommas(rest).map((toks) => new TS(toks).parseExpression());
    return S.output(args);
  }

  parseInput() {
    const line = this.lines[this.pos];
    this.pos++;
    const ts = new TS(line.tokens.slice(1));
    const target = ts.parseExpression();
    return S.assign(target, E.input(null));
  }

  parseIf() {
    const line = this.lines[this.pos];
    this.pos++;
    const ts = new TS(line.tokens);
    ts.next(); // if
    const test = ts.parseExpressionUntil("then");
    const stops = new Set(["else", "else if", "end if", "end "]);
    const body = this.parseStatements(stops);
    let orelse = [];
    if (this.markerAt() === "else if") {
      orelse = [this.parseElseIf()];
    } else if (this.markerAt() === "else") {
      this.pos++;
      orelse = this.parseStatements(new Set(["end if", "end "]));
    }
    // consumir end if / end
    if (this.markerAt() === "end if" || this.markerAt() === "end ") this.pos++;
    return S.ifStmt(test, body, orelse);
  }

  parseElseIf() {
    const line = this.lines[this.pos];
    this.pos++;
    const ts = new TS(line.tokens);
    ts.next(); // else
    ts.next(); // if
    const test = ts.parseExpressionUntil("then");
    const body = this.parseStatements(new Set(["else", "else if", "end if", "end "]));
    let orelse = [];
    if (this.markerAt() === "else if") {
      orelse = [this.parseElseIf()];
    } else if (this.markerAt() === "else") {
      this.pos++;
      orelse = this.parseStatements(new Set(["end if", "end "]));
    }
    return S.ifStmt(test, body, orelse);
  }

  parseLoop() {
    const line = this.lines[this.pos];
    this.pos++;
    const toks = line.tokens.slice(1); // sin 'loop'
    const second = toks[0];

    // loop while <cond>
    if (second && second.kind === "kw" && second.value === "while") {
      const test = new TS(toks.slice(1)).parseExpression();
      const body = this.parseStatements(new Set(["end loop", "end "]));
      if (this.markerAt() === "end loop" || this.markerAt() === "end ") this.pos++;
      return S.whileStmt(test, body);
    }

    // loop (post-test) ... until <cond>
    if (!second) {
      const body = this.parseStatements(new Set(["until", "end loop", "end "]));
      let test = E.bool(true);
      if (this.markerAt() === "until") {
        const untilLine = this.lines[this.pos];
        this.pos++;
        const uts = new TS(untilLine.tokens);
        uts.next(); // until
        test = uts.parseExpression();
      } else if (this.markerAt() === "end loop" || this.markerAt() === "end ") {
        this.pos++;
      }
      return S.untilStmt(test, body);
    }

    // loop VAR from A to B [step S]
    // loop VAR in ITER
    const varName = second.value;
    const ts = new TS(toks.slice(1));
    const kw = ts.peek();
    if (kw && kw.kind === "kw" && kw.value === "from") {
      ts.next(); // from
      const start = ts.parseExpressionUntil("to");
      const end = ts.parseExpressionUntil("step");
      let step = null;
      if (!ts.atEnd()) step = ts.parseExpression();
      const body = this.parseStatements(new Set(["end loop", "end "]));
      if (this.markerAt() === "end loop" || this.markerAt() === "end ") this.pos++;
      const rangeArgs = [start, plusOne(end)];
      if (step) rangeArgs.push(step);
      return S.forRange(varName, rangeArgs, body);
    }
    if (kw && kw.kind === "kw" && kw.value === "in") {
      ts.next(); // in
      const iter = ts.parseExpression();
      const body = this.parseStatements(new Set(["end loop", "end "]));
      if (this.markerAt() === "end loop" || this.markerAt() === "end ") this.pos++;
      return S.forEach(varName, iter, body);
    }

    // No reconocido: cuerpo generico como while true
    const body = this.parseStatements(new Set(["end loop", "end ", "until"]));
    if (this.markerAt() === "end loop" || this.markerAt() === "end " || this.markerAt() === "until")
      this.pos++;
    return S.whileStmt(E.bool(true), body);
  }

  parseWhileBare() {
    const line = this.lines[this.pos];
    this.pos++;
    const ts = new TS(line.tokens);
    ts.next(); // while
    const test = ts.parseExpression();
    const body = this.parseStatements(new Set(["end loop", "end while", "end "]));
    if (["end loop", "end while", "end "].includes(this.markerAt())) this.pos++;
    return S.whileStmt(test, body);
  }

  parseFunction() {
    const line = this.lines[this.pos];
    this.pos++;
    const ts = new TS(line.tokens);
    ts.next(); // function/method
    const nameTok = ts.next();
    const name = nameTok ? nameTok.value : "f";
    const params = [];
    if (ts.peek() && ts.peek().value === "(") {
      ts.next();
      while (ts.peek() && ts.peek().value !== ")") {
        const p = ts.next();
        if (p && (p.kind === "name" || p.kind === "kw")) params.push(p.orig ?? p.value);
        if (ts.peek() && ts.peek().value === ",") ts.next();
      }
    }
    const body = this.parseStatements(new Set(["end function", "end method", "end "]));
    if (["end function", "end method", "end "].includes(this.markerAt())) this.pos++;
    return S.funcDef(name, params, body);
  }
}

// B inclusivo -> stop exclusivo de range(): suma 1.
function plusOne(node) {
  if (node.type === "Num" && typeof node.value === "number") {
    return { type: "Num", value: node.value + 1 };
  }
  return { type: "BinOp", op: "+", left: node, right: { type: "Num", value: 1 } };
}

function findAssign(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "op") {
      if (t.value === "(" || t.value === "[") depth++;
      else if (t.value === ")" || t.value === "]") depth--;
      else if (depth === 0 && ["=", "+=", "-=", "*=", "/="].includes(t.value)) {
        return { index: i, op: t.value };
      }
    }
  }
  return null;
}

function splitTopLevelCommas(tokens) {
  const groups = [];
  let current = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === "op" && (t.value === "(" || t.value === "[")) depth++;
    if (t.kind === "op" && (t.value === ")" || t.value === "]")) depth--;
    if (t.kind === "op" && t.value === "," && depth === 0) {
      groups.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

// -------------------------- Expresiones -------------------------------------

class TS {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }
  peek() {
    return this.i < this.tokens.length ? this.tokens[this.i] : null;
  }
  next() {
    return this.i < this.tokens.length ? this.tokens[this.i++] : null;
  }
  atEnd() {
    return this.i >= this.tokens.length;
  }

  parseExpression() {
    return this.parseOr();
  }

  // Parsea hasta encontrar (y descartar) una keyword dada (then/to/step).
  parseExpressionUntil(kw) {
    // Si la keyword no esta, parsea normal.
    const expr = this.parseExpression();
    if (this.peek() && this.peek().kind === "kw" && this.peek().value === kw) this.next();
    return expr;
  }

  isKw(v) {
    const t = this.peek();
    return t && t.kind === "kw" && t.value === v;
  }

  parseOr() {
    let left = this.parseAnd();
    const values = [left];
    while (this.isKw("or")) {
      this.next();
      values.push(this.parseAnd());
    }
    return values.length > 1 ? E.boolop("or", values) : left;
  }

  parseAnd() {
    let left = this.parseNot();
    const values = [left];
    while (this.isKw("and")) {
      this.next();
      values.push(this.parseNot());
    }
    return values.length > 1 ? E.boolop("and", values) : left;
  }

  parseNot() {
    if (this.isKw("not")) {
      this.next();
      return E.unaryop("not", this.parseNot());
    }
    return this.parseComparison();
  }

  parseComparison() {
    const left = this.parseAdd();
    const t = this.peek();
    if (t && t.kind === "op" && CMP_TO_PY[t.value]) {
      this.next();
      const right = this.parseAdd();
      return E.compare(CMP_TO_PY[t.value], left, right);
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.peek() && this.peek().kind === "op" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      left = E.binop(op, left, this.parseMul());
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === "op" && ["*", "/", "%"].includes(t.value)) {
        this.next();
        left = E.binop(t.value, left, this.parseUnary());
      } else if (t && t.kind === "kw" && (t.value === "div" || t.value === "mod")) {
        this.next();
        left = E.binop(t.value === "div" ? "//" : "%", left, this.parseUnary());
      } else {
        break;
      }
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t && t.kind === "op" && t.value === "-") {
      this.next();
      return E.unaryop("-", this.parseUnary());
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t && t.kind === "op" && (t.value === "^" || t.value === "**")) {
      this.next();
      return E.binop("**", base, this.parseUnary());
    }
    return base;
  }

  parsePostfix() {
    let node = this.parseAtom();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.value === "(") {
        this.next();
        const args = [];
        while (this.peek() && this.peek().value !== ")") {
          args.push(this.parseExpression());
          if (this.peek() && this.peek().value === ",") this.next();
        }
        if (this.peek() && this.peek().value === ")") this.next();
        if (node.type === "Name" && node.id === "input") {
          node = E.input(args.length ? args[0] : null);
        } else {
          node = E.call(node, args);
        }
      } else if (t.value === "[") {
        this.next();
        const index = this.parseExpression();
        if (this.peek() && this.peek().value === "]") this.next();
        node = E.subscript(node, index);
      } else if (t.value === ".") {
        this.next();
        const attr = this.next();
        node = E.attribute(node, attr ? attr.orig ?? attr.value : "");
      } else {
        break;
      }
    }
    return node;
  }

  parseAtom() {
    const t = this.next();
    if (!t) throw new Error("expr vacia");
    if (t.kind === "num") {
      return E.num(String(t.value).includes(".") ? parseFloat(t.value) : parseInt(t.value, 10));
    }
    if (t.kind === "str") return E.str(t.value);
    if (t.kind === "kw") {
      if (t.value === "true") return E.bool(true);
      if (t.value === "false") return E.bool(false);
      if (t.value === "not") return E.unaryop("not", this.parseNot());
      if (t.value === "input") {
        // input como expresion: input(...) o input pelado
        if (this.peek() && this.peek().value === "(") {
          this.next();
          let prompt = null;
          if (this.peek() && this.peek().value !== ")") prompt = this.parseExpression();
          if (this.peek() && this.peek().value === ")") this.next();
          return E.input(prompt);
        }
        return E.input(null);
      }
      throw new Error("kw inesperada: " + t.value);
    }
    if (t.kind === "name") return E.name(t.value);
    if (t.value === "(") {
      const inner = this.parseExpression();
      if (this.peek() && this.peek().value === ")") this.next();
      return inner;
    }
    if (t.value === "[") {
      const elts = [];
      while (this.peek() && this.peek().value !== "]") {
        elts.push(this.parseExpression());
        if (this.peek() && this.peek().value === ",") this.next();
      }
      if (this.peek() && this.peek().value === "]") this.next();
      return E.list(elts);
    }
    throw new Error("token inesperado: " + t.value);
  }
}

/**
 * Convierte pseudocodigo IB en el AST comun. Nunca lanza.
 * @param {string} source
 * @returns {{type:'Program', body:Array}}
 */
export function pseudocodeToAst(source) {
  try {
    return new Parser(source ?? "").parseProgram();
  } catch {
    return S.program([S.raw(String(source ?? ""))]);
  }
}
