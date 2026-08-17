/**
 * Orquestador Preparar ESP32.
 *
 * Capa A (ROM bootloader / esptool) y capa B (raw REPL / installBleRuntime)
 * se inyectan. NUNCA raw REPL antes de MicroPython.
 *
 * Listo (READY) solo si: firmware verificado + boot MicroPython + REPL +
 * archivos PyBot verificados. writeFlash por sí solo no alcanza.
 */

import { PHASE, BOARD_STATE, isCriticalPhase, PROVISION_ERROR } from "./provisioningPhases.js";
import { classifyBoard } from "./boardProbe.js";
import { expectedProvisionFiles } from "./pybotInstallManifest.js";
import { ESP32_GENERIC_FIRMWARE } from "./firmwareManifest.js";

function provisionError(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra && typeof extra === "object") Object.assign(err, extra);
  return err;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @typedef {object} ProvisionAdapters
 * @property {() => Promise<any>} requestPort
 * @property {(port: any) => Promise<{ boardState: string, session?: any, files?: string[], runtimeVersion?: string|null }>} probeBoard
 * @property {(port: any) => Promise<{ loader: any, transport: any, chipName: string }>} connectBootloader
 * @property {(ctx: any) => Promise<void>} eraseFlash
 * @property {(ctx: any, bytes: Uint8Array, opts: object) => Promise<void>} writeFirmware
 * @property {(ctx: any) => Promise<void>} resetAndRelease
 * @property {() => Promise<{ bytes: Uint8Array, sha256: string, manifest: object }>} loadFirmware
 * @property {(port: any, opts?: object) => Promise<{ session: any }>} connectRepl
 * @property {(opts?: object) => Promise<{ size?: number }>} installPybot
 * @property {(session: any) => Promise<{ ok: boolean, missing?: string[] }>} verifyPybotFiles
 * @property {(port?: any, session?: any) => Promise<void>} [closePort]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/**
 * @param {ProvisionAdapters} adapters
 * @param {{
 *   onPhase?: (ev: object) => void,
 *   onLog?: (line: string) => void,
 *   signal?: { aborted?: boolean },
 *   forceReinstall?: boolean,
 *   confirmFlash?: () => Promise<boolean>,
 *   confirmInstall?: () => Promise<boolean>,
 *   confirmUpdate?: () => Promise<boolean>,
 *   confirmReinstall?: () => Promise<boolean>,
 *   autoConfirm?: boolean,
 * }} [options]
 */
