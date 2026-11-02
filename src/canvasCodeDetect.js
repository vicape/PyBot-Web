/**
 * Detecta llamadas a las funciones Canvas de PyBot, no métodos de objetos.
 * Una clase MicroPython como `lcd.texto(...)` o `def texto(...)` no es Canvas.
 * Ignora además comentarios y literales Python para no desviar el código al
 * intérprete del navegador ni impedir su grabación en una placa.
 */
const CANVAS_FN =
  "pantalla|fondo|dibujar_rect|dibujar_circulo|dibujar_linea|texto|actualizar|limpiar|tecla|" +
  "screen|fill|draw_rect|draw_circle|draw_line|draw_text|flip|clear|key_pressed";

const CANVAS_CALL_RE = new RegExp(`\\b(${CANVAS_FN})\\s*\\(`, "g");

/** Deja intactas las posiciones de código y oculta strings y comentarios. */
function maskPythonNonCode(source) {
  const code = String(source ?? "");
  let masked = "";
  let quote = null;
  let triple = false;
  for (let i = 0; i < code.length;) {
    const char = code[i];
    if (quote === null && char === "#") {
      while (i < code.length && code[i] !== "\n") {
        masked += " ";
        i++;
      }
      continue;
    }
    if (quote === null && (char === "'" || char === '"')) {
      quote = char;
      triple = code.startsWith(char.repeat(3), i);
      const count = triple ? 3 : 1;
      masked += " ".repeat(count);
      i += count;
      continue;
    }
    if (quote !== null) {
      if (char === "\\") {
        masked += " ";
        i++;
        if (i < code.length) {
          masked += code[i] === "\n" ? "\n" : " ";
          i++;
        }
        continue;
      }
      if (triple && code.startsWith(quote.repeat(3), i)) {
        masked += "   ";
        i += 3;
        quote = null;
        triple = false;
        continue;
      }
      if (!triple && char === quote) {
        masked += " ";
        i++;
        quote = null;
        continue;
      }
      if (!triple && char === "\n") quote = null;
      masked += char === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    masked += char;
    i++;
  }
  return masked;
}

/** @returns {boolean} si hay una llamada real a una función Canvas global. */
export function hasCanvasCode(source) {
  const code = maskPythonNonCode(source);
  // matchAll usa RegExp global sin modificar el estado compartido.
  for (const match of code.matchAll(CANVAS_CALL_RE)) {
    const start = match.index;
    let left = start - 1;
    while (left >= 0 && /[ \t]/.test(code[left])) left--;
    if (left >= 0 && code[left] === ".") continue;

    const lineStart = code.lastIndexOf("\n", start - 1) + 1;
    const before = code.slice(lineStart, start);
    // La definición de un método o función no es una llamada Canvas.
    if (/(?:^|\s)(?:async\s+)?def\s*$/.test(before)) continue;
    return true;
  }
  return false;
}
