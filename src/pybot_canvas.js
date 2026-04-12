/**
 * pybot_canvas — módulo gráfico ligero para PyBot Web.
 * Usa doble buffer para evitar parpadeo: se dibuja en un canvas oculto
 * y actualizar() copia el frame completo al canvas visible.
 */

const COLORES = {
  rojo: "#e74c3c", red: "#e74c3c",
  azul: "#3498db", blue: "#3498db",
  verde: "#2ecc71", green: "#2ecc71",
  amarillo: "#f1c40f", yellow: "#f1c40f",
  naranja: "#e67e22", orange: "#e67e22",
  violeta: "#9b59b6", purple: "#9b59b6",
  rosa: "#e91e90", pink: "#e91e90",
  blanco: "#ffffff", white: "#ffffff",
  negro: "#000000", black: "#000000",
  gris: "#95a5a6", gray: "#95a5a6", grey: "#95a5a6",
  celeste: "#56c5f2", cyan: "#00e5ff",
  marron: "#8b4513", brown: "#8b4513",
};

function resolveColor(c) {
  const key = String(c ?? "white").toLowerCase().trim();
  return COLORES[key] ?? key;
}

let _canvas = null;
let _visibleCtx = null;
let _buffer = null;
let _ctx = null;
let _onShow = null;

export function setCanvasHooks(onShow) {
  _onShow = onShow;
}

function ensureCanvas() {
  if (!_ctx) throw new Error("canvas_not_ready");
  return _ctx;
}

export function createCanvasModule() {
  return {
    pantalla: async (w, h) => {
      const width = Math.max(100, Math.min(800, Number(w) || 400));
      const height = Math.max(75, Math.min(600, Number(h) || 300));
      if (_onShow) {
        const el = await _onShow(width, height);
        if (el) {
          _canvas = el;
          _visibleCtx = el.getContext("2d");
        }
      }
      if (!_canvas) throw new Error("canvas_not_ready");
      _canvas.width = width;
      _canvas.height = height;
      _buffer = new OffscreenCanvas(width, height);
      _ctx = _buffer.getContext("2d");
      _ctx.fillStyle = "#000";
      _ctx.fillRect(0, 0, width, height);
      _visibleCtx.fillStyle = "#000";
      _visibleCtx.fillRect(0, 0, width, height);
    },

    fondo: async (color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.fillRect(0, 0, _buffer.width, _buffer.height);
    },

    dibujar_rect: async (x, y, w, h, color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.fillRect(Number(x), Number(y), Number(w), Number(h));
    },

    dibujar_circulo: async (x, y, radio, color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.beginPath();
      ctx.arc(Number(x), Number(y), Math.abs(Number(radio)), 0, Math.PI * 2);
      ctx.fill();
    },

    dibujar_linea: async (x1, y1, x2, y2, color, grosor) => {
      const ctx = ensureCanvas();
      ctx.strokeStyle = resolveColor(color);
      ctx.lineWidth = Number(grosor) || 2;
      ctx.beginPath();
      ctx.moveTo(Number(x1), Number(y1));
      ctx.lineTo(Number(x2), Number(y2));
      ctx.stroke();
    },

    texto: async (x, y, msg, color, size) => {
      const ctx = ensureCanvas();
      const px = Number(size) || 18;
      ctx.fillStyle = resolveColor(color);
      ctx.font = `${px}px 'JetBrains Mono', Consolas, monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(String(msg), Number(x), Number(y));
    },

    actualizar: async () => {
      if (_visibleCtx && _buffer) {
        _visibleCtx.drawImage(_buffer, 0, 0);
      }
      await new Promise((r) => requestAnimationFrame(r));
    },

    limpiar: async () => {
      const ctx = ensureCanvas();
      ctx.clearRect(0, 0, _buffer.width, _buffer.height);
    },

    ancho: () => _buffer?.width ?? 0,
    alto: () => _buffer?.height ?? 0,
  };
}

export function resetCanvas() {
  _canvas = null;
  _visibleCtx = null;
  _buffer = null;
  _ctx = null;
}
