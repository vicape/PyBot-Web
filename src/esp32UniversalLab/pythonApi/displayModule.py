"""ST7789 172x320 LCD on Waveshare ESP32-C6-LCD-1.47 (SPI).

Graphics extensions (shapes, typography, PBI images) are additive.
Hardware color order / physical framebuffer: UNVERIFIED until bench test.
size=1 means original native 8px glyph height. Integer RGB565 is the default
color representation. color(r,g,b) packs 8-bit channels into RGB565:
  ((r&0xF8)<<8) | ((g&0xFC)<<3) | (b>>3)

Fonts: "mono" (default bitmap family) and "sans" (inset lightweight family).
Spanish accents/ñ/¿/¡ only for bundled glyphs; other non-ASCII -> "?" (no crash).
Bold=double stamp +1px; italic=row shear; underline=hline under advance.
align x-anchor: left=x at left edge; center=x at text center; right=x at right edge.
Images: lcd.image() reads board .pbi (PBI1) assets — MCU does NOT decode PNG/JPEG.
"""
from machine import Pin, SPI
import framebuf
import time
import os

WIDTH = 172
HEIGHT = 320
_PIN_MOSI = 6
_PIN_SCLK = 7
_PIN_CS = 14
_PIN_DC = 15
_PIN_RST = 21
_PIN_BL = 22

_MAX_SIZE = 8
_MAX_POLY = 32
_ASSET_DIR = "pybot/assets"
_MANIFEST = "pybot/assets/manifest.json"
_PBI_MAGIC = b"PBI1"

