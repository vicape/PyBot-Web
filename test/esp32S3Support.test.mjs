import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

import {ESP32_S3_MICROPYTHON,isEsp32S3Board,isEsp32MicroPythonBoard,isEsp32Board}
  from "../src/esp32/boardTypes.js";
import {resolveEsp32ExecutionTarget} from "../src/esp32RunTarget.js";
import {isClassicEsp32Chip,ESP32_GENERIC_FIRMWARE} from "../src/esp32/firmwareManifest.js";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(join(root,path),"utf8");
const s3=ESP32_S3_MICROPYTHON;

test("S3 gets its own board identity without altering classic ESP32 or EDA6",()=>{
  assert.equal(isEsp32S3Board(s3),true);
  assert.equal(isEsp32S3Board("esp32-micropython"),false);
  assert.equal(isEsp32MicroPythonBoard(s3),true);
  for(const type of ["esp32-micropython","esp32-eda6",s3])assert.equal(isEsp32Board(type),true,type);
  for(const type of ["arduino-firmata","esp32-serial","",null])assert.equal(isEsp32Board(type),false);
});

test("ESP32-S3 hardware Python never falls back silently to Pyodide",()=>{
  const offline=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,needsHardware:true,usbConnected:false,bleConnected:false,
  });
  assert.deepEqual(offline,{target:"needConnect",switchToHardwareMode:false});
  const connected=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,needsHardware:true,usbConnected:true,bleConnected:false,
  });
  assert.deepEqual(connected,{target:"board",switchToHardwareMode:true});
  const pure=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:true,needsHardware:false,usbConnected:true,bleConnected:false,
  });
  assert.equal(pure.target,"pyodide");
});

test("classic firmware is never considered a valid S3 image",()=>{
  assert.equal(isClassicEsp32Chip("ESP32-S3"),false);
  assert.equal(ESP32_GENERIC_FIRMWARE.board,"ESP32_GENERIC");
  assert.equal(ESP32_GENERIC_FIRMWARE.flashOffset,0x1000);
  const bridge=read("src/hardwareBridge.js");
  assert.match(bridge,/if \(isEsp32S3Board\(getBoardType\(\)\)\)/);
  assert.match(bridge,/PROVISION_ERROR\.VARIANT_UNSUPPORTED/);
  assert.match(bridge,/isEsp32MicroPythonBoard\(_mode\)/);
});

test("S3 is visible for USB and autonomous deployment, but not auto-flash or untested BLE",()=>{
  const ide=read("src/PyBotIDE.jsx");
  assert.match(ide,/<option value="esp32-s3-micropython">/);
  assert.match(ide,/boardEsp32S3Hint/);
  assert.match(ide,/isEsp32S3Board\(boardType\) && connected/);
  assert.match(ide,/showPrepareEsp32=\{boardType === "esp32-micropython" \|\| boardType === "esp32-eda6"\}/);
  assert.match(ide,/if \(isEsp32S3Board\(boardType\)\) return; \/\/ S3 BLE firmware not physically validated/);
  assert.match(read("src/hardwareBridge.js"),/if \(isEsp32MicroPythonBoard\(boardType\)\)/);
});

test("Waveshare S3 network examples are available without extra project dependencies",()=>{
  const examples=read("src/examplesData.js");
  assert.match(examples,/esp32_wifi_http[\s\S]*?boards: \["esp32-micropython", "esp32-s3-micropython", "esp32-eda6"\]/);
  assert.match(examples,/esp32_google_sheets[\s\S]*?boards: \["esp32-micropython", "esp32-s3-micropython", "esp32-eda6"\]/);
});
