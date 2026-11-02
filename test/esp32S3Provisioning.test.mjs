import {test} from "node:test";
import assert from "node:assert/strict";
import {runS3Provisioning} from "../src/esp32/s3Provisioning.js";
import {connectBootloader,writeFirmware} from "../src/esp32/esp32Flasher.js";
import {ESP32_S3_OCTAL_FIRMWARE} from "../src/esp32/s3FirmwareManifest.js";
import {BOARD_STATE,PHASE,PROVISION_ERROR} from "../src/esp32/provisioningPhases.js";

function harness({already=false,consent=true,chip="ESP32-S3",hashOk=true,replOk=true}={}){
  const calls={requested:0,probe:0,boot:0,load:0,erase:0,write:0,reset:0,repl:0,
    close:0,adopt:0,confirmed:0,phases:[]};
  const session={close:async()=>{calls.close++;}};
  const adapters={
    requestPort:async()=>{calls.requested++;return {id:"dummy-port"};},
    probeRepl:async()=>{
      calls.probe++;
      if(already)return {session};
      throw new Error("NEEDS_PREP");
    },
    ensurePortClosed:async()=>{calls.close++;},
    keepSession:s=>{assert.equal(s,session);calls.adopt++;},
    connectBootloader:async()=>{calls.boot++;if(chip!=="ESP32-S3"){
      const e=new Error(PROVISION_ERROR.VARIANT_UNSUPPORTED);
      e.code=PROVISION_ERROR.VARIANT_UNSUPPORTED;e.chipName=chip;throw e;
    }return {chipName:chip};},
    loadFirmware:async()=>{
      calls.load++;
      if(!hashOk)throw new Error(PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
      return {bytes:new Uint8Array(64),sha256:"a".repeat(64),manifest:{flashOffset:0}};
    },
    eraseFlash:async()=>{calls.erase++;},
    writeFirmware:async(ctx,bytes,{manifest,onProgress})=>{
      calls.write++;assert.equal(ctx.chipName,chip);
      assert.equal(manifest.flashOffset,0);
      onProgress({pct:100,bytesWritten:bytes.length,bytesTotal:bytes.length});
    },
    resetAndRelease:async()=>{calls.reset++;},
    connectRepl:async()=>{calls.repl++;if(!replOk)throw Error("REPL_TIMEOUT");
      return {session};},
  };
  const options={
    confirmFlash:async()=>{calls.confirmed++;return consent;},
    onPhase:ev=>calls.phases.push(ev.phase),
    onLog:()=>{},
  };
  return {calls,adapters,options};
}
test("installed MicroPython S3 stays intact (no wipe, image fetch or confirmation)",async()=>{
  const h=harness({already:true});
  const result=await runS3Provisioning(h.adapters,h.options);
  assert.equal(result.ok,true);
  assert.equal(result.alreadyPrepared,true);
  assert.equal(result.phase,PHASE.READY);
  assert.equal(h.calls.erase,0);
  assert.equal(h.calls.write,0);
  assert.equal(h.calls.boot,0);
  assert.equal(h.calls.load,0);
  assert.equal(h.calls.adopt,1);
  assert.equal(h.calls.confirmed,0);
  assert.equal(h.calls.close,0);
});
test("canceling consent cannot erase or load firmware",async()=>{
  const h=harness({consent:false});
  const result=await runS3Provisioning(h.adapters,h.options);
  assert.equal(result.ok,false);
  assert.equal(result.phase,PHASE.CANCELLED);
  assert.equal(h.calls.confirmed,1);
  assert.equal(h.calls.boot,0);
  assert.equal(h.calls.erase,0);
  assert.equal(h.calls.write,0);
});
test("missing confirmation adapter cannot auto erase",async()=>{
  const h=harness();delete h.options.confirmFlash;
  const r=await runS3Provisioning(h.adapters,h.options);
  assert.equal(r.phase,PHASE.CANCELLED);
  assert.equal(h.calls.erase,0);
});
test("wrong ROM chip stops BEFORE firmware download, erase or write",async()=>{
  const h=harness({chip:"ESP32"});
  const r=await runS3Provisioning(h.adapters,h.options);
  assert.equal(r.ok,false);
  assert.equal(r.error,PROVISION_ERROR.VARIANT_UNSUPPORTED);
  assert.equal(h.calls.load,0);assert.equal(h.calls.erase,0);
  assert.equal(h.calls.write,0);
});
test("firmware integrity failure stops BEFORE erase",async()=>{
  const h=harness({hashOk:false});
  const r=await runS3Provisioning(h.adapters,h.options);
  assert.equal(r.ok,false);
  assert.equal(h.calls.boot,1);
  assert.equal(h.calls.load,1);
  assert.equal(h.calls.erase,0);
  assert.equal(h.calls.write,0);
  assert.equal(r.error,PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
});
test("verified image is flashed and live USB REPL retained only after success",async()=>{
  const h=harness();
  const r=await runS3Provisioning(h.adapters,h.options);
  assert.equal(r.ok,true);
  assert.equal(r.phase,PHASE.READY);
  assert.equal(r.flashed,true);
  assert.equal(r.boardState,BOARD_STATE.MPY_ONLY);
  assert.equal(h.calls.confirmed,1);
  assert.equal(h.calls.erase,1);
  assert.equal(h.calls.write,1);
  assert.equal(h.calls.reset,1);
  assert.equal(h.calls.adopt,1);
  assert.ok(h.calls.phases.includes(PHASE.FLASHING));
  assert.ok(h.calls.phases.includes(PHASE.VERIFYING_IMAGE_HASH));
  assert.ok(h.calls.phases.includes(PHASE.WAITING_REPL));
  assert.equal(h.calls.close,1); // only pre-flash port close; active REPL retained
});
test("post-flash REPL timeout does not claim READY or attempt another erase",async()=>{
  const h=harness({replOk:false});
  const r=await runS3Provisioning(h.adapters,h.options);
  assert.equal(r.ok,false);
  assert.equal(r.phase,PHASE.RESET_REQUIRED);
  assert.equal(r.flashed,true);
  assert.equal(h.calls.erase,1);
  assert.equal(h.calls.write,1);
  assert.equal(h.calls.adopt,0);
});

test("actual esptool chip gate accepts S3 only in S3 mode, never in classic mode",async()=>{
  function fake(chip){
    const changes={disconnect:0,hardReset:0};
    class Transport{
      constructor(port){assert.equal(port,"usb");}
      async disconnect(){changes.disconnect++;}
    }
    class ESPLoader{
      constructor({transport}){this.chip={CHIP_NAME:chip};this.transport=transport;}
      async main(){return chip;}
      async after(){changes.hardReset++;}
    }
    return {changes,esptool:{Transport,ESPLoader}};
  }
  const s3=fake("ESP32-S3");
  const ctx=await connectBootloader("usb",{expectedChip:"ESP32-S3",esptool:s3.esptool});
  assert.equal(ctx.chipName,"ESP32-S3");
  assert.equal(s3.changes.disconnect,0);
  const wrongClassic=fake("ESP32");
  await assert.rejects(()=>connectBootloader("usb",{expectedChip:"ESP32-S3",esptool:wrongClassic.esptool}),
    err=>err.code===PROVISION_ERROR.VARIANT_UNSUPPORTED);
  assert.equal(wrongClassic.changes.disconnect,1);
  const wrongS3=fake("ESP32-S3");
  await assert.rejects(()=>connectBootloader("usb",{esptool:wrongS3.esptool}),
    err=>err.code===PROVISION_ERROR.VARIANT_UNSUPPORTED);
  assert.equal(wrongS3.changes.disconnect,1);
  const classic=fake("ESP32");
  const unchanged=await connectBootloader("usb",{esptool:classic.esptool});
  assert.equal(unchanged.chipName,"ESP32");
});

test("actual esptool writer receives only S3 manifest address 0x0 and MD5 verifier",async()=>{
  let options;
  const image=new Uint8Array([0xE9,2,3,4]);
  await writeFirmware({loader:{writeFlash:async opts=>{options=opts;}}},image,
    {manifest:ESP32_S3_OCTAL_FIRMWARE});
  assert.equal(options.fileArray[0].address,0);
  assert.equal(options.flashSize,"16MB");
  assert.equal(options.flashMode,"dio");
  assert.equal(typeof options.calculateMD5Hash,"function");
});