# Compact glyph blobs: "ord:hex8bytes,..." — mono + sans (visibly distinct).
_FONT_MONO_BLOB = "32:0000000000000000,33:3030303030003000,34:6c6c000000000000,35:6c6cfe6cfe6c6c00,36:307cd8f86cf83000,37:c6cc1860c0c60000,38:70d8d870dacc7a00,39:3030000000000000,40:183060c060301800,41:6030180c18306000,42:00d67c387cd60000,43:003030fc30300000,44:0000000000303060,45:000000fe00000000,46:0000000000303000,47:060c1860c0000000,48:7cc6ced6e6c67c00,49:307030303030fc00,50:7cc6061c70c0fe00,51:7cc6067c06c67c00,52:1c3c6cccfe0c0c00,53:fec0fc0606c67c00,54:7cc6c0fcc6c67c00,55:fe060c1830303000,56:7cc6c67cc6c67c00,57:7cc6c67e06c67c00,58:0030300030300000,59:0030300030306000,60:1860c06018000000,61:0000fc00fc000000,62:60180c1860000000,63:7cc60c1830003000,64:7cc6ded6dec07c00,65:7cc6c6fec6c6c600,66:fcc6c6fcc6c6fc00,67:7cc6c0c0c0c67c00,68:fcc6c6c6c6c6fc00,69:fec0c0f8c0c0fe00,70:fec0c0f8c0c0c000,71:7cc6c0dec6c67c00,72:c6c6c6fec6c6c600,73:7c30303030307c00,74:1e0c0c0ccccc7800,75:c6ccd8f0d8ccc600,76:c0c0c0c0c0c0fe00,77:c6eefed6c6c6c600,78:c6e6f6decec6c600,79:7cc6c6c6c6c67c00,80:fcc6c6fcc0c0c000,81:7cc6c6c6d6cc7a00,82:fcc6c6fcd8ccc600,83:7ec0c07c0606fc00,84:fe30303030303000,85:c6c6c6c6c6c67c00,86:c6c6c6c6c66c3800,87:c6c6c6d6feeec600,88:c6c66c38386cc600,89:c6c66c3830303000,90:fe060c1860c0fe00,91:78c0c0c0c0c07800,92:c06030180c000000,93:7818181818187800,94:306cc60000000000,95:000000000000fe00,96:6030000000000000,97:7cc6c6fec6c6c600,98:fcc6c6fcc6c6fc00,99:7cc6c0c0c0c67c00,100:fcc6c6c6c6c6fc00,101:fec0c0f8c0c0fe00,102:fec0c0f8c0c0c000,103:7cc6c0dec6c67c00,104:c6c6c6fec6c6c600,105:7c30303030307c00,106:1e0c0c0ccccc7800,107:c6ccd8f0d8ccc600,108:c0c0c0c0c0c0fe00,109:c6eefed6c6c6c600,110:c6e6f6decec6c600,111:7cc6c6c6c6c67c00,112:fcc6c6fcc0c0c000,113:7cc6c6c6d6cc7a00,114:fcc6c6fcd8ccc600,115:7ec0c07c0606fc00,116:fe30303030303000,117:c6c6c6c6c6c67c00,118:c6c6c6c6c66c3800,119:c6c6c6d6feeec600,120:c6c66c38386cc600,121:c6c66c3830303000,122:fe060c1860c0fe00,123:1c30306030301c00,124:3030303030303000,125:7018180c18187000,126:0066da0000000000,161:3000303030303000,191:300030180cc67c00,193:307cc6fec6c6c600,201:fec0c0f8c0c0fe00,205:7c30303030307c00,209:d6e6f6decec6c600,211:7cc6c6c6c6c67c00,218:c6c6c6c6c6c67c00,220:c600c6c6c6c67c00,225:187c0c7ccccc7a00,233:187cc6fec0c67c00,237:1800783030307c00,241:d67cc6c6c6c6c600,243:187cc6c6c6c67c00,250:6c00c6c6c6c67c00,252:cc00c6c6c6c67c00"
_FONT_SANS_BLOB = "32:0000000000000000,33:1818181818001800,34:3636000000000000,35:36367e367e363600,36:183e6c7c367c1800,37:62660c3060620000,38:386c6c386c663c00,39:1818000000000000,40:0c18306030180c00,41:30180c060c183000,42:006a3e1c3e6a0000,43:0018187e18180000,44:0000000000181830,45:0000007e00000000,46:0000000000181800,47:02060c3060000000,48:3e62666a72623e00,49:1838181818187e00,50:3e62020e38607e00,51:3e62023e02623e00,52:0e1e36667e060600,53:7e607e0202623e00,54:3e62607e62623e00,55:7e02060c18181800,56:3e62623e62623e00,57:3e62623e02623e00,58:0018180018180000,59:0018180018183000,60:0c3060300c000000,61:00007e007e000000,62:300c060c30000000,63:3e62060c18001800,64:3e626e6a6e603e00,65:3e62627e62626200,66:7e62627e62627e00,67:3e62606060623e00,68:7e62626262627e00,69:7e60607c60607e00,70:7e60607c60606000,71:3e62606e62623e00,72:6262627e62626200,73:3e18181818183e00,74:0e06060666663c00,75:62666c786c666200,76:6060606060607e00,77:62767e6a62626200,78:62727a6e66626200,79:3e62626262623e00,80:7e62627e60606000,81:3e6262626a663c00,82:7e62627e6c666200,83:3e60603e02027e00,84:7e18181818181800,85:6262626262623e00,86:6262626262361c00,87:6262626a7e766200,88:6262361c1c366200,89:6262361c18181800,90:7e02060c30607e00,91:3c60606060603c00,92:6030180c06000000,93:3c0c0c0c0c0c3c00,94:1836620000000000,95:0000000000007e00,96:3018000000000000,97:3e62627e62626200,98:7e62627e62627e00,99:3e62606060623e00,100:7e62626262627e00,101:7e60607c60607e00,102:7e60607c60606000,103:3e62606e62623e00,104:6262627e62626200,105:3e18181818183e00,106:0e06060666663c00,107:62666c786c666200,108:6060606060607e00,109:62767e6a62626200,110:62727a6e66626200,111:3e62626262623e00,112:7e62627e60606000,113:3e6262626a663c00,114:7e62627e6c666200,115:3e60603e02027e00,116:7e18181818181800,117:6262626262623e00,118:6262626262361c00,119:6262626a7e766200,120:6262361c1c366200,121:6262361c18181800,122:7e02060c30607e00,123:0e18183018180e00,124:1818181818181800,125:380c0c060c0c3800,126:00326c0000000000,161:1800181818181800,191:1800180c06623e00,193:183e627e62626200,201:7e60607c60607e00,205:3e18181818183e00,209:6a727a6e66626200,211:3e62626262623e00,218:6262626262623e00,220:6200626262623e00,225:0c3e063e66663c00,233:0c3e627e60623e00,237:0c003c1818183e00,241:6a3e626262626200,243:0c3e626262623e00,250:3600626262623e00,252:6600626262623e00"
_font_cache = {}


