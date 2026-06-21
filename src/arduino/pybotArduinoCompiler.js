/**
 * Compilador PyBot (subset de Python) -> bytecode para el firmware VM de Arduino.
 *
 * Permite "Bajar a Arduino": el programa del alumno se traduce a bytecode y se
 * graba en la placa para que corra SOLA (desconectada de la PC). El firmware
 * VM (firmware/pybot-arduino-vm) ejecuta este bytecode.
 *
 * NO toca el modo "en vivo" (Firmata + Pyodide), que sigue igual.
 *
 * Subset soportado:
 *   - variables enteras (int16), asignación = y += -= *= //= %=
 *   - if / elif / else, while (incl. while True), for i in range(a[,b[,c]])
 *   - aritmética + - * // %, comparaciones, and / or / not, paréntesis
 *   - pin("out"/"in"/"pwm", n, v), servo(p, ang), motor(p, vel), wait(seg), print(...)
 *   - A0..A5 como lectura analógica (igual que Arduino en vivo)
 *
 * Lo no soportado produce un error educativo con número de línea.
 *
 * Formato de imagen (lo que se graba en EEPROM):
 *   [0..1]  magic 'P','B'
 *   [2]     version (1)
 *   [3]     varCount
 *   [4..5]  constSectionLen (LE)
 *   [6..7]  codeLen (LE)
 *   [8..]   const section: por cada string -> (len:1, bytes...)
 *   [...]   code bytes (codeLen)
 */

export const OP = {
  PUSH_I16: 0x01,
  LOAD: 0x02,
  STORE: 0x03,
  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  NEG: 0x15,
  EQ: 0x20,
  NE: 0x21,
  LT: 0x22,
  LE: 0x23,
  GT: 0x24,
  GE: 0x25,
  AND: 0x30,
  OR: 0x31,
  NOT: 0x32,
  JMP: 0x40,
  JMP_IF_FALSE: 0x41,
  DIGITAL_WRITE: 0x50,
  PWM_WRITE: 0x51,
  DIGITAL_READ: 0x52,
  ANALOG_READ: 0x53,
  SERVO_WRITE: 0x54,
  MOTOR_WRITE: 0x55,
  WAIT_MS: 0x56,
  PRINT_STR: 0x60,
  PRINT_INT: 0x61,
  PRINT_NL: 0x62,
  PRINT_SP: 0x63,
  HALT: 0xff,
};

export const LIMITS = {
  MAX_VARS: 32,
  MAX_CONSTS: 24,
  MAX_CODE: 700,
  MAX_IMAGE: 768, // debe coincidir con MAX_IMAGE del firmware VM
};

const KEYWORDS = new Set([
  "if", "elif", "else", "while", "for", "in", "range",
  "and", "or", "not", "True", "False", "pass",
]);

function err(line, es, en) {
  return { line: line ?? 0, es, en };
}

class CompileError {
  constructor(e) {
    this.info = e;
  }
}

// ---------- Tokenizer con indentación ----------

function tokenize(source) {
  const rawLines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const tokens = [];
  const indents = [0];
  let lineNo = 0;

  for (const raw of rawLines) {
    lineNo++;
    // quitar comentarios (no soportamos # dentro de strings de forma sofisticada;
    // los programas del alumno no usan '#' dentro de texto en general)
    let line = raw;
    const stripped = line.replace(/[ \t]+$/g, "");
    const noComment = stripComment(stripped);
    if (noComment.trim() === "") continue; // línea en blanco o solo comentario

    const indent = countIndent(noComment, lineNo);
    const content = noComment.slice(indent.chars);

    if (indent.width > indents[indents.length - 1]) {
      indents.push(indent.width);
      tokens.push({ t: "INDENT", line: lineNo });
    } else {
      while (indent.width < indents[indents.length - 1]) {
        indents.pop();
        tokens.push({ t: "DEDENT", line: lineNo });
      }
      if (indent.width !== indents[indents.length - 1]) {
        throw new CompileError(
          err(lineNo, "La sangría no coincide con la del bloque.", "Indentation does not match the block."),
        );
      }
    }

    tokenizeLine(content, lineNo, tokens);
    tokens.push({ t: "NEWLINE", line: lineNo });
  }

  while (indents.length > 1) {
    indents.pop();
    tokens.push({ t: "DEDENT", line: lineNo });
  }
  tokens.push({ t: "EOF", line: lineNo });
  return tokens;
}

