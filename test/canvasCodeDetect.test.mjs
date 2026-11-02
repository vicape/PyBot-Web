import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCanvasCode } from "../src/canvasCodeDetect.js";
import { requiresMicroPythonRuntime } from "../src/esp32/micropythonRuntimeDetect.js";
import { resolveEsp32ExecutionTarget } from "../src/esp32RunTarget.js";

const lcdProgram = `
# Prueba LCD ST7789, 240x240
class PantallaST7789:
    def __init__(self):
        from machine import Pin, SPI
        self.spi = SPI(2, sck=Pin(38), mosi=Pin(39))
    def texto(self, mensaje, x, y, color, fondo, escala=2):
        import framebuf
        return mensaje

print('Inicializando pantalla ST7789...')
lcd = PantallaST7789()
lcd.texto('PYBOT', 80, 24, 0xFFFF, 0x0000, 2)
lcd.texto('ESP32-S3', 56, 61, 0xFFFF, 0x0000, 2)
lcd.texto('LCD OK', 72, 191, 0xFFFF, 0x0000, 2)
`;

test("Waveshare ESP32-S3 ST7789 method texto is NOT a browser Canvas call", () => {
  assert.equal(hasCanvasCode(lcdProgram), false);
  assert.equal(requiresMicroPythonRuntime(lcdProgram), true);
  const route = resolveEsp32ExecutionTarget({
    boardType: "esp32-s3-micropython",
    pythonOnly: true,
    needsHardware: requiresMicroPythonRuntime(lcdProgram),
    canvasCode: hasCanvasCode(lcdProgram),
    usbConnected: true,
    bleConnected: false,
  });
  assert.deepEqual(route, { target: "board", switchToHardwareMode: true });
});

test("LCD code without USB requires connection, never tries Pyodide", () => {
  const route = resolveEsp32ExecutionTarget({
    boardType: "esp32-s3-micropython",
    pythonOnly: true,
    needsHardware: requiresMicroPythonRuntime(lcdProgram),
    canvasCode: hasCanvasCode(lcdProgram),
    usbConnected: false,
    bleConnected: false,
  });
  assert.equal(route.target, "needConnect");
});

test("object methods, function definitions, docstrings and comments aren't Canvas", () => {
  for (const source of [
    'lcd.texto("hola", 0, 0)',
    'lcd . texto("hola", 0, 0)',
    'self.fill(0xFFFF)',
    'self.pantalla(1)',
    'def texto(self, mensaje):\n    return mensaje',
    'async def actualizar(self):\n    return',
    'class LCD:\n    def texto(self):\n        pass',
    'print("texto(\'Hola\', 10, 10)")',
    'print("dibujar_rect(1, 2)")',
    '# texto("hola")',
    '"""draw_rect(0, 0, 5, 5)"""\nprint("hola")',
  ]) assert.equal(hasCanvasCode(source), false, source);
});

test("real unqualified Canvas API calls are still detected", () => {
  for (const source of [
    'pantalla(240, 240)',
    'fondo("azul")',
    'texto("hola", 10, 20)',
    'dibujar_rect(0, 0, 100, 50)',
    'draw_rect(0, 0, 100, 50)',
    'fill("blue")',
    'screen(200, 150)',
    'print(texto("hello", 5, 6))',
    '  actualizar( )',
  ]) assert.equal(hasCanvasCode(source), true, source);
});

test("mixed MicroPython and genuine Canvas calls remain blocked from boards", () => {
  const source = 'from machine import SPI\ntexto("Canvas real", 0, 0)';
  assert.equal(hasCanvasCode(source), true);
  const result = resolveEsp32ExecutionTarget({
    boardType: "esp32-s3-micropython",
    pythonOnly: false,
    needsHardware: true,
    canvasCode: hasCanvasCode(source),
    usbConnected: true,
    bleConnected: false,
  });
  assert.equal(result.target, "fallback");
});

test("repeat tests do not depend on RegExp.lastIndex or global state", () => {
  assert.equal(hasCanvasCode('lcd.texto("hola")'), false);
  assert.equal(hasCanvasCode('texto("hola")'), true);
  assert.equal(hasCanvasCode('lcd.texto("hola")'), false);
  assert.equal(hasCanvasCode('texto("hola")'), true);
});