def color(r, g, b):
    """Pack 8-bit RGB into RGB565: ((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3)."""
    return ((int(r) & 0xF8) << 8) | ((int(g) & 0xFC) << 3) | (int(b) >> 3)


def _load_font(name):
    if name in _font_cache:
        return _font_cache[name]
    blob = _FONT_SANS_BLOB if name == "sans" else _FONT_MONO_BLOB
    table = {}
    for part in blob.split(","):
        if not part:
            continue
        k, hx = part.split(":")
        table[int(k)] = bytes.fromhex(hx)
    _font_cache[name] = table
    return table


class Lcd:
    """Minimal ST7789 driver for the documented C6 LCD pin map."""

    def __init__(self, baudrate=40_000_000):
        self.cs = Pin(_PIN_CS, Pin.OUT, value=1)
        self.dc = Pin(_PIN_DC, Pin.OUT, value=0)
        self.rst = Pin(_PIN_RST, Pin.OUT, value=1)
        self.bl = Pin(_PIN_BL, Pin.OUT, value=1)
        self.spi = SPI(
            1,
            baudrate=baudrate,
            polarity=1,
            phase=1,
            sck=Pin(_PIN_SCLK),
            mosi=Pin(_PIN_MOSI),
        )
        self.buffer = bytearray(WIDTH * HEIGHT * 2)
        self.fb = framebuf.FrameBuffer(
            self.buffer, WIDTH, HEIGHT, framebuf.RGB565
        )
        self._init()

    def _write_cmd(self, cmd):
        self.cs(0)
        self.dc(0)
        self.spi.write(bytearray([cmd]))
        self.cs(1)

    def _write_data(self, data):
        self.cs(0)
        self.dc(1)
        self.spi.write(data if isinstance(data, (bytes, bytearray)) else bytearray(data))
        self.cs(1)

    def _init(self):
        self.rst(0)
        time.sleep_ms(50)
        self.rst(1)
        time.sleep_ms(50)
        self._write_cmd(0x01)  # SWRESET
        time.sleep_ms(150)
        self._write_cmd(0x11)  # SLPOUT
        time.sleep_ms(120)
        self._write_cmd(0x36)
        self._write_data(b'\x00')
        self._write_cmd(0x3A)
        self._write_data(b'\x05')  # 16-bit
        self._write_cmd(0x21)  # INVON (panel dependent)
        self._write_cmd(0x13)
        self._write_cmd(0x29)  # DISPON
        self.backlight(True)

    def backlight(self, on=True):
        self.bl(1 if on else 0)

    def fill(self, color):
        self.fb.fill(color)

    def pixel(self, x, y, color):
        self.fb.pixel(x, y, color)

    def show(self):
        # Explicit refresh convention: callers invoke show() after drawing (baseline SPI path).
        # Window: full panel; X offset 34 is common for 172-wide ST7789 modules.
        x0 = 34
        y0 = 0
        x1 = x0 + WIDTH - 1
        y1 = y0 + HEIGHT - 1
        self._write_cmd(0x2A)
        self._write_data(bytearray([x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF]))
        self._write_cmd(0x2B)
        self._write_data(bytearray([y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF]))
        self._write_cmd(0x2C)
        self._write_data(self.buffer)

    # --- Stage A: drawing primitives (additive) ---

    def line(self, x1, y1, x2, y2, color):
        """Bresenham line via framebuf.line when present; clipped by FB."""
        try:
            self.fb.line(int(x1), int(y1), int(x2), int(y2), int(color))
        except Exception:
            self._line_fallback(int(x1), int(y1), int(x2), int(y2), int(color))

    def _line_fallback(self, x0, y0, x1, y1, color):
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            if 0 <= x0 < WIDTH and 0 <= y0 < HEIGHT:
                self.fb.pixel(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def rectangle(self, x, y, width, height, color, fill=False):
        """Axis-aligned rectangle; fill=True uses fill_rect. Invalid size ignored."""
        x, y, w, h = int(x), int(y), int(width), int(height)
        if w <= 0 or h <= 0:
            return
        if fill:
            try:
                self.fb.fill_rect(x, y, w, h, int(color))
            except Exception:
                for yy in range(y, y + h):
                    for xx in range(x, x + w):
                        if 0 <= xx < WIDTH and 0 <= yy < HEIGHT:
                            self.fb.pixel(xx, yy, int(color))
        else:
            try:
                self.fb.rect(x, y, w, h, int(color))
            except Exception:
                self.line(x, y, x + w - 1, y, color)
                self.line(x, y + h - 1, x + w - 1, y + h - 1, color)
                self.line(x, y, x, y + h - 1, color)
                self.line(x + w - 1, y, x + w - 1, y + h - 1, color)

    def circle(self, cx, cy, radius, color, fill=False):
        """Midpoint circle; radius<=0 ignored. Clips partially off-screen."""
        cx, cy, r = int(cx), int(cy), int(radius)
        if r <= 0:
            return
        if r > 512:
            r = 512
        if fill:
            self._fill_circle(cx, cy, r, int(color))
        else:
            self._outline_circle(cx, cy, r, int(color))

    def _plot8(self, cx, cy, x, y, color):
        for px, py in (
            (cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y), (cx - x, cy - y),
            (cx + y, cy + x), (cx - y, cy + x), (cx + y, cy - x), (cx - y, cy - x),
        ):
            if 0 <= px < WIDTH and 0 <= py < HEIGHT:
                self.fb.pixel(px, py, color)

    def _outline_circle(self, cx, cy, r, color):
        x, y, d = 0, r, 1 - r
        self._plot8(cx, cy, x, y, color)
        while x < y:
            if d < 0:
                d += 2 * x + 3
            else:
                d += 2 * (x - y) + 5
                y -= 1
            x += 1
            self._plot8(cx, cy, x, y, color)

    def _hfill(self, y, x0, x1, color):
        if y < 0 or y >= HEIGHT:
            return
        if x0 > x1:
            x0, x1 = x1, x0
        if x1 < 0 or x0 >= WIDTH:
            return
        if x0 < 0:
            x0 = 0
        if x1 >= WIDTH:
            x1 = WIDTH - 1
        try:
            self.fb.hline(x0, y, x1 - x0 + 1, color)
        except Exception:
            for x in range(x0, x1 + 1):
                self.fb.pixel(x, y, color)

    def _fill_circle(self, cx, cy, r, color):
        x, y, d = 0, r, 1 - r
        self._hfill(cy, cx - r, cx + r, color)
        while x < y:
            if d < 0:
                d += 2 * x + 3
            else:
                d += 2 * (x - y) + 5
                y -= 1
            x += 1
            self._hfill(cy + y, cx - x, cx + x, color)
            self._hfill(cy - y, cx - x, cx + x, color)
            self._hfill(cy + x, cx - y, cx + y, color)
            self._hfill(cy - x, cx - y, cx + y, color)

    def ellipse(self, cx, cy, rx, ry, color, fill=False):
        """Ellipse via midpoint/scanline Python fallback (no native FB ellipse call)."""
        cx, cy, rx, ry = int(cx), int(cy), int(rx), int(ry)
        if rx <= 0 or ry <= 0:
            return
        if rx > 512:
            rx = 512
        if ry > 512:
            ry = 512
        if fill:
            self._fill_ellipse(cx, cy, rx, ry, int(color))
        else:
            self._outline_ellipse(cx, cy, rx, ry, int(color))

    def _outline_ellipse(self, cx, cy, rx, ry, color):
        x, y = 0, ry
        rx2, ry2 = rx * rx, ry * ry
        two_rx2, two_ry2 = 2 * rx2, 2 * ry2
        px, py = 0, two_rx2 * y
        p = ry2 - (rx2 * ry) + (rx2 // 4)
        while px < py:
            for a, b in ((cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y), (cx - x, cy - y)):
                if 0 <= a < WIDTH and 0 <= b < HEIGHT:
                    self.fb.pixel(a, b, color)
            x += 1
            px += two_ry2
            if p < 0:
                p += ry2 + px
            else:
                y -= 1
                py -= two_rx2
                p += ry2 + px - py
        p = ry2 * (x + 1) * (x + 1) + rx2 * (y - 1) * (y - 1) - rx2 * ry2
        while y >= 0:
            for a, b in ((cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y), (cx - x, cy - y)):
                if 0 <= a < WIDTH and 0 <= b < HEIGHT:
                    self.fb.pixel(a, b, color)
            y -= 1
            py -= two_rx2
            if p > 0:
                p += rx2 - py
            else:
                x += 1
                px += two_ry2
                p += rx2 - py + px

    def _fill_ellipse(self, cx, cy, rx, ry, color):
        for y in range(-ry, ry + 1):
            # x extent: x^2/rx^2 + y^2/ry^2 <= 1
            yy = y * y
            # avoid float: x^2 <= rx^2 * (1 - y^2/ry^2) = rx^2*(ry^2-y^2)/ry^2
            num = rx * rx * (ry * ry - yy)
            if num < 0:
                continue
            # integer sqrt
            t = num // (ry * ry) if ry else 0
            # isqrt
            xi = int(t ** 0.5) if t > 0 else 0
            self._hfill(cy + y, cx - xi, cx + xi, color)

    def triangle(self, x1, y1, x2, y2, x3, y3, color, fill=False):
        """Triangle outline or scanline fill. Degenerate (collinear/zero) is safe."""
        x1, y1, x2, y2, x3, y3 = int(x1), int(y1), int(x2), int(y2), int(x3), int(y3)
        if fill:
            self._fill_triangle(x1, y1, x2, y2, x3, y3, int(color))
        else:
            self.line(x1, y1, x2, y2, color)
            self.line(x2, y2, x3, y3, color)
            self.line(x3, y3, x1, y1, color)

    def _fill_triangle(self, x0, y0, x1, y1, x2, y2, color):
        # sort by y
        if y0 > y1:
            x0, x1, y0, y1 = x1, x0, y1, y0
        if y1 > y2:
            x1, x2, y1, y2 = x2, x1, y2, y1
        if y0 > y1:
            x0, x1, y0, y1 = x1, x0, y1, y0
        if y0 == y2:
            self._hfill(y0, min(x0, x1, x2), max(x0, x1, x2), color)
            return

        def _edge(xa, ya, xb, yb, y):
            if yb == ya:
                return xa
            return xa + (xb - xa) * (y - ya) // (yb - ya)

        for y in range(y0, y2 + 1):
            if y < y1:
                xa = _edge(x0, y0, x2, y2, y)
                xb = _edge(x0, y0, x1, y1, y) if y1 != y0 else x0
            else:
                xa = _edge(x0, y0, x2, y2, y)
                xb = _edge(x1, y1, x2, y2, y) if y2 != y1 else x1
            self._hfill(y, xa, xb, color)

    def polygon(self, points, color, fill=False):
        """Convex/simple polygon up to 32 points. Degenerate lists ignored safely."""
        if not points or len(points) < 2:
            return
        if len(points) > _MAX_POLY:
            raise ValueError("polygon: max %d points" % _MAX_POLY)
        pts = []
        for p in points:
            if not p or len(p) < 2:
                continue
            pts.append((int(p[0]), int(p[1])))
        n = len(pts)
        if n < 2:
            return
        if n == 2 or not fill:
            for i in range(n):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % n]
                self.line(x0, y0, x1, y1, color)
            return
        # scanline fill with edge table (bounded)
        ys = [p[1] for p in pts]
        y_min, y_max = min(ys), max(ys)
        if y_max - y_min > HEIGHT * 2:
            return
        for y in range(y_min, y_max + 1):
            xs = []
            for i in range(n):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % n]
                if y0 == y1:
                    continue
                if (y0 <= y < y1) or (y1 <= y < y0):
                    xs.append(x0 + (x1 - x0) * (y - y0) // (y1 - y0))
            if not xs:
                continue
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                self._hfill(y, xs[i], xs[i + 1], int(color))

    # --- Stage B: typography ---

    def text(
        self,
        s,
        x,
        y,
        color=0xFFFF,
        size=1,
        font="mono",
        bold=False,
        italic=False,
        underline=False,
        align="left",
        background=None,
    ):
        """Draw text. Default call text(s,x,y,color) uses native 8x8 (size=1 mono).

        size: integer scale; size=1 => 8px glyph height.
        font: "mono" | "sans" (bundled bitmaps only; no scalable desktop faces).
        bold/italic/underline: rendered (not no-ops).
        align: left|center|right — x is the anchor on that edge/center.
        background: optional opaque RGB565 behind the advance box.
        """
        text = str(s) if s is not None else ""
        x, y = int(x), int(y)
        color = int(color)
        size = int(size)
        if size < 1:
            size = 1
        if size > _MAX_SIZE:
            size = _MAX_SIZE
        font_name = str(font or "mono").lower()
        if font_name not in ("mono", "sans"):
            font_name = "mono"
        align_n = str(align or "left").lower()
        if align_n not in ("left", "center", "right"):
            align_n = "left"

        use_native = (
            size == 1
            and font_name == "mono"
            and not bold
            and not italic
            and not underline
            and align_n == "left"
            and background is None
        )
        if use_native:
            # Exact legacy appearance for text("Hello",10,20,0xFFFF) / size=1 mono
            safe = []
            for ch in text:
                o = ord(ch)
                safe.append(ch if o < 128 else "?")
            self.fb.text("".join(safe), x, y, color)
            return

        table = _load_font(font_name)
        glyphs = []
        for ch in text:
            o = ord(ch)
            g = table.get(o)
            if g is None:
                g = table.get(ord("?"), bytes(8))
            glyphs.append(g)

        adv = len(glyphs) * 8 * size
        height = 8 * size
        if align_n == "center":
            x = x - adv // 2
        elif align_n == "right":
            x = x - adv

        if background is not None and adv > 0:
            try:
                self.fb.fill_rect(x, y, adv, height + (2 if underline else 0), int(background))
            except Exception:
                self.rectangle(x, y, adv, height + (2 if underline else 0), int(background), True)

        pen_x = x
        for g in glyphs:
            self._blit_glyph(g, pen_x, y, color, size, bold, italic)
            pen_x += 8 * size
        if underline and adv > 0:
            uy = y + height + 1
            self._hfill(uy, x, x + adv - 1, color)

    def _blit_glyph(self, glyph, x, y, color, size, bold, italic):
        for row in range(8):
            bits = glyph[row] if row < len(glyph) else 0
            shear = ((8 - row) * size) // 4 if italic else 0
            for col in range(8):
                if bits & (0x80 >> col):
                    px = x + col * size + shear
                    py = y + row * size
                    for dy in range(size):
                        for dx in range(size):
                            xx, yy = px + dx, py + dy
                            if 0 <= xx < WIDTH and 0 <= yy < HEIGHT:
                                self.fb.pixel(xx, yy, color)
                            if bold:
                                bx = xx + size
                                if 0 <= bx < WIDTH and 0 <= yy < HEIGHT:
                                    self.fb.pixel(bx, yy, color)

    # --- Stage C: PBI images ---

    def image(self, name, x=0, y=0, key=None):
        """Draw a board RGB565 asset (.pbi). Maps PNG/JPG aliases via manifest.

        MCU does not decode PNG/JPEG. Missing files raise OSError.
        key: optional RGB565 color-key transparency. Streams by rows (no 2nd FB).
        """
        x, y = int(x), int(y)
        path = self._resolve_asset(str(name))
        try:
            f = open(path, "rb")
        except OSError:
            raise OSError("image not found: %s" % name)
        try:
            hdr = f.read(12)
            if len(hdr) < 12 or hdr[0:4] != _PBI_MAGIC:
                raise OSError("invalid PBI header: %s" % name)
            w = hdr[4] | (hdr[5] << 8)
            h = hdr[6] | (hdr[7] << 8)
            flags = hdr[8]
            ck = hdr[10] | (hdr[11] << 8)
            if key is not None:
                ck = int(key)
                flags = flags | 1
            # Cap to panel + small headroom; reject pathological sizes (no 2nd FB).
            if w <= 0 or h <= 0 or w > WIDTH or h > HEIGHT:
                raise OSError("invalid PBI dimensions")
            # stream one row (2*w bytes) at a time into framebuffer (no 2nd FB)
            need = w * 2
            for row in range(h):
                row_buf = f.read(need)
                if len(row_buf) < need:
                    break
                dy = y + row
                if dy < 0 or dy >= HEIGHT:
                    continue
                for col in range(w):
                    dx = x + col
                    if dx < 0 or dx >= WIDTH:
                        continue
                    i = col * 2
                    pix = row_buf[i] | (row_buf[i + 1] << 8)
                    if (flags & 1) and pix == ck:
                        continue
                    self.fb.pixel(dx, dy, pix)
        finally:
            f.close()

    def _resolve_asset(self, name):
        # Direct .pbi path
        candidates = []
        if name.endswith(".pbi"):
            candidates.append(name)
            if "/" not in name:
                candidates.append(_ASSET_DIR + "/" + name)
        else:
            base = name.rsplit("/", 1)[-1]
            stem = base.rsplit(".", 1)[0] if "." in base else base
            candidates.append(_ASSET_DIR + "/" + stem + ".pbi")
            candidates.append(_ASSET_DIR + "/" + base + ".pbi")
            # manifest alias
            mapped = self._manifest_lookup(base)
            if mapped:
                candidates.insert(0, mapped)
        for c in candidates:
            try:
                os.stat(c)
                return c
            except OSError:
                continue
        return candidates[0] if candidates else name

    def _manifest_lookup(self, basename):
        try:
            with open(_MANIFEST, "r") as mf:
                raw = mf.read()
        except OSError:
            return None
        # tiny parser: look for "basename":"path"
        key = '"%s"' % basename
        i = raw.find(key)
        if i < 0:
            return None
        j = raw.find(":", i + len(key))
        if j < 0:
            return None
        k = raw.find('"', j + 1)
        if k < 0:
            return None
        e = raw.find('"', k + 1)
        if e < 0:
            return None
        return raw[k + 1 : e]


def init():
    """Create and return the onboard LCD instance."""
    return Lcd()