function stripComment(line) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function countIndent(line, lineNo) {
  let chars = 0;
  let width = 0;
  for (const c of line) {
    if (c === " ") {
      width += 1;
      chars += 1;
    } else if (c === "\t") {
      width += 4;
      chars += 1;
    } else {
      break;
    }
  }
  return { chars, width, lineNo };
}

function tokenizeLine(content, lineNo, tokens) {
  let i = 0;
  const n = content.length;
  const push = (t, v) => tokens.push({ t, v, line: lineNo });

  while (i < n) {
    const c = content[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    // string
    if (c === '"' || c === "'") {
      const quote = c;
      let s = "";
      i++;
      while (i < n && content[i] !== quote) {
        if (content[i] === "\\") {
          const next = content[i + 1];
          if (next === "n") s += "\n";
          else if (next === "t") s += "\t";
          else if (next === "\\") s += "\\";
          else if (next === quote) s += quote;
          else s += next ?? "";
          i += 2;
          continue;
        }
        s += content[i];
        i++;
      }
      if (i >= n) {
        throw new CompileError(err(lineNo, "Falta cerrar la comilla del texto.", "Unterminated string literal."));
      }
      i++; // cierre
      push("STRING", s);
      continue;
    }
    // número
    if (c >= "0" && c <= "9") {
      let num = "";
      while (i < n && /[0-9.]/.test(content[i])) {
        num += content[i];
        i++;
      }
      push("NUMBER", num);
      continue;
    }
    // identificador / keyword
    if (/[A-Za-z_]/.test(c)) {
      let id = "";
      while (i < n && /[A-Za-z0-9_]/.test(content[i])) {
        id += content[i];
        i++;
      }
      push(KEYWORDS.has(id) ? "KW" : "NAME", id);
      continue;
    }
    // operadores de 2 chars
    const two = content.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "//", "+=", "-=", "*=", "and", "or"].includes(two)) {
      push("OP", two);
      i += 2;
      continue;
    }
    // operadores de 1 char
    if ("+-*/%<>()=:,".includes(c)) {
      if (c === "(") push("LPAREN", c);
      else if (c === ")") push("RPAREN", c);
      else if (c === ":") push("COLON", c);
      else if (c === ",") push("COMMA", c);
      else push("OP", c);
      i++;
      continue;
    }
    throw new CompileError(
      err(lineNo, `Carácter no soportado: "${c}".`, `Unsupported character: "${c}".`),
    );
  }
}

// ---------- Parser ----------