export async function runEsp32Provisioning(adapters, options = {}) {
  let phase = PHASE.IDLE;
  let flashed = false;
  let installed = false;
  let bootloaderCtx = null;
  let port = null;
  let session = null;
  let boardState = null;
  let chipName = null;

  const wait = adapters.sleep ?? sleep;
  const emit = (next, extra = {}) => {
    phase = next;
    options.onPhase?.({
      phase,
      boardState,
      chipName,
      flashed,
      installed,
      ...extra,
    });
  };
  const log = (line) => options.onLog?.(line);

  const throwIfCancelled = () => {
    if (options.signal?.aborted && !isCriticalPhase(phase)) {
      throw provisionError(PROVISION_ERROR.CANCELLED);
    }
  };

  const confirm = async (fn, fallbackTrue) => {
    if (options.autoConfirm) return true;
    if (typeof fn === "function") return !!(await fn());
    return fallbackTrue !== false;
  };

  const cleanup = async () => {
    if (bootloaderCtx) {
      try {
        await adapters.resetAndRelease(bootloaderCtx);
      } catch {
        /* ignore */
      }
      bootloaderCtx = null;
    }
    if (typeof adapters.closePort === "function") {
      try {
        await adapters.closePort(port, session);
      } catch {
        /* ignore */
      }
    }
  };

  try {
    emit(PHASE.SELECTING_PORT);
    log("[PROVISION] selecting serial port");
    throwIfCancelled();
    try {
      port = await adapters.requestPort();
    } catch (e) {
      const name = e?.name ?? "";
      const code = e?.code ?? e?.message;
      if (name === "NotFoundError" || code === PROVISION_ERROR.PORT_CANCELLED) {
        emit(PHASE.CANCELLED);
        return { ok: false, phase: PHASE.CANCELLED, error: PROVISION_ERROR.PORT_CANCELLED };
      }
      if (name === "SecurityError" || code === PROVISION_ERROR.PORT_PERMISSION) {
        throw provisionError(PROVISION_ERROR.PORT_PERMISSION);
      }
      throw e;
    }
    if (!port) {
      emit(PHASE.CANCELLED);
      return { ok: false, phase: PHASE.CANCELLED, error: PROVISION_ERROR.PORT_CANCELLED };
    }

    emit(PHASE.PROBING);
    log("[PROVISION] probing MicroPython / PyBot files");
    throwIfCancelled();
    let probe;
    try {
      probe = await adapters.probeBoard(port);
    } catch (e) {
      const code = e?.code ?? e?.message;
      if (code === "BUSY" || code === PROVISION_ERROR.BUSY) {
        throw provisionError(PROVISION_ERROR.BUSY);
      }
      throw e;
    }
    boardState = probe?.boardState ?? BOARD_STATE.UNKNOWN;
    session = probe?.session ?? null;
    emit(PHASE.PROBING, { boardState, files: probe?.files, runtimeVersion: probe?.runtimeVersion });

    if (boardState === BOARD_STATE.PORT_BUSY) {
      throw provisionError(PROVISION_ERROR.BUSY);
    }
    if (boardState === BOARD_STATE.UNKNOWN) {
      emit(PHASE.ERROR, { error: PROVISION_ERROR.UNKNOWN, boardState });
      await cleanup();
      return {
        ok: false,
        alreadyPrepared: false,
        flashed: false,
        installed: false,
        boardState,
        phase: PHASE.ERROR,
        error: PROVISION_ERROR.UNKNOWN,
      };
    }

    if (boardState === BOARD_STATE.READY && !options.forceReinstall) {
      emit(PHASE.ALREADY_PREPARED);
      log("[PROVISION] board already prepared; no automatic erase");
      await cleanup();
      return {
        ok: true,
        alreadyPrepared: true,
        flashed: false,
        installed: false,
        boardState,
        phase: PHASE.ALREADY_PREPARED,
      };
    }

    const skipFlash = options.skipFlash === true || options.resumeFromRepl === true;
    if (
      (boardState === BOARD_STATE.RESET_REQUIRED ||
        boardState === BOARD_STATE.REPL_UNAVAILABLE) &&
      skipFlash
    ) {
      emit(PHASE.RESET_REQUIRED, { boardState: BOARD_STATE.RESET_REQUIRED });
      log("[PROVISION] MicroPython was written; press EN/RESET and retry REPL (no reflash)");
      await cleanup();
      return {
        ok: false,
        alreadyPrepared: false,
        flashed: false,
        installed: false,
        boardState: BOARD_STATE.RESET_REQUIRED,
        phase: PHASE.RESET_REQUIRED,
        error: PROVISION_ERROR.RESET_REQUIRED,
      };
    }

    const needsFlash =
      boardState === BOARD_STATE.VIRGIN || boardState === BOARD_STATE.REPL_UNAVAILABLE;

    const needsFullInstall =
      options.forceReinstall === true ||
      boardState === BOARD_STATE.MICROPYTHON_ONLY ||
      boardState === BOARD_STATE.INCOMPLETE ||
      boardState === BOARD_STATE.OLD_PYBOT ||
      needsFlash;

    if (needsFlash) {
      const confirmPhase = options.forceReinstall ? PHASE.CONFIRM_REINSTALL : PHASE.CONFIRM_FLASH;
      emit(confirmPhase);
      const okConfirm = options.forceReinstall
        ? await confirm(options.confirmReinstall, true)
        : await confirm(options.confirmFlash, true);
      if (!okConfirm) {
        emit(PHASE.CANCELLED);
        await cleanup();
        return { ok: false, phase: PHASE.CANCELLED, error: PROVISION_ERROR.CANCELLED, boardState };
      }
      throwIfCancelled();

      if (session && typeof adapters.closePort === "function") {
        try {
          await adapters.closePort(port, session);
        } catch {
          /* ignore */
        }
        session = null;
      }

      emit(PHASE.CONNECTING_BOOTLOADER);
      log("[PROVISION] connecting ROM bootloader (DTR/RTS)");
      try {
        bootloaderCtx = await adapters.connectBootloader(port);
      } catch (e) {
        if ((e?.code ?? e?.message) === PROVISION_ERROR.VARIANT_UNSUPPORTED) {
          chipName = e.chipName || "unknown";
          emit(PHASE.UNSUPPORTED_VARIANT, { chipName });
          throw e;
        }
        emit(PHASE.NEED_BOOT_BUTTON);
        throw e;
      }
      chipName = bootloaderCtx.chipName;
      emit(PHASE.IDENTIFYING_CHIP, { chipName });
      log("[PROVISION] chip " + chipName);

      emit(PHASE.LOADING_FIRMWARE);
      log("[PROVISION] loading official MicroPython image");
      const firmware = await adapters.loadFirmware();

      emit(PHASE.VERIFYING_IMAGE_HASH);
      log("[PROVISION] SHA-256 verified " + firmware.sha256);
      if (!firmware?.bytes?.byteLength) {
        throw provisionError(PROVISION_ERROR.FIRMWARE_FETCH_FAIL);
      }

      emit(PHASE.ERASING);
      log("[PROVISION] erase flash");
      await adapters.eraseFlash(bootloaderCtx);

      emit(PHASE.FLASHING, { pct: 0, bytesWritten: 0, bytesTotal: firmware.bytes.byteLength });
      log("[PROVISION] writing MicroPython at 0x" + ESP32_GENERIC_FIRMWARE.flashOffset.toString(16));
      await adapters.writeFirmware(bootloaderCtx, firmware.bytes, {
        onProgress: (info) => {
          emit(PHASE.FLASHING, {
            pct: info.pct,
            bytesWritten: info.bytesWritten,
            bytesTotal: info.bytesTotal,
          });
        },
      });

      emit(PHASE.VERIFYING_FLASH);
      log("[PROVISION] flash write finished; not READY until REPL + files");
      flashed = true;
      emit(PHASE.FLASH_WRITTEN);

      emit(PHASE.RESETTING);
      await adapters.resetAndRelease(bootloaderCtx);
      bootloaderCtx = null;
      await wait(1800);

      emit(PHASE.WAITING_REPL);
      log("[PROVISION] waiting for MicroPython REPL");
      try {
        const connected = await adapters.connectRepl(port, { afterFlash: true });
        session = connected.session;
      } catch (e) {
        boardState = BOARD_STATE.RESET_REQUIRED;
        emit(PHASE.RESET_REQUIRED, { boardState, error: PROVISION_ERROR.RESET_REQUIRED });
        log("[PROVISION] MicroPython written; press EN/RESET and retry (no reflash)");
        try {
          await cleanup();
        } catch {
          /* cleanup */
        }
        return {
          ok: false,
          alreadyPrepared: false,
          flashed: true,
          installed: false,
          boardState,
          chipName,
          phase: PHASE.RESET_REQUIRED,
          error: PROVISION_ERROR.RESET_REQUIRED,
          cause: e?.message,
        };
      }
    } else if (needsFullInstall) {
      const confirmPhase =
        options.forceReinstall || boardState === BOARD_STATE.INCOMPLETE
          ? PHASE.CONFIRM_REINSTALL
          : boardState === BOARD_STATE.OLD_PYBOT
            ? PHASE.CONFIRM_UPDATE
            : PHASE.CONFIRM_INSTALL;
      emit(confirmPhase);
      const okConfirm =
        confirmPhase === PHASE.CONFIRM_REINSTALL
          ? await confirm(options.confirmReinstall, true)
          : confirmPhase === PHASE.CONFIRM_UPDATE
            ? await confirm(options.confirmUpdate, true)
            : await confirm(options.confirmInstall, true);
      if (!okConfirm) {
        emit(PHASE.CANCELLED);
        await cleanup();
        return { ok: false, phase: PHASE.CANCELLED, error: PROVISION_ERROR.CANCELLED, boardState };
      }
      if (!session) {
        emit(PHASE.WAITING_REPL);
        try {
          const connected = await adapters.connectRepl(port);
          session = connected.session;
        } catch (e) {
          throw provisionError(PROVISION_ERROR.REPL_TIMEOUT, { cause: e });
        }
      }
    } else {
      throw provisionError(PROVISION_ERROR.UNKNOWN, { boardState });
    }

    throwIfCancelled();
    emit(PHASE.INSTALLING_PYBOT, { pct: 0 });
    log("[PROVISION] installing PyBot runtime via raw REPL (no student program)");
    try {
      await adapters.installPybot({
        onProgress: (info) => {
          emit(PHASE.INSTALLING_PYBOT, {
            pct: info?.pct,
            installPhase: info?.phase,
          });
        },
      });
      installed = true;
    } catch (e) {
      throw provisionError(PROVISION_ERROR.INSTALL_FAIL, { cause: e });
    }

    emit(PHASE.RESETTING_PYBOT);
    log("[PROVISION] runtime written; reconnecting after reset");
    await wait(800);
    emit(PHASE.WAITING_REPL);
    try {
      const again = await adapters.connectRepl(port, { afterInstall: true });
      session = again?.session ?? session;
    } catch (e) {
      throw provisionError(PROVISION_ERROR.REPL_TIMEOUT, { cause: e });
    }

    emit(PHASE.VERIFYING_FILES);
    log("[PROVISION] verifying PyBot files after MicroPython boot");
    let verify;
    try {
      verify = await adapters.verifyPybotFiles(session);
    } catch (e) {
      throw provisionError(PROVISION_ERROR.VERIFY_FILES_FAIL, { cause: e });
    }
    if (!verify?.ok) {
      throw provisionError(PROVISION_ERROR.VERIFY_FILES_FAIL, {
        missing: verify?.missing,
      });
    }

    boardState = BOARD_STATE.READY;
    emit(PHASE.READY);
    log("[PROVISION] ESP32 ready");
    return {
      ok: true,
      alreadyPrepared: false,
      flashed,
      installed,
      boardState,
      chipName,
      phase: PHASE.READY,
      files: expectedProvisionFiles(),
    };
  } catch (e) {
    const code = e?.code ?? (e?.message && PROVISION_ERROR[e.message] ? e.message : PROVISION_ERROR.UNKNOWN);
    if (phase === PHASE.UNSUPPORTED_VARIANT || code === PROVISION_ERROR.VARIANT_UNSUPPORTED) {
      emit(PHASE.UNSUPPORTED_VARIANT, { error: code, chipName: e?.chipName || chipName });
    } else if (code === PROVISION_ERROR.CANCELLED) {
      emit(PHASE.CANCELLED, { error: code });
    } else if (code === PROVISION_ERROR.RESET_REQUIRED) {
      emit(PHASE.RESET_REQUIRED, { error: code, boardState: BOARD_STATE.RESET_REQUIRED });
    } else if (phase !== PHASE.NEED_BOOT_BUTTON) {
      emit(PHASE.ERROR, { error: code, missing: e?.missing });
    } else {
      emit(PHASE.NEED_BOOT_BUTTON, { error: code });
    }
    log("[PROVISION] error " + code);
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      alreadyPrepared: false,
      flashed,
      installed,
      boardState,
      chipName,
      phase:
        code === PROVISION_ERROR.VARIANT_UNSUPPORTED
          ? PHASE.UNSUPPORTED_VARIANT
          : code === PROVISION_ERROR.RESET_REQUIRED
            ? PHASE.RESET_REQUIRED
            : phase,
      error: code,
      missing: e?.missing,
    };
  }
}

export { classifyBoard };
