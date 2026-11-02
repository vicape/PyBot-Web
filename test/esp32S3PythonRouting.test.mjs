import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {requiresMicroPythonRuntime} from "../src/esp32/micropythonRuntimeDetect.js";
import {resolveEsp32ExecutionTarget} from "../src/esp32RunTarget.js";

const s3="esp32-s3-micropython";
const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../src/PyBotIDE.jsx"),"utf8");
const sample=`class PantallaST7789:
    def __init__(self):
        from machine import Pin, SPI
        self.spi = SPI(2, sck=Pin(38), mosi=Pin(39))
    def texto(self):
        import framebuf
print("Inicializando pantalla ST7789...")
lcd = PantallaST7789()
`;
test("the user's Waveshare ST7789 program requires real ESP32 MicroPython",()=>{
  assert.equal(requiresMicroPythonRuntime(sample),true);
  assert.match(source,/isEsp32S3Board\(boardType\) && requiresMicroPythonRuntime\(activeCode\)/);
  const target=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,
    needsHardware:requiresMicroPythonRuntime(sample),
    usbConnected:true,bleConnected:false,
  });
  assert.deepEqual(target,{target:"board",switchToHardwareMode:true});
});
test("with S3 disconnected, MicroPython imports cannot silently run in Pyodide",()=>{
  const target=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,
    needsHardware:requiresMicroPythonRuntime(sample),
    usbConnected:false,bleConnected:false,
  });
  assert.equal(target.target,"needConnect");
});
test("hardware imports include common MicroPython spellings",()=>{
  for(const s of [
    "import machine",
    "import os, machine as hw",
    "from machine import Pin, SPI",
    "from machine import I2C",
    "import framebuf",
    "import network",
    "import esp32",
    "import neopixel",
    "import micropython",
    "import urequests as requests",
  ])assert.equal(requiresMicroPythonRuntime(s),true,s);
});
test("ordinary Python in Solo Python mode continues to run in browser",()=>{
  for(const s of [
    'print("Hola mundo")',
    "import math\nprint(math.pi)",
    "for i in range(5):\n    print(i)",
    "# from machine import Pin\nprint('hello')",
  ])assert.equal(requiresMicroPythonRuntime(s),false,s);
  const pure=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,needsHardware:requiresMicroPythonRuntime('print("Hola")'),
    usbConnected:true,bleConnected:false,
  });
  assert.equal(pure.target,"pyodide");
});
test("other board profiles preserve their existing routing behavior",()=>{
  for(const boardType of ["esp32-micropython","esp32-eda6"]){
    const target=resolveEsp32ExecutionTarget({
      boardType,pythonOnly:true,needsHardware:false,
      usbConnected:true,bleConnected:false,
    });
    assert.equal(target.target,"pyodide",boardType);
  }
});
