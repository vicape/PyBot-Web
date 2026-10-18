# C6_GRAPHICS_HARDWARE_TEST.py — Waveshare ESP32-C6-LCD-1.47 bench script
# Uses only verified pybot.display APIs. Physical results: UNVERIFIED in cloud.
# Expected sequence + serial markers (watch USB REPL):
#   GFX_TEST_START → fill/text legacy → shapes → text styles/fonts → image → GFX_TEST_DONE

from pybot.display import Lcd, color
import os

lcd = Lcd()
print("GFX_TEST_START")

# 1) Legacy fill + text (native 8x8)
lcd.fill(0x0000)
lcd.text("Hello", 10, 20, 0xFFFF)
lcd.show()
print("GFX_MARK_LEGACY_TEXT")

# 2) Shape outlines + fills
lcd.fill(0x0000)
lcd.line(0, 0, 171, 40, color(255, 255, 255))
lcd.rectangle(8, 50, 60, 40, color(255, 0, 0), fill=False)
lcd.rectangle(80, 50, 60, 40, color(0, 255, 0), fill=True)
lcd.circle(40, 140, 22, color(0, 0, 255), fill=False)
lcd.circle(120, 140, 22, color(255, 255, 0), fill=True)
lcd.ellipse(86, 200, 50, 20, color(255, 0, 255), fill=False)
lcd.triangle(20, 250, 70, 250, 45, 300, color(0, 255, 255), fill=True)
lcd.show()
print("GFX_MARK_SHAPES")

# 3) Text at two sizes + two real fonts (mono + sans)
lcd.fill(0x0000)
lcd.text("mono1", 4, 10, color=0xFFFF, size=1, font="mono")
lcd.text("mono2", 4, 30, color=0xFFFF, size=2, font="mono", bold=True)
lcd.text("sans1", 4, 60, color=0x07E0, size=1, font="sans")
lcd.text("sans2", 4, 80, color=0x07E0, size=2, font="sans", underline=True)
lcd.text("Espana", 86, 120, color=0xFFFF, size=1, font="mono", align="center")
lcd.show()
print("GFX_MARK_TEXT_FONTS")

# 4) Imported image (skip explicitly if none uploaded)
img_name = "logo.png"
candidates = (
    "pybot/assets/logo.pbi",
    "pybot/assets/manifest.json",
)
has_asset = False
for p in candidates:
    try:
        os.stat(p)
        has_asset = True
        break
    except OSError:
        pass

if has_asset:
    lcd.fill(0x0000)
    try:
        lcd.image(img_name, 20, 30)
        lcd.show()
        print("GFX_MARK_IMAGE_OK")
    except OSError as e:
        print("GFX_MARK_IMAGE_FAIL:" + str(e))
else:
    print("GFX_MARK_IMAGE_SKIP:no uploaded asset (use Lab image import first)")

print("GFX_TEST_DONE")
# Screen sequence (operator): black+Hello → shapes → dual fonts → optional image
# Color order / memory / USB transfer / full-screen photo: UNVERIFIED until real C6 bench
# Full-screen import: Lab confirm → profile fullscreen ≤172x320 (~110092 B PBI1)
