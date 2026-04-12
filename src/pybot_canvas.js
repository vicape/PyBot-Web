/**
 * pybot_canvas — lightweight graphics module for PyBot Web.
 * API names follow Pygame conventions (English).
 * Uses double buffering to prevent flicker.
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
const _keys = new Set();

function _onKeyDown(e) {
  _keys.add(e.key);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
    e.preventDefault();
  }
}
function _onKeyUp(e) { _keys.delete(e.key); }

export function setCanvasHooks(onShow) {
  _onShow = onShow;
}

function ensureCanvas() {
  if (!_ctx) throw new Error("canvas_not_ready");
  return _ctx;
}

export function createCanvasModule() {
  return {
    screen: async (w, h) => {
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
      document.addEventListener("keydown", _onKeyDown);
      document.addEventListener("keyup", _onKeyUp);
    },

    fill: async (color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.fillRect(0, 0, _buffer.width, _buffer.height);
    },

    draw_rect: async (x, y, w, h, color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.fillRect(Number(x), Number(y), Number(w), Number(h));
    },

    draw_circle: async (x, y, radius, color) => {
      const ctx = ensureCanvas();
      ctx.fillStyle = resolveColor(color);
      ctx.beginPath();
      ctx.arc(Number(x), Number(y), Math.abs(Number(radius)), 0, Math.PI * 2);
      ctx.fill();
    },

    draw_line: async (x1, y1, x2, y2, color, width) => {
      const ctx = ensureCanvas();
      ctx.strokeStyle = resolveColor(color);
      ctx.lineWidth = Number(width) || 2;
      ctx.beginPath();
      ctx.moveTo(Number(x1), Number(y1));
      ctx.lineTo(Number(x2), Number(y2));
      ctx.stroke();
    },

    draw_text: async (x, y, msg, color, size) => {
      const ctx = ensureCanvas();
      const px = Number(size) || 18;
      ctx.fillStyle = resolveColor(color);
      ctx.font = `${px}px 'JetBrains Mono', Consolas, monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(String(msg), Number(x), Number(y));
    },

    flip: async () => {
      if (_visibleCtx && _buffer) {
        _visibleCtx.drawImage(_buffer, 0, 0);
      }
      await new Promise((r) => requestAnimationFrame(r));
    },

    clear: async () => {
      const ctx = ensureCanvas();
      ctx.clearRect(0, 0, _buffer.width, _buffer.height);
    },

    key_pressed: async (name) => {
      const KEY_MAP = {
        arriba: "ArrowUp", up: "ArrowUp",
        abajo: "ArrowDown", down: "ArrowDown",
        izquierda: "ArrowLeft", left: "ArrowLeft",
        derecha: "ArrowRight", right: "ArrowRight",
        espacio: " ", space: " ",
        enter: "Enter", escape: "Escape", esc: "Escape",
        w: "w", a: "a", s: "s", d: "d",
      };
      const k = String(name ?? "").toLowerCase().trim();
      return _keys.has(KEY_MAP[k] ?? k);
    },

    width: () => _buffer?.width ?? 0,
    height: () => _buffer?.height ?? 0,
  };
}

export function resetCanvas() {
  document.removeEventListener("keydown", _onKeyDown);
  document.removeEventListener("keyup", _onKeyUp);
  _keys.clear();
  _canvas = null;
  _visibleCtx = null;
  _buffer = null;
  _ctx = null;
}
