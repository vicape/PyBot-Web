/**
 * Rosetta — Parser de Python (subconjunto) -> AST comun.
 *
 * No es un parser completo de Python: cubre el subconjunto "estructurado" que
 * las cuatro representaciones comparten. Lo que no entra en el subconjunto se
 * conserva como nodo Raw (linea textual) para no perder informacion ni romper.
 *
 * Estrategia:
 *  1) Tokenizamos por linea (manejando strings para no confundir '#' de
 *     comentario dentro de un texto).
 *  2) Armamos una lista de lineas logicas con su indentacion.
 *  3) Descenso recursivo usando la indentacion para el anidamiento.
 */

import { S, E } from "./ast.js";

const KEYWORDS = new Set([
  "if",
  "elif",
  "else",
  "while",
  "for",
  "in",
  "def",
  "return",
  "True",
  "False",
  "None",
  "and",
  "or",
  "not",
  "break",
  "continue",
]);

// -------------------------- Tokenizer ---------------------------------------

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
    if (c === "#") break; // comentario hasta fin de linea
    // Strings
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < n) {
        if (line[j] === "\\" && j + 1 < n) {
          const nxt = line[j + 1];
          const map = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', r: "\r" };
          value += map[nxt] ?? nxt;
          j += 2;
          continue;
        }
        if (line[j] === quote) break;
        value += line[j];
        j++;
      }
      tokens.push({ kind: "str", value, quote });
      i = j + 1;
      continue;
    }
    // Numeros
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
    // Nombres / keywords (con soporte de prefijos de string: f"...", r'...', etc.)
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      // Prefijo de string pegado a una comilla -> es un string con prefijo.
      if (/^(?:[fFrRbB]|[fF][rR]|[rR][fF]|[bB][rR]|[rR][bB])$/.test(word) && (line[j] === '"' || line[j] === "'")) {
        const quote = line[j];
        let k = j + 1;
        let value = "";
        const isRaw = /[rR]/.test(word);
        while (k < n) {
          if (!isRaw && line[k] === "\\" && k + 1 < n) {
            const map = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', r: "\r" };
            value += map[line[k + 1]] ?? line[k + 1];
            k += 2;
            continue;
          }
          if (line[k] === quote) break;
          value += line[k];
          k++;
        }
        tokens.push({ kind: "str", value, quote, prefix: word.toLowerCase() });
        i = k + 1;
        continue;
      }
      tokens.push({ kind: KEYWORDS.has(word) ? "kw" : "name", value: word });
      i = j;
      continue;
    }
    // Operadores multi-caracter
    const two = line.slice(i, i + 2);
    if (["**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/="].includes(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    // Operadores / puntuacion de un caracter
    if ("+-*/%()[],:.<>=".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    // Caracter desconocido: lo tratamos como op suelto para no colgarnos.
    tokens.push({ kind: "op", value: c });
    i++;
  }
  return tokens;
}

function indentOf(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count += 1;
    else if (ch === "\t") count += 4;
    else break;
  }
  return count;
}

function isBlankOrComment(line) {
  const t = line.trim();
  return t === "" || t.startsWith("#");
}

// -------------------------- Parser ------------------------------------------

class Parser {
  constructor(source) {
    const physical = source.replace(/\r\n?/g, "\n").split("\n");
    this.lines = [];
    for (const raw of physical) {
      if (isBlankOrComment(raw)) continue;
      this.lines.push({ indent: indentOf(raw), tokens: tokenizeLine(raw), raw: raw.trim() });
    }
    this.pos = 0;
  }

  peekLine() {
    return this.pos < this.lines.length ? this.lines[this.pos] : null;
  }

  parseProgram() {
    const base = this.lines.length ? this.lines[0].indent : 0;
    return S.program(this.parseBlock(base));
  }

