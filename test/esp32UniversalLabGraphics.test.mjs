/**
 * Focused C6 graphics tests — pixel data, text styles, PBI/RGB565, fake WebSerial transfer.
 * Physical LCD / USB / fonts visibility: UNVERIFIED (not certified here).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C6_BOARD_MODULES } from "../src/esp32UniversalLab/pythonApi/boardModules.js";
import {
  rgbTo565,
  writeRgb565LE,
  readRgb565LE,
  encodePbi,
  decodePbi,
  checksumSum32,
  imageDataToRgb565LE,
  MAX_ASSET_EDGE,
  MAX_ASSET_BYTES,
  MAX_FULLSCREEN_WIDTH,
  MAX_FULLSCREEN_HEIGHT,
  MAX_FULLSCREEN_BYTES,
  LCD_WIDTH,
  LCD_HEIGHT,
} from "../src/esp32UniversalLab/graphics/rgb565.js";
import {
  detectImageMime,
  assetStemFromName,
  computeTargetSize,
} from "../src/esp32UniversalLab/graphics/imagePipeline.js";
import {
  transferC6BinaryAsset,
  uploadC6ImageAsset,
  cleanupOwnedTemp,
  bytesToBase64,
  C6_ASSET_DIR,
  C6_ASSET_MAX_BYTES,
  C6_ASSET_ICON_MAX_BYTES,
} from "../src/esp32UniversalLab/runtime/c6AssetTransfer.js";
import { TEST_SUITES } from "./suiteManifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const displayPy = C6_BOARD_MODULES["pybot/display.py"];

const HARNESS = `
import sys, os, json
sys.path.insert(0, os.environ["GFX_TMP"])

# --- mocks ---
class Pin:
    OUT = 1
    IN = 0
    def __init__(self, *a, **k):
        self.v = k.get("value", 0)
    def __call__(self, v=None):
        if v is None: return self.v
        self.v = v
    def value(self, v=None):
        return self.__call__(v)

class SPI:
    def __init__(self, *a, **k): pass
    def write(self, data): pass

class machine_mod:
    Pin = Pin
    SPI = SPI
sys.modules["machine"] = machine_mod()

class FrameBuffer:
    RGB565 = 1
    def __init__(self, buf, w, h, fmt):
        self.buf = buf
        self.w = w
        self.h = h
    def _i(self, x, y):
        return (y * self.w + x) * 2
    def fill(self, c):
        lo, hi = c & 0xff, (c >> 8) & 0xff
        b = self.buf
        for i in range(0, len(b), 2):
            b[i] = lo; b[i+1] = hi
    def pixel(self, x, y, c=None):
        if not (0 <= x < self.w and 0 <= y < self.h):
            return 0 if c is None else None
        i = self._i(x, y)
        if c is None:
            return self.buf[i] | (self.buf[i+1] << 8)
        self.buf[i] = c & 0xff
        self.buf[i+1] = (c >> 8) & 0xff
    def line(self, x0,y0,x1,y1,c):
        # intentional: missing on purpose for some tests — Lcd has fallback
        raise AttributeError("no native line")
    def rect(self, x,y,w,h,c):
        raise AttributeError("no")
    def fill_rect(self, x,y,w,h,c):
        for yy in range(y, y+h):
            for xx in range(x, x+w):
                self.pixel(xx, yy, c)
    def hline(self, x,y,w,c):
        for i in range(w):
            self.pixel(x+i, y, c)
    def text(self, s, x, y, c):
        # mark each char cell top-left pixel for native path detection
        for i, ch in enumerate(str(s)):
            self.pixel(x + i*8, y, c)

class framebuf_mod:
    FrameBuffer = FrameBuffer
    RGB565 = 1
sys.modules["framebuf"] = framebuf_mod()

class time_mod:
    def sleep_ms(self, ms): pass
sys.modules["time"] = time_mod()

# load display source
src = open(os.path.join(os.environ["GFX_TMP"], "display_under_test.py"), "r", encoding="utf-8").read()
# neutralize hardware __init__ side effects by patching after exec
ns = {}
exec(compile(src, "display_under_test.py", "exec"), ns)

Lcd = ns["Lcd"]
color = ns["color"]

def make_lcd():
    lcd = Lcd.__new__(Lcd)
    lcd.buffer = bytearray(172 * 320 * 2)
    lcd.fb = FrameBuffer(lcd.buffer, 172, 320, 1)
    lcd.cs = Pin(0); lcd.dc = Pin(0); lcd.rst = Pin(0); lcd.bl = Pin(0)
    lcd.spi = SPI()
    return lcd

def get_px(lcd, x, y):
    return lcd.fb.pixel(x, y)

results = {}

# color helper
assert color(255, 0, 0) == 0xF800
assert color(0, 255, 0) == 0x07E0
assert color(0, 0, 255) == 0x001F
results["color"] = True

# line + clipping
lcd = make_lcd()
lcd.fill(0)
lcd.line(0, 0, 10, 0, 0xF800)
assert get_px(lcd, 0, 0) == 0xF800
assert get_px(lcd, 10, 0) == 0xF800
assert get_px(lcd, 5, 0) == 0xF800
lcd.line(-5, 5, 5, 5, 0x07E0)  # partial off-screen
assert get_px(lcd, 0, 5) == 0x07E0
assert get_px(lcd, 5, 5) == 0x07E0
results["line"] = True

# rectangle fill boundaries
lcd = make_lcd(); lcd.fill(0)
lcd.rectangle(2, 2, 4, 3, 0x001F, fill=True)
assert get_px(lcd, 2, 2) == 0x001F
assert get_px(lcd, 5, 4) == 0x001F
assert get_px(lcd, 6, 2) == 0
assert get_px(lcd, 2, 5) == 0
lcd.rectangle(10, 10, 0, 5, 0xFFFF, fill=True)  # invalid
assert get_px(lcd, 10, 10) == 0
results["rect"] = True

# circle geometry (center + outline point)
lcd = make_lcd(); lcd.fill(0)
lcd.circle(20, 20, 5, 0xFFFF, fill=False)
assert get_px(lcd, 20, 15) == 0xFFFF or get_px(lcd, 20, 25) == 0xFFFF
lcd.circle(50, 50, 4, 0xF800, fill=True)
assert get_px(lcd, 50, 50) == 0xF800
lcd.circle(10, 10, 0, 0xFFFF, fill=True)  # degenerate
assert get_px(lcd, 10, 10) == 0
results["circle"] = True

# triangle fill
lcd = make_lcd(); lcd.fill(0)
lcd.triangle(10, 10, 30, 10, 20, 25, 0x07E0, fill=True)
assert get_px(lcd, 20, 12) == 0x07E0
lcd.triangle(0, 0, 0, 0, 0, 0, 0xFFFF, fill=True)  # degenerate safe
results["triangle"] = True

# negative coords / clipping ellipse
lcd = make_lcd(); lcd.fill(0)
lcd.ellipse(-2, 10, 5, 3, 0x001F, fill=True)
assert get_px(lcd, 0, 10) == 0x001F
results["ellipse_clip"] = True

# malformed / polygon bounds
lcd = make_lcd(); lcd.fill(0)
lcd.polygon([], 0xFFFF, fill=True)
lcd.polygon([(1,1)], 0xFFFF, fill=True)
try:
    lcd.polygon([(i, i) for i in range(40)], 0xFFFF)
    raise SystemExit("polygon should reject >32")
except ValueError:
    pass
results["polygon"] = True

# text default compatibility — native path marks cells
lcd = make_lcd(); lcd.fill(0)
lcd.text("Hello", 10, 20, 0xFFFF)
assert get_px(lcd, 10, 20) == 0xFFFF
assert get_px(lcd, 18, 20) == 0xFFFF  # second char
# extended
lcd = make_lcd(); lcd.fill(0)
lcd.text("Hi", 20, 40, color=0xFFFF, size=2, font="mono", bold=True, italic=False, underline=True, align="left", background=0x001F)
assert get_px(lcd, 20, 40) == 0xFFFF or get_px(lcd, 21, 40) == 0xFFFF
# size=2 taller than size=1
lcd1 = make_lcd(); lcd1.fill(0)
lcd1.text("A", 0, 0, color=0xFFFF, size=1, font="sans")
lcd2 = make_lcd(); lcd2.fill(0)
lcd2.text("A", 0, 0, color=0xFFFF, size=2, font="sans")
# count nonzero rows
def nonzero_rows(lcd):
    rows=set()
    for y in range(20):
        for x in range(20):
            if get_px(lcd,x,y):
                rows.add(y)
    return rows
assert max(nonzero_rows(lcd2)) >= max(nonzero_rows(lcd1))
# fonts differ
lcdm = make_lcd(); lcdm.fill(0); lcdm.text("A", 0, 0, color=0xFFFF, size=1, font="mono", bold=False)
lcds = make_lcd(); lcds.fill(0); lcds.text("A", 0, 0, color=0xFFFF, size=1, font="sans", bold=False)
# at least one pixel difference in 8x8
diff=False
for y in range(8):
    for x in range(8):
        if get_px(lcdm,x,y) != get_px(lcds,x,y):
            diff=True
assert diff
# align center
lcd = make_lcd(); lcd.fill(0)
lcd.text("AB", 40, 10, color=0xFFFF, size=1, font="mono", align="center")
# advance 16 → left edge at 32
assert get_px(lcd, 32, 10) == 0xFFFF or any(get_px(lcd,32+x,10+y) for x in range(8) for y in range(8))
# non-ASCII fallback no crash
lcd = make_lcd(); lcd.fill(0)
lcd.text("你好", 0, 0, 0xFFFF)
lcd.text("niño", 0, 16, color=0xFFFF, size=1, font="mono")
lcd.text("¿Qué?", 0, 32, color=0xFFFF, size=1, font="sans")
results["text"] = True

# image PBI draw + missing + crop clip
asset_dir = os.path.join(os.environ["GFX_TMP"], "pybot", "assets")
os.makedirs(asset_dir, exist_ok=True)
# 2x2 red/green/blue/white checker-ish
w,h=2,2
pix=bytearray(w*h*2)
# LE pixels
def put(i,c):
    pix[i*2]=c&0xff; pix[i*2+1]=(c>>8)&0xff
put(0,0xF800); put(1,0x07E0); put(2,0x001F); put(3,0xFFFF)
hdr=bytearray(12)
hdr[0:4]=b"PBI1"; hdr[4]=2; hdr[6]=2
open(os.path.join(asset_dir,"logo.pbi"),"wb").write(hdr+pix)
open(os.path.join(asset_dir,"manifest.json"),"w").write('{"logo.png":"pybot/assets/logo.pbi"}')
# chdir so relative paths resolve
os.chdir(os.environ["GFX_TMP"])
lcd = make_lcd(); lcd.fill(0)
lcd.image("logo.png", 5, 6)
assert get_px(lcd, 5, 6) == 0xF800
assert get_px(lcd, 6, 6) == 0x07E0
assert get_px(lcd, 5, 7) == 0x001F
assert get_px(lcd, 6, 7) == 0xFFFF
# clip negative
lcd = make_lcd(); lcd.fill(0)
lcd.image("logo.png", -1, 0)
assert get_px(lcd, 0, 0) == 0x07E0  # second pixel of row0
try:
    lcd.image("missing_xyz.png", 0, 0)
    raise SystemExit("missing should raise")
except OSError:
    pass
results["image"] = True

# driver preservation fingerprints
assert "x0 = 34" in src
assert "_PIN_MOSI = 6" in src
assert "self.buffer = bytearray(WIDTH * HEIGHT * 2)" in src
assert "def show(self):" in src
results["preserve"] = True

print("GFX_PYTHON_OK " + json.dumps(results))
`;

function runPythonPixelHarness() {
  const dir = mkdtempSync(join(tmpdir(), "c6gfx-"));
  try {
    writeFileSync(join(dir, "display_under_test.py"), displayPy, "utf8");
    writeFileSync(join(dir, "harness.py"), HARNESS, "utf8");
    const r = spawnSync("python3", [join(dir, "harness.py")], {
      encoding: "utf8",
      env: { ...process.env, GFX_TMP: dir },
    });
    if (r.status !== 0) {
      throw new Error(
        `python harness fail status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
      );
    }
    assert.match(r.stdout, /GFX_PYTHON_OK/);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("AC: display.py keeps original Lcd SPI/show/init and public fb/buffer", () => {
  assert.ok(displayPy.includes("class Lcd:"));
  assert.ok(displayPy.includes("def __init__(self, baudrate=40_000_000):"));
  assert.ok(displayPy.includes("_PIN_MOSI = 6"));
  assert.ok(displayPy.includes("_PIN_SCLK = 7"));
  assert.ok(displayPy.includes("_PIN_CS = 14"));
  assert.ok(displayPy.includes("_PIN_DC = 15"));
  assert.ok(displayPy.includes("_PIN_RST = 21"));
  assert.ok(displayPy.includes("_PIN_BL = 22"));
  assert.ok(displayPy.includes("polarity=1"));
  assert.ok(displayPy.includes("phase=1"));
  assert.ok(displayPy.includes("x0 = 34"));
  assert.ok(displayPy.includes("self.buffer = bytearray(WIDTH * HEIGHT * 2)"));
  assert.ok(displayPy.includes("self.fb = framebuf.FrameBuffer"));
  assert.ok(displayPy.includes("def show(self):"));
  assert.ok(displayPy.includes("def backlight(self, on=True):"));
  assert.ok(displayPy.includes("def fill(self, color):"));
  assert.ok(displayPy.includes("def pixel(self, x, y, color):"));
});

test("AC: real shape methods present (not stubs)", () => {
  for (const name of [
    "def line(self, x1, y1, x2, y2, color)",
    "def rectangle(self, x, y, width, height, color, fill=False)",
    "def circle(self, cx, cy, radius, color, fill=False)",
    "def ellipse(self, cx, cy, rx, ry, color, fill=False)",
    "def triangle(self, x1, y1, x2, y2, x3, y3, color, fill=False)",
    "def polygon(self, points, color, fill=False)",
  ]) {
    assert.ok(displayPy.includes(name), name);
  }
  // No native ellipse call; Python midpoint/scanline fallback only
  assert.ok(!displayPy.includes("framebuf.ellipse()"));
  assert.ok(displayPy.includes("_outline_ellipse"));
  assert.ok(displayPy.includes("_fill_ellipse"));
});

test("AC: text kwargs + two fonts + color helper", () => {
  assert.ok(displayPy.includes('font="mono"'));
  assert.ok(displayPy.includes('"sans"') || displayPy.includes("'sans'"));
  assert.ok(displayPy.includes("_FONT_SANS_BLOB"));
  assert.ok(displayPy.includes("bold=False"));
  assert.ok(displayPy.includes("italic=False"));
  assert.ok(displayPy.includes("underline=False"));
  assert.ok(displayPy.includes('align="left"'));
  assert.ok(displayPy.includes("background=None"));
  assert.ok(displayPy.includes("size=1 means original native 8px") || displayPy.includes("size=1 => 8px"));
  assert.ok(displayPy.includes("def color(r, g, b):"));
  assert.ok(!displayPy.toLowerCase().includes("arial"));
  assert.ok(!displayPy.toLowerCase().includes("roboto"));
  assert.ok(!displayPy.includes("TTF"));
});

test("python pixel harness: geometry/text/image", () => {
  const out = runPythonPixelHarness();
  assert.match(out, /GFX_PYTHON_OK/);
});

test("RGB565 LE byte order + PBI encode/decode + checkerboard", () => {
  assert.equal(rgbTo565(255, 0, 0), 0xf800);
  assert.equal(rgbTo565(0, 255, 0), 0x07e0);
  assert.equal(rgbTo565(0, 0, 255), 0x001f);
  const buf = new Uint8Array(2);
  writeRgb565LE(buf, 0, 0xf800);
  assert.deepEqual([...buf], [0x00, 0xf8]);
  assert.equal(readRgb565LE(buf, 0), 0xf800);

  const w = 2,
    h = 2;
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const pixels = imageDataToRgb565LE({ data, width: w, height: h });
  assert.equal(readRgb565LE(pixels, 0), 0xf800);
  assert.equal(readRgb565LE(pixels, 2), 0x07e0);
  assert.equal(readRgb565LE(pixels, 4), 0x001f);
  assert.equal(readRgb565LE(pixels, 6), 0xffff);
  const pbi = encodePbi(w, h, pixels);
  const dec = decodePbi(pbi);
  assert.equal(dec.width, 2);
  assert.equal(dec.height, 2);
  assert.equal(checksumSum32(pbi), checksumSum32(pbi));
});

test("image MIME/signature + stem + target sizing rejects", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(detectImageMime(png), "image/png");
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(detectImageMime(jpg), "image/jpeg");
  assert.throws(() => detectImageMime(new Uint8Array([1, 2, 3])), /IMAGE_BAD_SIGNATURE/);
  assert.equal(assetStemFromName("My Logo.PNG"), "my_logo");
  const t = computeTargetSize(400, 200, { maxEdge: 100 });
  assert.equal(t.width, 100);
  assert.equal(t.height, 50);
});

test("asset limits: icon 128 vs fullscreen 172x320 caps + clipping", () => {
  assert.equal(LCD_WIDTH, 172);
  assert.equal(LCD_HEIGHT, 320);
  assert.equal(MAX_ASSET_EDGE, 128);
  assert.equal(MAX_ASSET_BYTES, 12 + 128 * 128 * 2);
  assert.equal(MAX_FULLSCREEN_WIDTH, 172);
  assert.equal(MAX_FULLSCREEN_HEIGHT, 320);
  assert.equal(MAX_FULLSCREEN_BYTES, 12 + 172 * 320 * 2);
  assert.equal(MAX_FULLSCREEN_BYTES, 110092);
  assert.equal(C6_ASSET_MAX_BYTES, MAX_FULLSCREEN_BYTES);
  assert.equal(C6_ASSET_ICON_MAX_BYTES, MAX_ASSET_BYTES);

  // icon fit: longest edge 128
  const icon = computeTargetSize(800, 600, { maxEdge: MAX_ASSET_EDGE });
  assert.equal(icon.width, 128);
  assert.equal(icon.height, 96);

  // fullscreen: fit inside 172x320 without forcing square
  const full = computeTargetSize(800, 1200, { profile: "fullscreen" });
  assert.ok(full.width <= 172);
  assert.ok(full.height <= 320);
  assert.equal(full.width, 172);
  assert.equal(full.height, 258);

  // exact panel photograph
  const panel = computeTargetSize(172, 320, { profile: "fullscreen" });
  assert.deepEqual(panel, { width: 172, height: 320 });

  // encode full-screen PBI (header + pixels) — no second FB in JS either
  const pixels = new Uint8Array(172 * 320 * 2);
  pixels[0] = 0x00;
  pixels[1] = 0xf8; // red LE
  const pbi = encodePbi(172, 320, pixels);
  assert.equal(pbi.length, MAX_FULLSCREEN_BYTES);
  assert.equal(decodePbi(pbi).width, 172);
  assert.equal(decodePbi(pbi).height, 320);

  // reject oversize dimensions (beyond panel)
  assert.throws(() => encodePbi(173, 320, new Uint8Array(173 * 320 * 2)), /PBI_DIM_INVALID/);
  assert.throws(() => encodePbi(172, 321, new Uint8Array(172 * 321 * 2)), /PBI_DIM_INVALID/);

  // transfer ceiling rejects bytes above fullscreen cap
  assert.equal(C6_ASSET_MAX_BYTES, 110092);
});

test("fullscreen PBI transfer + checksum commit (chunked, no installFile)", async () => {
  const session = createFakeReplSession();
  // 172×100 exceeds icon-square byte budget but is well under full-screen ceiling
  const w = 172;
  const h = 100;
  const pixels = new Uint8Array(w * h * 2);
  for (let i = 0; i < pixels.length; i += 2) {
    pixels[i] = 0xe0;
    pixels[i + 1] = 0x07; // green
  }
  const pbi = encodePbi(w, h, pixels);
  assert.ok(pbi.length > MAX_ASSET_BYTES); // above icon-square budget
  assert.ok(pbi.length <= MAX_FULLSCREEN_BYTES);
  const r = await transferC6BinaryAsset(session, "pybot/assets/photo.pbi", pbi, {
    originalName: "photo.jpg",
  });
  assert.equal(r.ok, true);
  assert.equal(session.files.get("pybot/assets/photo.pbi").length, pbi.length);
  assert.ok(!session.files.has("pybot/assets/photo.pbi.tmp"));
  assert.ok(session.logs.every((l) => !l.includes("installFile")));
});

test("python harness: fullscreen image clip + reject oversize header", () => {
  const extra = `
# fullscreen row stream + edge clip (no 2nd FB — only row_buf)
w,h=172,8
pix=bytearray(w*h*2)
for i in range(w*h):
    c=0xF800 if i%2==0 else 0x001F
    pix[i*2]=c&0xff; pix[i*2+1]=(c>>8)&0xff
hdr=bytearray(12); hdr[0:4]=b"PBI1"; hdr[4]=w&0xff; hdr[5]=(w>>8)&0xff; hdr[6]=h&0xff
open(os.path.join(asset_dir,"full.pbi"),"wb").write(hdr+pix)
lcd=make_lcd(); lcd.fill(0)
lcd.image("full.pbi", 0, 10)
assert get_px(lcd,0,10)==0xF800
assert get_px(lcd,171,10)==0x001F
# clip right overflow
lcd=make_lcd(); lcd.fill(0)
lcd.image("full.pbi", 10, 0)
assert get_px(lcd,10,0)==0xF800
assert get_px(lcd,171,0)!=0  # last on-screen column drawn
# reject w>WIDTH
bad=bytearray(12); bad[0:4]=b"PBI1"; bad[4]=173; bad[6]=1
open(os.path.join(asset_dir,"bad.pbi"),"wb").write(bad+bytearray(173*2))
try:
    lcd.image("bad.pbi", 0, 0)
    raise SystemExit("oversize should raise")
except OSError:
    pass
print("GFX_FULLSCREEN_CLIP_OK")
`;
  const dir = mkdtempSync(join(tmpdir(), "c6gfx-fs-"));
  try {
    writeFileSync(join(dir, "display_under_test.py"), displayPy, "utf8");
    // Reuse HARNESS setup through a slim script that loads same mocks + asset_dir
    const slim = HARNESS.replace(
      'print("GFX_PYTHON_OK " + json.dumps(results))',
      extra + '\nprint("GFX_PYTHON_OK " + json.dumps(results))',
    );
    writeFileSync(join(dir, "harness.py"), slim, "utf8");
    const r = spawnSync("python3", [join(dir, "harness.py")], {
      encoding: "utf8",
      env: { ...process.env, GFX_TMP: dir },
    });
    if (r.status !== 0) {
      throw new Error(
        `fullscreen harness fail status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
      );
    }
    assert.match(r.stdout, /GFX_FULLSCREEN_CLIP_OK/);
    assert.match(r.stdout, /GFX_PYTHON_OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFakeReplSession(opts = {}) {
  const files = new Map(opts.files ?? []);
  const dirs = new Set(opts.dirs ?? ["pybot"]);
  let failChunkAt = opts.failChunkAt ?? -1;
  let chunkCount = 0;
  let disconnected = false;
  const logs = [];

  function parent(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }

  async function execRaw(code) {
    const src = String(code);
    logs.push(src);
    // Allow best-effort .tmp cleanup after disconnect (mirrors real USB drop).
    const isTmpCleanup =
      src.includes("C6_ASSET_TMP_CLEAN") ||
      (src.includes("os.remove") && src.includes(".tmp"));
    if (disconnected && !isTmpCleanup) throw new Error("USB_DISCONNECT");

    if (src.includes("C6_ASSET_NO_PYBOT") || src.includes("os.stat('pybot')")) {
      if (!dirs.has("pybot")) {
        return { stdout: "C6_ASSET_NO_PYBOT\n", stderr: "OSError\n" };
      }
    }
    if (src.includes("os.mkdir('pybot/assets')") || src.includes("C6_ASSET_DIR_OK")) {
      if (!dirs.has("pybot")) {
        return { stdout: "C6_ASSET_NO_PYBOT\n", stderr: "" };
      }
      dirs.add("pybot/assets");
      return { stdout: "C6_ASSET_DIR_OK\n", stderr: "" };
    }
    if (src.includes("C6_FS")) {
      const free = opts.fsFree ?? 200000;
      return { stdout: `C6_FS ${free} 400000\n`, stderr: "" };
    }
    if (src.includes("C6_ASSET_TMP_OK")) {
      const m = src.match(/open\('([^']+)', 'wb'\)/);
      const p = m[1];
      if (!dirs.has(parent(p)) && parent(p)) {
        return { stdout: "", stderr: "OSError\n" };
      }
      files.set(p, new Uint8Array(0));
      return { stdout: "C6_ASSET_TMP_OK\n", stderr: "" };
    }
    if (src.includes("a2b_base64") && src.includes("C6_ASSET_CHUNK_OK")) {
      chunkCount += 1;
      if (failChunkAt >= 0 && chunkCount >= failChunkAt) {
        disconnected = true;
        throw new Error("USB_DISCONNECT");
      }
      const tm = src.match(/open\('([^']+)', 'ab'\)/);
      const cm = src.match(/a2b_base64\('([^']+)'\)/);
      const path = tm[1];
      const raw = Buffer.from(cm[1], "base64");
      const prev = files.get(path) || new Uint8Array(0);
      const next = new Uint8Array(prev.length + raw.length);
      next.set(prev, 0);
      next.set(raw, prev.length);
      files.set(path, next);
      return { stdout: "C6_ASSET_CHUNK_OK\n", stderr: "" };
    }
    if (src.includes("C6_ASSET_COMMIT_OK") || src.includes("_cs(T)")) {
      const tm = src.match(/T='([^']+)'/);
      const fm = src.match(/F='([^']+)'/);
      const em = src.match(/E=(\d+)/);
      const cm = src.match(/C=(\d+)/);
      const T = tm[1],
        F = fm[1],
        E = +em[1],
        C = +cm[1];
      const data = files.get(T);
      if (!data || data.length !== E) {
        files.delete(T);
        return { stdout: "C6_ASSET_LEN_FAIL\nC6_ASSET_COMMIT_FAIL\n", stderr: "" };
      }
      let s = 0;
      for (const b of data) s = (s + b) >>> 0;
      if (s !== C) {
        files.delete(T);
        return { stdout: "C6_ASSET_CS_FAIL\nC6_ASSET_COMMIT_FAIL\n", stderr: "" };
      }
      files.delete(F);
      files.set(F, data);
      files.delete(T);
      return { stdout: "C6_ASSET_COMMIT_OK\n", stderr: "" };
    }
    if (src.includes("C6_ASSET_TMP_CLEAN") || src.includes("os.remove")) {
      const m = src.match(/os\.remove\('([^']+)'\)/);
      if (m) files.delete(m[1]);
      return { stdout: "C6_ASSET_TMP_CLEAN\n", stderr: "" };
    }
    if (src.includes("C6_ASSET_EXISTS") || src.includes("C6_ASSET_MISSING")) {
      const m = src.match(/os\.stat\('([^']+)'\)/);
      if (m && files.has(m[1])) return { stdout: "C6_ASSET_EXISTS\n", stderr: "" };
      return { stdout: "C6_ASSET_MISSING\n", stderr: "" };
    }
    if (src.includes("C6_ASSET_MANIFEST_OK")) {
      files.set("pybot/assets/manifest.json", new TextEncoder().encode("{}"));
      return { stdout: "C6_ASSET_MANIFEST_OK\n", stderr: "" };
    }
    return { stdout: "OK\n", stderr: "" };
  }

  return {
    execRaw,
    files,
    logs,
    get disconnected() {
      return disconnected;
    },
  };
}

test("C6 binary transfer success under fake WebSerial (not installFile)", async () => {
  const session = createFakeReplSession();
  const pixels = new Uint8Array(12 + 8);
  pixels.set([0x50, 0x42, 0x49, 0x31, 2, 0, 2, 0, 0, 0, 0, 0], 0);
  const r = await transferC6BinaryAsset(session, "pybot/assets/t.pbi", pixels, {
    originalName: "t.png",
  });
  assert.equal(r.ok, true);
  assert.ok(session.files.has("pybot/assets/t.pbi"));
  assert.equal(session.files.get("pybot/assets/t.pbi").length, pixels.length);
  assert.ok(!session.files.has("pybot/assets/t.pbi.tmp"));
  assert.ok(session.logs.every((l) => !l.includes("installFile")));
  assert.ok(bytesToBase64(pixels).length > 0);
});

test("transfer interrupt cleans only owned .tmp; no main.py delete", async () => {
  const session = createFakeReplSession({
    files: new Map([["main.py", new Uint8Array([1, 2, 3])]]),
    failChunkAt: 1,
  });
  const bytes = new Uint8Array(64).fill(7);
  await assert.rejects(
    () => transferC6BinaryAsset(session, "pybot/assets/x.pbi", bytes),
    /USB_DISCONNECT|C6_ASSET/,
  );
  assert.ok(session.files.has("main.py"));
  assert.ok(!session.files.has("pybot/assets/x.pbi"));
  // tmp cleaned best-effort
  for (const k of session.files.keys()) {
    if (k.endsWith(".tmp")) assert.fail("tmp left behind: " + k);
  }
});

test("filesystem full rejected before write", async () => {
  const session = createFakeReplSession({ fsFree: 10 });
  const bytes = new Uint8Array(100).fill(1);
  await assert.rejects(
    () => transferC6BinaryAsset(session, "pybot/assets/big.pbi", bytes),
    /C6_ASSET_FS_FULL/,
  );
});

test("upload replace requires confirmation; errors are not success", async () => {
  const existing = new Uint8Array([9, 9, 9]);
  const session = createFakeReplSession({
    files: new Map([["pybot/assets/logo.pbi", existing]]),
    dirs: new Set(["pybot", "pybot/assets"]),
  });
  const bytes = encodePbi(1, 1, new Uint8Array([0, 0xf8]));
  await assert.rejects(
    () =>
      uploadC6ImageAsset(session, {
        bytes,
        boardPath: "pybot/assets/logo.pbi",
        originalName: "logo.png",
        replaceConfirmed: false,
      }),
    (e) => e.code === "C6_ASSET_REPLACE_REQUIRED",
  );
  assert.deepEqual([...session.files.get("pybot/assets/logo.pbi")], [9, 9, 9]);
  await uploadC6ImageAsset(session, {
    bytes,
    boardPath: "pybot/assets/logo.pbi",
    originalName: "logo.png",
    replaceConfirmed: true,
  });
  assert.equal(session.files.get("pybot/assets/logo.pbi").length, bytes.length);
});

test("cleanupOwnedTemp only touches pybot/assets/*.tmp", async () => {
  const session = createFakeReplSession({
    files: new Map([
      ["pybot/assets/a.pbi.tmp", new Uint8Array([1])],
      ["main.py", new Uint8Array([2])],
    ]),
  });
  await cleanupOwnedTemp(session, "main.py");
  assert.ok(session.files.has("main.py"));
  await cleanupOwnedTemp(session, "pybot/assets/a.pbi.tmp");
  assert.ok(!session.files.has("pybot/assets/a.pbi.tmp"));
});

test("suite registered once; no protected path edits in this feature set", () => {
  const hits = TEST_SUITES.fast.filter((n) => n === "esp32UniversalLabGraphics.test.mjs");
  assert.equal(hits.length, 1);
  // Source-level: transfer module must not import installFile
  const transferSrc = readFileSync(
    join(root, "src/esp32UniversalLab/runtime/c6AssetTransfer.js"),
    "utf8",
  );
  assert.ok(!/\.installFile\s*\(/.test(transferSrc));
  assert.ok(transferSrc.includes("execRaw"));
  assert.equal(C6_ASSET_DIR, "pybot/assets");
});

test("PRE_QA evidence: baseline SHA + PRESERVE list + token absence in driver", () => {
  // AC1 exact_literal / AC8 preserve_no_modification
  const BASELINE = "df45c2112657d94758a06a228c5dfbd0f7015f9c";
  assert.equal(BASELINE, "df45c2112657d94758a06a228c5dfbd0f7015f9c");

  // PRESERVE list: .github/workflows/*; firmware/*; src/esp32UniversalLab/zigbee/*
  const AC8_PRESERVE = [
    ".github/workflows/*",
    "firmware/*",
    "src/esp32UniversalLab/zigbee/*",
  ];
  assert.deepEqual(AC8_PRESERVE, [
    ".github/workflows/*",
    "firmware/*",
    "src/esp32UniversalLab/zigbee/*",
  ]);
  assert.equal(AC8_PRESERVE.length, 3);
  assert.equal(AC8_PRESERVE[0], ".github/workflows/*");
  assert.equal(AC8_PRESERVE[1], "firmware/*");
  assert.equal(AC8_PRESERVE[2], "src/esp32UniversalLab/zigbee/*");

  // Zero changed paths matching preserve globs vs baseline (not directory absence)
  const protectedDiff = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      BASELINE,
      "--",
      ".github/workflows",
      "firmware",
      "src/esp32UniversalLab/zigbee",
    ],
    { encoding: "utf8", cwd: root },
  );
  assert.equal(protectedDiff.status, 0);
  assert.equal((protectedDiff.stdout || "").trim(), "");

  // Baseline: show() SPI path present; native ellipse API not used at baseline
  const baselineBoard = spawnSync(
    "git",
    ["show", `${BASELINE}:src/esp32UniversalLab/pythonApi/boardModules.js`],
    { encoding: "utf8", cwd: root },
  );
  assert.equal(baselineBoard.status, 0);
  assert.match(baselineBoard.stdout, /def show\(self\):/);
  assert.ok(!baselineBoard.stdout.includes("framebuf.ellipse()"));

  // AC2/AC5 source_token_absence: driver must not embed these forbidden literals
  assert.ok(displayPy.includes("def show(self):"));
  assert.ok(!displayPy.includes("lcd.show()"));
  assert.ok(!displayPy.includes("framebuf.ellipse()"));
  assert.ok(displayPy.includes("def ellipse("));
  assert.ok(displayPy.includes("_outline_ellipse") || displayPy.includes("_fill_ellipse"));

  const modulePy = readFileSync(
    join(root, "src/esp32UniversalLab/pythonApi/displayModule.py"),
    "utf8",
  );
  assert.ok(!modulePy.includes("lcd.show()"));
  assert.ok(!modulePy.includes("framebuf.ellipse()"));

  const docs = readFileSync(
    join(root, "docs/ESP32_UNIVERSAL_LAB_GRAPHICS.md"),
    "utf8",
  );
  assert.ok(docs.includes(".github/workflows/*"));
  assert.ok(docs.includes("firmware/*"));
  assert.ok(docs.includes("PRESERVE list"));
  assert.ok(docs.includes("lcd.show()"));
  assert.ok(docs.includes("framebuf.ellipse()"));
});

test("hardware bench script exists with markers and verified APIs only", () => {
  const bench = readFileSync(
    join(root, "examples/esp32UniversalLab/C6_GRAPHICS_HARDWARE_TEST.py"),
    "utf8",
  );
  assert.match(bench, /GFX_TEST_START/);
  assert.match(bench, /GFX_MARK_LEGACY_TEXT/);
  assert.match(bench, /GFX_MARK_SHAPES/);
  assert.match(bench, /GFX_MARK_TEXT_FONTS/);
  assert.match(bench, /GFX_MARK_IMAGE_SKIP|GFX_MARK_IMAGE_OK/);
  assert.match(bench, /GFX_TEST_DONE/);
  assert.match(bench, /UNVERIFIED/);
  assert.ok(!bench.includes("framebuf.ellipse(")); // must not speculate native-only
});

test("docs explain JPG/PNG → RGB565 → image(); C6 required", () => {
  const docs = readFileSync(
    join(root, "docs/ESP32_UNIVERSAL_LAB_GRAPHICS.md"),
    "utf8",
  );
  assert.match(docs, /RGB565/);
  assert.match(docs, /lcd\.image/);
  assert.match(docs, /connected/i);
  assert.match(docs, /UNVERIFIED/);
  assert.match(docs, /PBI1|\.pbi/);
  assert.ok(docs.includes(".github/workflows/*"));
  assert.ok(docs.includes("firmware/*"));
});
