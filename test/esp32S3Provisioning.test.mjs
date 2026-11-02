import {test} from "node:test";
import assert from "node:assert/strict";
import {runS3Provisioning} from "../src/esp32/s3Provisioning.js";
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
  assert.equal(r.boardState,BOARD_STATE.READY);
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