  // Parsea sentencias consecutivas con la indentacion dada.
  parseBlock(indent) {
    const body = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        // Indentacion inesperada: la guardamos textual y seguimos.
        body.push(S.raw(line.raw));
        this.pos++;
        continue;
      }
      body.push(this.parseStatement(indent));
    }
    return body;
  }

  // Cuerpo indentado de un bloque compuesto (header ya consumido).
  parseIndentedBody(headerIndent) {
    const next = this.peekLine();
    if (next && next.indent > headerIndent) {
      return this.parseBlock(next.indent);
    }
    return []; // cuerpo vacio (o mal indentado)
  }

  parseStatement(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    const first = t.peek();

    if (first && first.kind === "kw") {
      switch (first.value) {
        case "if":
          return this.parseIf(indent);
        case "while":
          return this.parseWhile(indent);
        case "for":
          return this.parseFor(indent);
        case "def":
          return this.parseDef(indent);
        case "return": {
          this.pos++;
          t.next();
          const value = t.atEnd() ? null : t.parseExpression();
          return S.returnStmt(value);
        }
        case "break":
          this.pos++;
          return S.breakStmt();
        case "continue":
          this.pos++;
          return S.continueStmt();
        default:
          break;
      }
    }

    // Sentencia simple (una linea): asignacion, aug-assign, print o expr.
    this.pos++;
    return this.parseSimpleStatement(t);
  }

  parseSimpleStatement(t) {
    try {
      const expr = t.parseExpression();
      const op = t.peek();
      if (op && op.kind === "op") {
        if (op.value === "=") {
          t.next();
          const value = t.parseExpression();
          return S.assign(expr, value);
        }
        if (["+=", "-=", "*=", "/="].includes(op.value)) {
          t.next();
          const value = t.parseExpression();
          return S.augassign(expr, op.value[0], value);
        }
      }
      // print(...) -> Output
      if (expr.type === "Call" && expr.func.type === "Name" && expr.func.id === "print") {
        return S.output(expr.args);
      }
      return S.exprStmt(expr);
    } catch {
      return S.raw(t.raw);
    }
  }

  parseIf(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    t.expectKw("if");
    const test = t.parseExpressionUntilColon();
    this.pos++;
    const body = this.parseIndentedBody(indent);
    let orelse = [];
    const next = this.peekLine();
    if (next && next.indent === indent) {
      const nt = new TokenStream(next.tokens, next.raw).peek();
      if (nt && nt.kind === "kw" && nt.value === "elif") {
        // elif -> If anidado dentro de orelse (reusamos parseIf tratando elif como if)
        orelse = [this.parseElif(indent)];
      } else if (nt && nt.kind === "kw" && nt.value === "else") {
        this.pos++;
        orelse = this.parseIndentedBody(indent);
      }
    }
    return S.ifStmt(test, body, orelse);
  }

  parseElif(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    t.expectKw("elif");
    const test = t.parseExpressionUntilColon();
    this.pos++;
    const body = this.parseIndentedBody(indent);
    let orelse = [];
    const next = this.peekLine();
    if (next && next.indent === indent) {
      const nt = new TokenStream(next.tokens, next.raw).peek();
      if (nt && nt.kind === "kw" && nt.value === "elif") {
        orelse = [this.parseElif(indent)];
      } else if (nt && nt.kind === "kw" && nt.value === "else") {
        this.pos++;
        orelse = this.parseIndentedBody(indent);
      }
    }
    return S.ifStmt(test, body, orelse);
  }

  parseWhile(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    t.expectKw("while");
    const test = t.parseExpressionUntilColon();
    this.pos++;
    const body = this.parseIndentedBody(indent);
    return S.whileStmt(test, body);
  }

  parseFor(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    t.expectKw("for");
    const varTok = t.next();
    const varName = varTok ? varTok.value : "i";
    t.expectKw("in");
    const iter = t.parseExpressionUntilColon();
    this.pos++;
    const body = this.parseIndentedBody(indent);
    // range(...) -> ForRange; si no, ForEach
    if (iter.type === "Call" && iter.func.type === "Name" && iter.func.id === "range") {
      return S.forRange(varName, iter.args, body);
    }
    return S.forEach(varName, iter, body);
  }

  parseDef(indent) {
    const line = this.lines[this.pos];
    const t = new TokenStream(line.tokens, line.raw);
    t.expectKw("def");
    const nameTok = t.next();
    const name = nameTok ? nameTok.value : "f";
    const params = [];
    if (t.peek() && t.peek().value === "(") {
      t.next();
      while (t.peek() && t.peek().value !== ")") {
        const p = t.next();
        if (p && (p.kind === "name" || p.kind === "kw")) params.push(p.value);
        if (t.peek() && t.peek().value === ",") t.next();
      }
      if (t.peek() && t.peek().value === ")") t.next();
    }
    this.pos++;
    const body = this.parseIndentedBody(indent);
    return S.funcDef(name, params, body);
  }
}

// -------------------------- Expresiones (Pratt) -----------------------------

