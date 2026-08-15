/**
 * Capa A: ROM bootloader → flash MicroPython vía esptool-js oficial.
 * No habla raw REPL. El caller cierra readers/writers antes de entrar.
 */

import { importEsptool } from "./esptoolLoader.js";
import { ESP32_GENERIC_FIRMWARE, isClassicEsp32Chip } from "./firmwareManifest.js";
import { PROVISION_ERROR } from "./provisioningPhases.js";

function provisionError(code, cause) {
  const err = new Error(code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeTerminal(onLog) {
  return {
    clean() {},
    writeLine(data) {
      onLog?.("[ESPTOOL] " + String(data ?? ""));
    },
    write(data) {
      const s = String(data ?? "");
      if (s.trim()) onLog?.("[ESPTOOL] " + s);
    },
  };
}

/**
 * @param {SerialPort} port
 * @param {{
 *   esptool?: { ESPLoader: Function, Transport: Function },
 *   baudrate?: number,
 *   onLog?: (line: string) => void,
 * }} [options]
 */
export async function connectBootloader(port, options = {}) {
  const mod = options.esptool ?? (await importEsptool());
  const Transport = mod.Transport;
  const ESPLoader = mod.ESPLoader;
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: options.baudrate ?? 115200,
    romBaudrate: 115200,
    terminal: makeTerminal(options.onLog),
    debugLogging: false,
  });
  let chipName;
  try {
    chipName = await loader.main("default_reset");
  } catch (e) {
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }
    throw provisionError(PROVISION_ERROR.BOOTLOADER_FAIL, e);
  }
  const name = String(chipName ?? loader.chip?.CHIP_NAME ?? "");
  if (!isClassicEsp32Chip(name) && !isClassicEsp32Chip(loader.chip?.CHIP_NAME)) {
    try {
      await loader.after("hard_reset");
    } catch {
      /* ignore */
    }
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }
    const err = provisionError(PROVISION_ERROR.VARIANT_UNSUPPORTED);
    err.chipName = name || loader.chip?.CHIP_NAME || "unknown";
    throw err;
  }
  return {
    loader,
    transport,
    chipName: name || "ESP32",
    chip: loader.chip,
  };
}

/**
 * @param {{ loader: { eraseFlash: Function } }} ctx
 */
export async function eraseFlash(ctx) {
  try {
    await ctx.loader.eraseFlash();
  } catch (e) {
    throw provisionError(PROVISION_ERROR.ERASE_FAIL, e);
  }
}

/**
 * @param {{ loader: { writeFlash: Function, flashMd5sum?: Function } }} ctx
 * @param {Uint8Array} bytes
 * @param {{
 *   manifest?: typeof ESP32_GENERIC_FIRMWARE,
 *   onProgress?: (info: { bytesWritten: number, bytesTotal: number, pct: number }) => void,
 *   verify?: boolean,
 * }} [options]
 */
export async function writeFirmware(ctx, bytes, options = {}) {
  const manifest = options.manifest ?? ESP32_GENERIC_FIRMWARE;
  const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = image.byteLength;
  try {
    await ctx.loader.writeFlash({
      fileArray: [{ data: image, address: manifest.flashOffset }],
      flashMode: manifest.flashMode,
      flashFreq: manifest.flashFreq,
      flashSize: manifest.flashSize,
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, fileTotal) => {
        const bytesTotal = fileTotal || total;
        const bytesWritten = written;
        const pct = bytesTotal ? Math.min(100, Math.floor((100 * bytesWritten) / bytesTotal)) : 0;
        options.onProgress?.({ bytesWritten, bytesTotal, pct });
      },
    });
  } catch (e) {
    throw provisionError(PROVISION_ERROR.FLASH_FAIL, e);
  }
  if (options.verify !== false && typeof ctx.loader.flashMd5sum === "function") {
    try {
      await ctx.loader.flashMd5sum(manifest.flashOffset, image.byteLength);
    } catch (e) {
      throw provisionError(PROVISION_ERROR.FLASH_VERIFY_FAIL, e);
    }
  }
}

/**
 * Reset a modo run y suelta el puerto (readers/writers) para el REPL.
 * @param {{ loader?: { after: Function }, transport?: { disconnect: Function } }} ctx
 */
export async function resetAndRelease(ctx) {
  try {
    if (ctx?.loader && typeof ctx.loader.after === "function") {
      await ctx.loader.after("hard_reset");
    }
  } catch (e) {
    throw provisionError(PROVISION_ERROR.RESET_FAIL, e);
  }
  try {
    if (ctx?.transport && typeof ctx.transport.disconnect === "function") {
      await ctx.transport.disconnect();
    }
  } catch {
    /* el puerto puede desaparecer un instante tras el reset */
  }
  await sleep(400);
}

export async function ensurePortClosed(port) {
  if (!port) return;
  if (port.readable || port.writable) {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }
}
