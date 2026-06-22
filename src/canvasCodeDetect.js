/**
 * Detecta si el código usa funciones de Canvas/dibujo en pantalla.
 * Módulo aislado: usado para evitar enviar Canvas a placas (Arduino VM, ESP32, EDA6).
 */

const CANVAS_FN =
  "pantalla|fondo|dibujar_rect|dibujar_circulo|dibujar_linea|texto|actualizar|limpiar|tecla|" +
  "screen|fill|draw_rect|draw_circle|draw_line|draw_text|flip|clear|key_pressed";

const CANVAS_RE = new RegExp(`\\b(${CANVAS_FN})\\s*\\(`);

/**
 * @param {string} source
 * @returns {boolean}
 */
export function hasCanvasCode(source) {
  return CANVAS_RE.test(String(source ?? ""));
}
