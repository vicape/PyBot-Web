/**
 * Independent ESP32-S3 firmware provisioning. Uses existing PyBot Web Serial,
 * esptool-js and REPL primitives but never installs classic-ESP32/BLE firmware.
 * The factory application can be erased ONLY by an explicit confirmation.
 */
import {PHASE, BOARD_STATE, PROVISION_ERROR} from "./provisioningPhases.js";

function fail(code,cause){
  const err=new Error(code);
  err.code=code;
  if(cause)err.cause=cause;
  return err;
}

export async function runS3Provisioning(adapters,options={}){
  let phase=PHASE.IDLE,port=null,ctx=null,session=null,flashed=false;
  const onLog=options.onLog||(()=>{});
  const emit=(next,info={})=>{phase=next;options.onPhase?.({phase,...info});};
  const checkAbort=()=>{if(options.signal?.aborted)throw fail(PROVISION_ERROR.CANCELLED);};
  const close=async()=>{
    if(session){try{await session.close();}catch{/* already closed */}session=null;}
    if(ctx){try{await adapters.resetAndRelease(ctx);}catch{/* cleanup */}ctx=null;}
    if(port)try{await adapters.ensurePortClosed(port);}catch{/* disconnected */}
  };
  const status=(ok,error)=>({ok,phase,error,flashed,
    boardState:ok?BOARD_STATE.MPY_ONLY:flashed?BOARD_STATE.RESET_REQUIRED:BOARD_STATE.UNKNOWN});

  try{
    emit(PHASE.SELECTING_PORT);
    checkAbort();
    try{port=await adapters.requestPort();}
    catch(e){
      if(e?.name==="NotFoundError")return {ok:false,phase:PHASE.CANCELLED,error:PROVISION_ERROR.PORT_CANCELLED};
      if(e?.name==="SecurityError")throw fail(PROVISION_ERROR.PORT_PERMISSION,e);
      throw e;
    }
    if(!port)return {ok:false,phase:PHASE.CANCELLED,error:PROVISION_ERROR.PORT_CANCELLED};
    emit(PHASE.PROBING);
    onLog("[S3] checking MicroPython before changing the device");
    try{
      const probe=await adapters.probeRepl(port);
      session=probe.session;
      if(session){
        emit(PHASE.ALREADY_PREPARED,{boardState:BOARD_STATE.MPY_ONLY});
        // Preserve the working connection and its firmware: no flash or erasure.
        adapters.keepSession(session);
        session=null;
        port=null; // live USB connection now owns port
        return {ok:true,phase:PHASE.READY,alreadyPrepared:true,flashed:false,boardState:BOARD_STATE.MPY_ONLY};
      }
    }catch(e){
      if(e?.message==="BUSY"||e?.code==="BUSY")throw fail(PROVISION_ERROR.BUSY,e);
      onLog("[S3] MicroPython REPL unavailable; will verify ROM chip before any flash");
    }
    checkAbort();
    emit(PHASE.CONFIRM_FLASH,{boardState:BOARD_STATE.REPL_UNAVAILABLE});
    // Never auto-confirm: even an unresponsive REPL is not proof of empty flash.
    if(typeof options.confirmFlash!=="function"||await options.confirmFlash()!==true){
      emit(PHASE.CANCELLED);
      return status(false,PROVISION_ERROR.CANCELLED);
    }
    checkAbort();
    await adapters.ensurePortClosed(port);
    emit(PHASE.CONNECTING_BOOTLOADER);
    try{ctx=await adapters.connectBootloader(port);}
    catch(e){
      emit(e?.code===PROVISION_ERROR.VARIANT_UNSUPPORTED
        ? PHASE.UNSUPPORTED_VARIANT:PHASE.NEED_BOOT_BUTTON,{chipName:e?.chipName});
      throw e;
    }
    emit(PHASE.IDENTIFYING_CHIP,{chipName:ctx.chipName});
    if(!/^ESP32-S3(?:$|\s|\()/i.test(ctx.chipName||""))
      throw fail(PROVISION_ERROR.VARIANT_UNSUPPORTED);
    checkAbort();
    emit(PHASE.LOADING_FIRMWARE);
    // loadFirmware validates the pinned SHA-256 before eraseFlash can run.
    const firmware=await adapters.loadFirmware();
    if(!firmware?.bytes?.byteLength||firmware.manifest?.flashOffset!==0)
      throw fail(PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
    emit(PHASE.VERIFYING_IMAGE_HASH);
    onLog("[S3] official pinned SHA-256: "+firmware.sha256);
    checkAbort();
    emit(PHASE.ERASING);
    await adapters.eraseFlash(ctx);
    emit(PHASE.FLASHING,{pct:0,bytesWritten:0,bytesTotal:firmware.bytes.byteLength});
    await adapters.writeFirmware(ctx,firmware.bytes,{
      manifest:firmware.manifest,
      onProgress:ev=>emit(PHASE.FLASHING,ev),
    });
    flashed=true;
    emit(PHASE.VERIFYING_FLASH);
    onLog("[S3] flash MD5 validated by esptool-js");
    emit(PHASE.RESETTING);
    await adapters.resetAndRelease(ctx);
    ctx=null;
    emit(PHASE.WAITING_REPL);
    try{
      const result=await adapters.connectRepl(port);
      session=result.session;
      adapters.keepSession(session);
      session=null;
        port=null; // live USB connection now owns port
      emit(PHASE.READY,{boardState:BOARD_STATE.MPY_ONLY});
      return status(true,null);
    }catch(e){
      onLog("[S3] flashed successfully; REPL not available yet. Press RESET and retry connection.");
      emit(PHASE.RESET_REQUIRED,{boardState:BOARD_STATE.RESET_REQUIRED,error:PROVISION_ERROR.RESET_REQUIRED});
      return status(false,PROVISION_ERROR.RESET_REQUIRED);
    }
  }catch(e){
    const code=e?.code||e?.message||PROVISION_ERROR.UNKNOWN;
    if(phase!==PHASE.NEED_BOOT_BUTTON&&phase!==PHASE.UNSUPPORTED_VARIANT)
      emit(phase===PHASE.CANCELLED?PHASE.CANCELLED:PHASE.ERROR,{error:code,chipName:e?.chipName});
    onLog("[S3] "+String(code));
    return status(false,code);
  }finally{await close();}
}
