import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

import {ESP32_S3_MICROPYTHON,isEsp32S3Board,isEsp32MicroPythonBoard,isEsp32Board}
  from "../src/esp32/boardTypes.js";
import {resolveEsp32ExecutionTarget} from "../src/esp32RunTarget.js";
import {boardLabelKey} from "../src/connectUsbAssistant.js";
import {formatHardwareError} from "../src/i18n.js";
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
  const staleBle=resolveEsp32ExecutionTarget({
    boardType:s3,pythonOnly:false,needsHardware:true,usbConnected:false,bleConnected:true,
  });
  assert.equal(staleBle.target,"needConnect");
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
  assert.match(bridge,/return runS3Provisioning\(/);
  assert.match(bridge,/expectedChip:"ESP32-S3"/);
  assert.match(bridge,/isEsp32MicroPythonBoard\(_mode\)/);
});

test("S3 exposes integrated firmware installer but keeps BLE actions disabled",()=>{
  const ide=read("src/PyBotIDE.jsx");
  assert.match(ide,/<option value="esp32-s3-micropython">/);
  assert.match(ide,/boardEsp32S3Prepare/);
  assert.match(ide,/isEsp32S3Board\(boardType\) && connected/);
  assert.match(ide,/showPrepareEsp32=\{isEsp32Board\(boardType\)\}/);
  assert.match(ide,/if \(isEsp32S3Board\(boardType\)\) return; \/\/ S3 BLE firmware not physically validated/);
  assert.match(read("src/hardwareBridge.js"),/if \(isEsp32MicroPythonBoard\(boardType\)\)/);
});

test("S3 has a native Wi-Fi example without depending on the PyBot BLE runtime",()=>{
  const examples=read("src/examplesData.js");
  assert.match(examples,/id: "esp32_s3_wifi_native"/);
  assert.match(examples,/boards: \["esp32-s3-micropython"\]/);
  assert.match(examples,/network\.WLAN\(network\.STA_IF\)/);
  assert.match(examples,/wlan\.ifconfig\(\)/);
  // Classic ESP32 examples do not become S3-only.
  assert.match(examples,/id: "esp32_wifi_http"[\s\S]*?boards: \["esp32-micropython", "esp32-eda6"\]/);
});

test("S3 non-response does not claim missing firmware or recommend classic flash",()=>{
  assert.equal(boardLabelKey(s3),"boardEsp32S3");
  const actual=formatHardwareError("PYBOT_MPY:NEEDS_PREP",s3);
  const classic=formatHardwareError("PYBOT_MPY:NEEDS_PREP","esp32-micropython");
  assert.notEqual(actual,classic);
  assert.match(actual,/MicroPython/);
  assert.match(actual,/ESP32-S3/);
  assert.doesNotMatch(actual,/Usá «Preparar ESP32»|Use “Prepare ESP32”/);
  const ide=read("src/PyBotIDE.jsx");
  assert.match(ide,/formatHardwareError\(e\?\.message, boardType\)/);
  assert.match(ide,/setConnectHighlightPrepare\(!isEsp32S3Board\(boardType\)/);
});

test("S3 installer is integrated in PyBot, pins image SHA-256 and requires explicit erase consent",async()=>{
  const {ESP32_S3_OCTAL_FIRMWARE: fw, assertS3FirmwareManifest}=await import("../src/esp32/s3FirmwareManifest.js");
  assert.equal(assertS3FirmwareManifest(fw),fw);
  assert.equal(fw.board,"ESP32_GENERIC_S3-SPIRAM_OCT");
  assert.equal(fw.flashOffset,0);
  assert.equal(fw.flashSize,"16MB");
  assert.equal(fw.sha256,"ab24eadfe3ef0e6ee38834d730e648def7cd82f3fa51ee0bbc59c29a6e1bd176");
  assert.equal(fw.size,1786704);
  assert.throws(()=>assertS3FirmwareManifest({...fw,sha256:""}));
  const ide=read("src/PyBotIDE.jsx");
  assert.match(ide,/boardEsp32S3Prepare/);
  assert.match(ide,/onClick=\{\(\) => \{ openPrepareEsp32\(\)/);
  assert.match(read("src/ConnectUsbModal.jsx"),/boardType === "esp32-s3-micropython"/);
  const modal=read("src/PrepareEsp32Modal.jsx");
  assert.match(modal,/isS3 \? "boardEsp32S3Confirm"/);
  assert.match(modal,/phase === PHASE.ALREADY_PREPARED && !isS3/);
  const bridge=read("src/hardwareBridge.js");
  assert.match(bridge,/return runS3Provisioning\(/);
  assert.match(bridge,/expectedChip:"ESP32-S3"/);
  assert.match(read("src/esp32/esp32Flasher.js"),/expectedChip==="ESP32-S3"/);
  assert.match(read("vercel.json"),/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin/);
  assert.equal(fw.originFile,"https://micropython.org/resources/firmware/"+fw.filename);
  assert.equal(ESP32_GENERIC_FIRMWARE.flashOffset,0x1000);
});