class TokenStream {
  constructor(tokens, raw) {
    this.tokens = tokens;
    this.raw = raw;
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

  expectKw(word) {
    const tok = this.peek();
    if (tok && tok.kind === "kw" && tok.value === word) this.next();
  }

  parseExpression() {
    return this.parseOr();
  }

  // Parsea una expresion y descarta un ':' final (header de bloque).
  parseExpressionUntilColon() {
    const expr = this.parseExpression();
    if (this.peek() && this.peek().value === ":") this.next();
    return expr;
  }

  parseOr() {
    let left = this.parseAnd();
    const values = [left];
    while (this.peek() && this.peek().kind === "kw" && this.peek().value === "or") {
      this.next();
      values.push(this.parseAnd());
    }
    if (values.length > 1) return E.boolop("or", values);
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    const values = [left];
    while (this.peek() && this.peek().kind === "kw" && this.peek().value === "and") {
      this.next();
      values.push(this.parseNot());
    }
    if (values.length > 1) return E.boolop("and", values);
    return left;
  }

  parseNot() {
    if (this.peek() && this.peek().kind === "kw" && this.peek().value === "not") {
      this.next();
      return E.unaryop("not", this.parseNot());
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdd();
    const tok = this.peek();
    if (tok && tok.kind === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(tok.value)) {
      this.next();
      const right = this.parseAdd();
      return E.compare(tok.value, left, right);
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.peek() && this.peek().kind === "op" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseMul();
      left = E.binop(op, left, right);
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (
      this.peek() &&
      ((this.peek().kind === "op" && ["*", "/", "%", "//"].includes(this.peek().value)))
    ) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = E.binop(op, left, right);
    }
    return left;
  }

  parseUnary() {
    const tok = this.peek();
    if (tok && tok.kind === "op" && tok.value === "-") {
      this.next();
      return E.unaryop("-", this.parseUnary());
    }
    return this.parsePower();
  }

  parsePower() {
    let base = this.parsePostfix();
    if (this.peek() && this.peek().kind === "op" && this.peek().value === "**") {
      this.next();
      const exp = this.parseUnary();
      return E.binop("**", base, exp);
    }
    return base;
  }

  // Llamadas, indexado y atributos: f(...), a[i], obj.attr
  parsePostfix() {
    let node = this.parseAtom();
    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.value === "(") {
        this.next();
        const args = [];
        while (this.peek() && this.peek().value !== ")") {
          args.push(this.parseExpression());
          if (this.peek() && this.peek().value === ",") this.next();
        }
        if (this.peek() && this.peek().value === ")") this.next();
        // input(...) -> nodo Input dedicado
        if (node.type === "Name" && node.id === "input") {
          node = E.input(args.length ? args[0] : null);
        } else {
          node = E.call(node, args);
        }
      } else if (tok.value === "[") {
        this.next();
        const index = this.parseExpression();
        if (this.peek() && this.peek().value === "]") this.next();
        node = E.subscript(node, index);
      } else if (tok.value === ".") {
        this.next();
        const attr = this.next();
        node = E.attribute(node, attr ? attr.value : "");
      } else {
        break;
      }
    }
    return node;
  }

  parseAtom() {
    const tok = this.next();
    if (!tok) throw new Error("expr vacia");
    if (tok.kind === "num") {
      return E.num(tok.value.includes(".") ? parseFloat(tok.value) : parseInt(tok.value, 10));
    }
    if (tok.kind === "str") return E.str(tok.value, tok.prefix ?? "");
    if (tok.kind === "kw") {
      if (tok.value === "True") return E.bool(true);
      if (tok.value === "False") return E.bool(false);
      if (tok.value === "None") return E.name("None");
      if (tok.value === "not") return E.unaryop("not", this.parseNot());
      throw new Error("kw inesperado: " + tok.value);
    }
    if (tok.kind === "name") return E.name(tok.value);
    if (tok.value === "(") {
      const inner = this.parseExpression();
      if (this.peek() && this.peek().value === ")") this.next();
      return inner;
    }
    if (tok.value === "[") {
      const elts = [];
      while (this.peek() && this.peek().value !== "]") {
        elts.push(this.parseExpression());
        if (this.peek() && this.peek().value === ",") this.next();
      }
      if (this.peek() && this.peek().value === "]") this.next();
      return E.list(elts);
    }
    throw new Error("token inesperado: " + tok.value);
  }
}

/**
 * Convierte codigo Python (subconjunto) en el AST comun.
 * Nunca lanza: ante algo no soportado deja nodos Raw.
 * @param {string} source
 * @returns {{type:'Program', body:Array}}
 */
export function pythonToAst(source) {
  try {
    return new Parser(source ?? "").parseProgram();
  } catch {
    return S.program([S.raw(String(source ?? ""))]);
  }
}