class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }
  peek(k = 0) {
    return this.toks[this.pos + k];
  }
  next() {
    return this.toks[this.pos++];
  }
  at(t, v) {
    const tok = this.peek();
    if (tok.t !== t) return false;
    if (v !== undefined && tok.v !== v) return false;
    return true;
  }
  expect(t, v) {
    const tok = this.peek();
    if (tok.t !== t || (v !== undefined && tok.v !== v)) {
      throw new CompileError(
        err(tok.line, `Se esperaba "${v ?? t}".`, `Expected "${v ?? t}".`),
      );
    }
    return this.next();
  }

  parseProgram() {
    const body = [];
    while (!this.at("EOF")) {
      if (this.at("NEWLINE")) {
        this.next();
        continue;
      }
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  parseBlock() {
    this.expect("COLON");
    this.expect("NEWLINE");
    this.expect("INDENT");
    const body = [];
    while (!this.at("DEDENT") && !this.at("EOF")) {
      if (this.at("NEWLINE")) {
        this.next();
        continue;
      }
      body.push(this.parseStatement());
    }
    this.expect("DEDENT");
    return body;
  }

  parseStatement() {
    const tok = this.peek();
    if (tok.t === "KW") {
      if (tok.v === "if") return this.parseIf();
      if (tok.v === "while") return this.parseWhile();
      if (tok.v === "for") return this.parseFor();
      if (tok.v === "pass") {
        this.next();
        this.expect("NEWLINE");
        return { type: "Pass" };
      }
      throw new CompileError(
        err(tok.line, `No se puede usar "${tok.v}" acá al bajar a Arduino.`, `"${tok.v}" is not allowed here when downloading to Arduino.`),
      );
    }
    // asignación o llamada
    if (tok.t === "NAME") {
      const nextTok = this.peek(1);
      if (nextTok && nextTok.t === "OP" && ["=", "+=", "-=", "*="].includes(nextTok.v)) {
        return this.parseAssign();
      }
    }
    const expr = this.parseExpr();
    this.expect("NEWLINE");
    return { type: "ExprStmt", expr, line: tok.line };
  }

  parseAssign() {
    const nameTok = this.expect("NAME");
    const opTok = this.next(); // = += -= *=
    const value = this.parseExpr();
    this.expect("NEWLINE");
    return { type: "Assign", name: nameTok.v, op: opTok.v, value, line: nameTok.line };
  }

  parseIf() {
    const tok = this.expect("KW", "if");
    const test = this.parseExpr();
    const body = this.parseBlock();
    const clauses = [{ test, body }];
    let orelse = [];
    while (this.at("KW", "elif")) {
      this.next();
      const t = this.parseExpr();
      const b = this.parseBlock();
      clauses.push({ test: t, body: b });
    }
    if (this.at("KW", "else")) {
      this.next();
      orelse = this.parseBlock();
    }
    return { type: "If", clauses, orelse, line: tok.line };
  }

  parseWhile() {
    const tok = this.expect("KW", "while");
    let test = null;
    if (this.at("KW", "True")) {
      this.next();
      test = { type: "True" };
    } else {
      test = this.parseExpr();
    }
    const body = this.parseBlock();
    return { type: "While", test, body, line: tok.line };
  }

  parseFor() {
    const tok = this.expect("KW", "for");
    const varTok = this.expect("NAME");
    this.expect("KW", "in");
    this.expect("KW", "range");
    this.expect("LPAREN");
    const args = [this.parseExpr()];
    while (this.at("COMMA")) {
      this.next();
      args.push(this.parseExpr());
    }
    this.expect("RPAREN");
    if (args.length < 1 || args.length > 3) {
      throw new CompileError(err(tok.line, "range() admite 1 a 3 argumentos.", "range() takes 1 to 3 arguments."));
    }
    const body = this.parseBlock();
    return { type: "For", varName: varTok.v, args, body, line: tok.line };
  }

  // precedencia: or < and < not < comparación < add < mul < unario < atom
  parseExpr() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while ((this.at("OP", "or")) || this.at("KW", "or")) {
      this.next();
      const right = this.parseAnd();
      left = { type: "Bin", op: "or", left, right };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.at("OP", "and") || this.at("KW", "and")) {
      this.next();
      const right = this.parseNot();
      left = { type: "Bin", op: "and", left, right };
    }
    return left;
  }
  parseNot() {
    if (this.at("KW", "not")) {
      this.next();
      const operand = this.parseNot();
      return { type: "Unary", op: "not", operand };
    }
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parseAdd();
    while (this.at("OP") && ["==", "!=", "<", "<=", ">", ">="].includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseAdd();
      left = { type: "Bin", op, left, right };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.at("OP") && ["+", "-"].includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseMul();
      left = { type: "Bin", op, left, right };
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (this.at("OP") && ["*", "//", "/", "%"].includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseUnary();
      left = { type: "Bin", op, left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.at("OP", "-")) {
      this.next();
      const operand = this.parseUnary();
      return { type: "Unary", op: "neg", operand };
    }
    if (this.at("OP", "+")) {
      this.next();
      return this.parseUnary();
    }
    return this.parseAtom();
  }
  parseAtom() {
    const tok = this.peek();
    if (tok.t === "NUMBER") {
      this.next();
      return { type: "Num", raw: tok.v, line: tok.line };
    }
    if (tok.t === "STRING") {
      this.next();
      return { type: "Str", value: tok.v, line: tok.line };
    }
    if (tok.t === "KW" && (tok.v === "True" || tok.v === "False")) {
      this.next();
      return { type: "Num", raw: tok.v === "True" ? "1" : "0", line: tok.line };
    }
    if (tok.t === "LPAREN") {
      this.next();
      const e = this.parseExpr();
      this.expect("RPAREN");
      return e;
    }
    if (tok.t === "NAME") {
      this.next();
      if (this.at("LPAREN")) {
        this.next();
        const args = [];
        if (!this.at("RPAREN")) {
          args.push(this.parseExpr());
          while (this.at("COMMA")) {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.expect("RPAREN");
        return { type: "Call", name: tok.v, args, line: tok.line };
      }
      return { type: "Var", name: tok.v, line: tok.line };
    }
    throw new CompileError(
      err(tok.line, "Expresión inválida.", "Invalid expression."),
    );
  }
}

// ---------- Generador de código ----------

class CodeGen {
  constructor() {
    this.code = [];
    this.vars = new Map();
    this.consts = [];
    this.constMap = new Map();
  }

  varSlot(name, line) {
    if (!this.vars.has(name)) {
      if (this.vars.size >= LIMITS.MAX_VARS) {
        throw new CompileError(err(line, "Demasiadas variables para bajar al Arduino.", "Too many variables to download to Arduino."));
      }
      this.vars.set(name, this.vars.size);
    }
    return this.vars.get(name);
  }

  constIndex(str, line) {
    if (this.constMap.has(str)) return this.constMap.get(str);
    if (this.consts.length >= LIMITS.MAX_CONSTS) {
      throw new CompileError(err(line, "Demasiados textos para bajar al Arduino.", "Too many text strings to download to Arduino."));
    }
    const idx = this.consts.length;
    this.consts.push(str);
    this.constMap.set(str, idx);
    return idx;
  }

  emit(byte) {
    this.code.push(byte & 0xff);
  }
  emitI16(v) {
    const x = v & 0xffff;
    this.code.push(x & 0xff, (x >> 8) & 0xff);
  }
  here() {
    return this.code.length;
  }
  emitJump(op) {
    this.emit(op);
    const at = this.code.length;
    this.code.push(0, 0); // placeholder addr
    return at;
  }
  patch(at, target) {
    this.code[at] = target & 0xff;
    this.code[at + 1] = (target >> 8) & 0xff;
  }

  genBlock(stmts) {
    for (const s of stmts) this.genStmt(s);
  }

  genStmt(s) {
    switch (s.type) {
      case "Pass":
        return;
      case "Assign":
        return this.genAssign(s);
      case "ExprStmt":
        this.genExprAsStatement(s.expr);
        return;
      case "If":
        return this.genIf(s);
      case "While":
        return this.genWhile(s);
      case "For":
        return this.genFor(s);
      default:
        throw new CompileError(err(s.line, "Instrucción no soportada al bajar a Arduino.", "Statement not supported when downloading to Arduino."));
    }
  }

  genAssign(s) {
    const slot = this.varSlot(s.name, s.line);
    if (s.op === "=") {
      this.genExpr(s.value);
    } else {
      this.emit(OP.LOAD);
      this.emit(slot);
      this.genExpr(s.value);
      if (s.op === "+=") this.emit(OP.ADD);
      else if (s.op === "-=") this.emit(OP.SUB);
      else if (s.op === "*=") this.emit(OP.MUL);
    }
    this.emit(OP.STORE);
    this.emit(slot);
  }

  genIf(s) {
    const endJumps = [];
    for (let c = 0; c < s.clauses.length; c++) {
      const clause = s.clauses[c];
      this.genExpr(clause.test);
      const skip = this.emitJump(OP.JMP_IF_FALSE);
      this.genBlock(clause.body);
      endJumps.push(this.emitJump(OP.JMP));
      this.patch(skip, this.here());
    }
    this.genBlock(s.orelse);
    const end = this.here();
    for (const j of endJumps) this.patch(j, end);
  }

  genWhile(s) {
    const top = this.here();
    if (s.test.type === "True") {
      this.genBlock(s.body);
      const j = this.emitJump(OP.JMP);
      this.patch(j, top);
      return;
    }
    this.genExpr(s.test);
    const exit = this.emitJump(OP.JMP_IF_FALSE);
    this.genBlock(s.body);
    const back = this.emitJump(OP.JMP);
    this.patch(back, top);
    this.patch(exit, this.here());
  }

  genFor(s) {
    // i = start
    const slot = this.varSlot(s.varName, s.line);
    let start = "0";
    let stop;
    let step = 1;
    if (s.args.length === 1) {
      stop = s.args[0];
      start = { type: "Num", raw: "0" };
    } else {
      start = s.args[0];
      stop = s.args[1];
    }
    if (s.args.length === 3) {
      const stepNode = s.args[2];
      const lit = literalInt(stepNode);
      if (lit === null || lit === 0) {
        throw new CompileError(err(s.line, "El paso de range() debe ser un número entero distinto de 0.", "range() step must be a non-zero integer literal."));
      }
      step = lit;
    }
    // init
    this.genExpr(typeof start === "string" ? { type: "Num", raw: start } : start);
    this.emit(OP.STORE);
    this.emit(slot);
    // top: cond i<stop (step>0) o i>stop (step<0)
    const top = this.here();
    this.emit(OP.LOAD);
    this.emit(slot);
    this.genExpr(stop);
    this.emit(step > 0 ? OP.LT : OP.GT);
    const exit = this.emitJump(OP.JMP_IF_FALSE);
    this.genBlock(s.body);
    // i += step
    this.emit(OP.LOAD);
    this.emit(slot);
    this.emitPushInt(step);
    this.emit(OP.ADD);
    this.emit(OP.STORE);
    this.emit(slot);
    const back = this.emitJump(OP.JMP);
    this.patch(back, top);
    this.patch(exit, this.here());
  }

  genExprAsStatement(expr) {
    if (expr.type === "Call") {
      this.genCall(expr, true);
      return;
    }
    // expresión suelta sin efecto: la evaluamos y descartamos no es soportado;
    // permitimos solo llamadas como sentencia.
    throw new CompileError(err(expr.line, "Solo se permiten llamadas como instrucción (pin, servo, motor, wait, print).", "Only calls are allowed as a statement (pin, servo, motor, wait, print)."));
  }

  emitPushInt(v) {
    this.emit(OP.PUSH_I16);
    this.emitI16(v);
  }

  genExpr(node) {
    switch (node.type) {
      case "Num": {
        const v = parseNumberLiteral(node);
        this.emitPushInt(v);
        return;
      }
      case "Str":
        throw new CompileError(err(node.line, "No se puede usar texto en un cálculo al bajar a Arduino.", "Text cannot be used in a calculation when downloading to Arduino."));
      case "Var":
        this.emit(OP.LOAD);
        this.emit(this.varSlot(node.name, node.line));
        return;
      case "Unary":
        if (node.op === "neg") {
          this.genExpr(node.operand);
          this.emit(OP.NEG);
          return;
        }
        if (node.op === "not") {
          this.genExpr(node.operand);
          this.emit(OP.NOT);
          return;
        }
        break;
      case "Bin":
        return this.genBin(node);
      case "Call":
        return this.genCall(node, false);
      default:
        break;
    }
    throw new CompileError(err(node.line ?? 0, "Expresión no soportada.", "Unsupported expression."));
  }

  genBin(node) {
    this.genExpr(node.left);
    this.genExpr(node.right);
    const map = {
      "+": OP.ADD, "-": OP.SUB, "*": OP.MUL, "//": OP.DIV, "/": OP.DIV, "%": OP.MOD,
      "==": OP.EQ, "!=": OP.NE, "<": OP.LT, "<=": OP.LE, ">": OP.GT, ">=": OP.GE,
      and: OP.AND, or: OP.OR,
    };
    const op = map[node.op];
    if (op === undefined) {
      throw new CompileError(err(0, `Operador no soportado: ${node.op}`, `Unsupported operator: ${node.op}`));
    }
    this.emit(op);
  }

  genCall(node, asStatement) {
    const name = node.name;
    const a = node.args;
    if (name === "pin") return this.genPin(node, asStatement);
    if (name === "servo") return this.genServo(node, asStatement);
    if (name === "motor") return this.genMotor(node, asStatement);
    if (name === "wait") return this.genWait(node, asStatement);
    if (name === "print") return this.genPrint(node, asStatement);
    throw new CompileError(err(node.line, `La función "${name}" no se puede bajar al Arduino (probala en vivo).`, `Function "${name}" can't be downloaded to Arduino (try it live).`));
  }

  pinNumberFrom(node) {
    // Devuelve { kind: "digital"|"analog", pushPin?: fn } – maneja "A0".."A5".
    if (node.type === "Str") {
      const m = /^[Aa](\d)$/.exec(node.value.trim());
      if (m) {
        const ch = parseInt(m[1], 10);
        if (ch < 0 || ch > 5) {
          throw new CompileError(err(node.line, "Pin analógico inválido (A0–A5).", "Invalid analog pin (A0–A5)."));
        }
        return { analog: ch };
      }
      throw new CompileError(err(node.line, "Pin inválido. Usá un número (ej. 13) o A0–A5.", "Invalid pin. Use a number (e.g. 13) or A0–A5."));
    }
    return { exprNode: node };
  }

  genPin(node, asStatement) {
    const a = node.args;
    if (a.length < 2) {
      throw new CompileError(err(node.line, "pin() necesita modo y número de pin.", "pin() needs a mode and a pin number."));
    }
    const mode = a[0];
    if (mode.type !== "Str") {
      throw new CompileError(err(node.line, 'El primer argumento de pin() debe ser "in", "out" o "pwm".', 'The first pin() argument must be "in", "out" or "pwm".'));
    }
    const m = mode.value.toLowerCase().trim();
    const target = this.pinNumberFrom(a[1]);

    if (m === "in") {
      if (!asStatement) {
        if (target.analog !== undefined) {
          this.emitPushInt(target.analog);
          this.emit(OP.ANALOG_READ);
        } else {
          this.genExpr(target.exprNode);
          this.emit(OP.DIGITAL_READ);
        }
        return;
      }
      // como sentencia, una lectura sin asignar no hace nada útil
      throw new CompileError(err(node.line, 'pin("in", ...) se usa para leer; guardalo en una variable.', 'pin("in", ...) is used to read; store it in a variable.'));
    }

    // out / pwm -> escritura
    if (a.length < 3) {
      throw new CompileError(err(node.line, 'pin("out"/"pwm", n, valor) necesita el valor.', 'pin("out"/"pwm", n, value) needs the value.'));
    }
    if (target.analog !== undefined) {
      // escribir en pin analógico como digital (14+ch), igual que en vivo
      this.emitPushInt(14 + target.analog);
    } else {
      this.genExpr(target.exprNode);
    }
    const valNode = a[2];
    this.genExpr(valNode);
    if (m === "pwm") {
      this.emit(OP.PWM_WRITE);
    } else {
      const lit = literalInt(valNode);
      if (lit !== null && lit > 1) this.emit(OP.PWM_WRITE);
      else this.emit(OP.DIGITAL_WRITE);
    }
  }

  genServo(node, _asStatement) {
    const a = node.args;
    if (a.length !== 2) {
      throw new CompileError(err(node.line, "Al bajar a Arduino, servo(pin, ángulo) admite solo 2 valores (sin barrido).", "When downloading to Arduino, servo(pin, angle) takes only 2 values (no sweep)."));
    }
    this.genExpr(a[0]);
    this.genExpr(a[1]);
    this.emit(OP.SERVO_WRITE);
  }

  genMotor(node, _asStatement) {
    const a = node.args;
    if (a.length < 1 || a.length > 2) {
      throw new CompileError(err(node.line, "motor(pin, velocidad) necesita 1 o 2 valores.", "motor(pin, speed) needs 1 or 2 values."));
    }
    this.genExpr(a[0]);
    if (a.length === 2) this.genExpr(a[1]);
    else this.emitPushInt(0);
    this.emit(OP.MOTOR_WRITE);
  }

  genWait(node, _asStatement) {
    const a = node.args;
    if (a.length !== 1) {
      throw new CompileError(err(node.line, "wait(segundos) necesita un valor.", "wait(seconds) needs one value."));
    }
    const lit = literalNumber(a[0]);
    if (lit !== null) {
      let ms = Math.round(lit * 1000);
      if (ms < 0) ms = 0;
      if (ms > 32767) ms = 32767;
      this.emitPushInt(ms);
    } else {
      // segundos enteros * 1000
      this.genExpr(a[0]);
      this.emitPushInt(1000);
      this.emit(OP.MUL);
    }
    this.emit(OP.WAIT_MS);
  }

  genPrint(node, _asStatement) {
    const a = node.args;
    for (let i = 0; i < a.length; i++) {
      if (i > 0) this.emit(OP.PRINT_SP);
      const arg = a[i];
      if (arg.type === "Str") {
        const idx = this.constIndex(arg.value, arg.line);
        this.emit(OP.PRINT_STR);
        this.emitI16(idx);
      } else {
        this.genExpr(arg);
        this.emit(OP.PRINT_INT);
      }
    }
    this.emit(OP.PRINT_NL);
  }
}

// ---------- helpers numéricos ----------

function literalNumber(node) {
  if (node.type === "Num") return parseFloat(node.raw);
  if (node.type === "Unary" && node.op === "neg") {
    const inner = literalNumber(node.operand);
    return inner === null ? null : -inner;
  }
  return null;
}

function literalInt(node) {
  const v = literalNumber(node);
  if (v === null) return null;
  if (!Number.isInteger(v)) return null;
  return v;
}

function parseNumberLiteral(node) {
  const v = parseFloat(node.raw);
  if (Number.isNaN(v)) {
    throw new CompileError(err(node.line, "Número inválido.", "Invalid number."));
  }
  // VM de enteros: truncamos floats (excepto wait que ya se maneja aparte)
  return Math.trunc(v);
}

// ---------- API pública ----------

/**
 * Compila el código del alumno a la imagen de bytecode para el firmware VM.
 * @param {string} source
 * @returns {{ ok: true, image: Uint8Array, code: Uint8Array, varCount: number, consts: string[] } | { ok: false, error: { line: number, es: string, en: string } }}
 */
export function compileToBytecode(source) {
  try {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();
    const gen = new CodeGen();
    gen.genBlock(ast.body);
    gen.emit(OP.HALT);

    if (gen.code.length > LIMITS.MAX_CODE) {
      return { ok: false, error: err(0, "El programa es demasiado grande para el Arduino.", "The program is too large for the Arduino.") };
    }

    const image = buildImage(gen);
    if (image.length > LIMITS.MAX_IMAGE) {
      return { ok: false, error: err(0, "El programa es demasiado grande para el Arduino.", "The program is too large for the Arduino.") };
    }

    return {
      ok: true,
      image,
      code: Uint8Array.from(gen.code),
      varCount: gen.vars.size,
      consts: gen.consts.slice(),
    };
  } catch (e) {
    if (e instanceof CompileError) {
      return { ok: false, error: e.info };
    }
    return { ok: false, error: err(0, "No se pudo preparar el programa para el Arduino.", "Could not prepare the program for the Arduino.") };
  }
}

function buildImage(gen) {
  const constBytes = [];
  for (const s of gen.consts) {
    const enc = new TextEncoder().encode(s);
    const len = Math.min(255, enc.length);
    constBytes.push(len);
    for (let i = 0; i < len; i++) constBytes.push(enc[i]);
  }
  const codeLen = gen.code.length;
  const header = [
    0x50, 0x42, // 'P','B'
    0x01, // version
    gen.vars.size & 0xff,
    constBytes.length & 0xff, (constBytes.length >> 8) & 0xff,
    codeLen & 0xff, (codeLen >> 8) & 0xff,
  ];
  return Uint8Array.from([...header, ...constBytes, ...gen.code]);
}
