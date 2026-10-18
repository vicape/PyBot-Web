# ESP32 Universal Lab — C6 graphics layer (shapes, text, images)

**Branch:** `feature/esp32-universal-lab`  
**Baseline:** `20a08f7db07e53c50ffc905661911a2706b38133` (ST7789/graphics lock for this branch)
**Board:** Waveshare ESP32-C6-LCD-1.47 (ST7789 172×320, stock MicroPython 1.27.0)  
**Physical LCD / USB transfer / font visibility / memory safety:** **UNVERIFIED** (operator bench required)

## PRE_QA acceptance literals (exact)

Scope paths (in scope): `src/esp32UniversalLab/graphics/*`; `src/esp32UniversalLab/runtime/c6AssetTransfer.js`; additive `pybot.display` in `src/esp32UniversalLab/pythonApi/boardModules.js`.

PRESERVE list: `.github/workflows/*`; `src/esp32UniversalLab/pythonApi/displayPySource.js`; `src/esp32UniversalLab/pythonApi/displayModule.py`; `src/esp32UniversalLab/graphics/*`
Zero changed paths matching those globs vs the graphics baseline (ST7789 driver must remain untouched). Later MicroPython+Zigbee work may add under `firmware/pybot-c6-micropython-zigbee/` and extend `src/esp32UniversalLab/zigbee/` without rewriting the LCD driver.

Baseline evidence (`20a08f7db07e53c50ffc905661911a2706b38133`):
- `lcd.show()` — documented user refresh call; driver keeps `def show(self):` SPI window/offset/`self.buffer` path (token `lcd.show()` is intentionally **absent** from driver source; examples/docs use it).
- `framebuf.ellipse()` — **absent** at baseline and **absent** from driver source; ellipse uses Python midpoint/scanline fallback only (must not assume `framebuf.ellipse()` exists).

API class: `pybot.display.Lcd`

Exact method signatures (additive extensions; do not assume `framebuf.ellipse()` exists — use Python fallback only):

- `line(x1,y1,x2,y2,color)`
- `rectangle(x,y,width,height,color,fill=False)`
- `circle(cx,cy,radius,color,fill=False)`
- `ellipse(cx,cy,rx,ry,color,fill=False)`
- `triangle(x1,y1,x2,y2,x3,y3,color,fill=False)`
- `polygon(points,color,fill=False)`

Exact extended text call:

`lcd.text("Hello PyBot",20,40,color=0xFFFF,size=2,font="mono",bold=True,italic=False,underline=False,align="center",background=None)`

## Pipeline (images)

1. Student selects a **PNG or JPG** in the Universal Lab C6 board menu (browser only — no server upload).
2. Browser JavaScript validates MIME/signature, resizes/crops, and converts pixels to **RGB565 little-endian** matching MicroPython `framebuf.RGB565` on ESP32.
3. Bytes are wrapped as **PBI1** (`.pbi`) and transferred over the **existing** C6 WebSerial REPL session (chunked base64 → temp → length+checksum → rename). Legacy `MicroPythonSession.installFile` is **not** used.
4. On device: `lcd.image("logo.png", x, y)` resolves the alias via `pybot/assets/manifest.json` (or stem mapping) to `pybot/assets/logo.pbi`, streams rows into the **single** framebuffer, then `lcd.show()`.

The MCU **does not** decode PNG/JPEG.

### Color order

JS writes RGB565 **LE** to match `framebuf.RGB565` buffer layout. Panel SPI color appearance after `Lcd.show` remains **UNVERIFIED** until a physical red/green/blue/black/white/checkerboard bench.

### Space limits (two bounded profiles)

| Profile | Geometry bound | Encoded max | Use |
|---|---|---|---|
| **icon** (default) | longest edge ≤ 128 (UI default 96) | `12 + 128×128×2` = 32780 B | icons / demos |
| **fullscreen** | fit inside **172×320** | `12 + 172×320×2` = **110092 B** | photographs covering the panel |

**Why fullscreen is implemented (not DEFERRED):** flash holds the `.pbi` on disk; transfer is chunked base64 (768 chars) with length+checksum; `lcd.image()` streams **one row** (≤ 344 B) into the **existing** 110080-byte framebuffer — no second display-sized RAM allocation. Upload still probes `os.statvfs` free space and refuses when free &lt; need+512. Multiple full-screen assets can exhaust the 4MB filesystem; that is a storage limit, not a heap OOM from a second framebuffer.

- C6: 4MB flash, **no PSRAM**; framebuffer is already 110080 bytes — no second full-screen buffer is allocated.
- Transfers require a **connected** C6 lab session.
- Physical USB transfer / live heap / panel color order: **UNVERIFIED** until operator bench.

## Python API (`pybot.display`)

```python
from pybot.display import Lcd, color, init

lcd = init()  # or Lcd()
lcd.fill(0x0000)
lcd.line(0, 0, 50, 50, 0xFFFF)
lcd.rectangle(10, 10, 40, 30, color(255, 0, 0), fill=True)
lcd.circle(80, 80, 20, 0x07E0, fill=False)
lcd.ellipse(80, 160, 30, 15, 0x001F, fill=True)
lcd.triangle(10, 200, 60, 200, 35, 240, 0xFFE0, fill=True)
lcd.polygon([(5, 5), (40, 5), (20, 30)], 0xF81F, fill=False)

# Legacy text (native 8×8): size=1 means 8px height
lcd.text("Hello", 10, 20, 0xFFFF)

# Extended typography (fonts: mono | sans — bundled bitmaps only)
lcd.text(
    "Hello PyBot",
    20, 40,
    color=0xFFFF,
    size=2,
    font="mono",
    bold=True,
    italic=False,
    underline=False,
    align="center",
    background=None,
)

lcd.image("logo.png", 20, 30)  # maps to .pbi on board
lcd.show()
```

`color(r,g,b)` → `((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3)`. Integer RGB565 remains the default.

Spanish accents / `ñ` / `¿` / `¡` are supported only where glyphs are bundled; other non-ASCII falls back to `?` without crashing.

## Hardware bench

See `examples/esp32UniversalLab/C6_GRAPHICS_HARDWARE_TEST.py` (serial markers + expected screen sequence). Cloud CI cannot assert physical correctness.

**On-device checklist (operator):**
1. Flash/install stock MicroPython 1.27.0 if needed (out of scope for this feature — do not erase user `main.py`).
2. Connect C6 in Universal Lab → Install/Recover pybot modules.
3. Run the bench script; confirm serial markers `GFX_TEST_START` … `GFX_TEST_DONE`.
4. Optional: Lab menu → Import image → choose icon **or** full-screen profile → `lcd.image("…", x, y)` + `lcd.show()`.
5. Record panel color order (R/G/B/black/white) — until then treat as **UNVERIFIED**.
