/**
 * "Bajar a Arduino": graba el firmware VM (una vez) y sube el bytecode del
 * programa del alumno por serial para que la placa corra SOLA (desconectada).
 *
 * No interfiere con el modo en vivo (Firmata): son flujos separados y solo se
 * usan al tocar el botón "Bajar a Arduino".
 *
 * Firmware: firmware/pybot-arduino-vm + public/firmware/pybot-arduino-vm.hex
 * Protocolo de carga: ver cabecera del .ino.
 */

import { STK500, WebSerialTransport, BOARDS } from "webserial-flasher";

const VM_HEX_URL = "/firmware/pybot-arduino-vm.hex";
const BOARD_IDS = ["arduino-uno", "arduino-nano", "arduino-nano-old"];
const VM_BAUD = 115200;
const PROMPT = "PYBOTVM";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadVmHex() {
  const res = await fetch(VM_HEX_URL);
  if (!res.ok) throw new Error("PYBOT_VM:HEX_FETCH_FAIL");
  const text = await res.text();
  if (!text.includes(":")) throw new Error("PYBOT_VM:HEX_FETCH_FAIL");
  return text;
}

async function ensurePortClosed(port) {
  if (port.readable || port.writable) {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }
}

function patchWebSerialSignals(transport) {
  const original = transport.setSignals?.bind(transport);
  if (!original) return;
  transport.setSignals = async (opts = {}) => {
    const mapped = {};
    if ("dtr" in opts) mapped.dataTerminalReady = !!opts.dtr;
    if ("rts" in opts) mapped.requestToSend = !!opts.rts;
    if ("dataTerminalReady" in opts) mapped.dataTerminalReady = !!opts.dataTerminalReady;
    if ("requestToSend" in opts) mapped.requestToSend = !!opts.requestToSend;
    return original(mapped);
  };
}

/** Graba el firmware VM en la placa (STK500). */
export async function flashVmFirmware(port, options = {}) {
  const hexString = await loadVmHex();
  const { onProgress } = options;
  let lastErr;

  for (const boardId of BOARD_IDS) {
    const board = BOARDS[boardId];
    if (!board) continue;
    const transport = new WebSerialTransport(port);
    patchWebSerialSignals(transport);
    try {
      await ensurePortClosed(port);
      await transport.open(board.baudRate);
      const stk = new STK500(transport, board, {
        quiet: true,
        retry: { syncAttempts: 10, retryDelayMs: 120 },
      });
      await stk.bootload(hexString, (status, pct) => {
        onProgress?.({ boardId, status, pct });
      });
      await transport.close();
      await sleep(2800);
      return { boardId };
    } catch (e) {
      lastErr = e;
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      try {
        await ensurePortClosed(port);
      } catch {
        /* ignore */
      }
      await sleep(400);
    }
  }
  throw lastErr ?? new Error("PYBOT_VM:FLASH_FAIL");
}

/**
 * Reset por DTR (auto-reset del Uno/Nano). Replica la secuencia que usa el
 * flasher STK500 (que ya funciona en estas placas): DTR false -> espera -> true.
 */
async function pulseReset(port) {
  try {
    await port.setSignals({ dataTerminalReady: false });
    await sleep(250);
    await port.setSignals({ dataTerminalReady: true });
    await sleep(250);
  } catch {
    /* algunos drivers no soportan setSignals; el open ya suele resetear */
  }
}

/**
 * Lee del puerto hasta encontrar el prompt o agotar el tiempo.
 * @returns {Promise<boolean>} true si apareció PYBOT VM
 */
async function waitForPrompt(reader, timeoutMs) {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      sleep(remaining).then(() => ({ timeout: true })),
    ]);
    if (result.timeout) break;
    if (result.done) break;
    if (result.value) {
      buf += decoder.decode(result.value, { stream: true });
      if (buf.includes(PROMPT)) return true;
      if (buf.length > 512) buf = buf.slice(-128);
    }
  }
  return false;
}

/**
 * Espera un byte de respuesta del firmware ('K' ok / 'E' error).
 * @returns {Promise<"ok"|"error"|"timeout">}
 */
async function waitForAck(reader, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      sleep(remaining).then(() => ({ timeout: true })),
    ]);
    if (result.timeout) break;
    if (result.done) break;
    if (result.value) {
      for (const b of result.value) {
        if (b === 0x4b) return "ok"; // 'K'
        if (b === 0x45) return "error"; // 'E'
      }
    }
  }
  return "timeout";
}

/**
 * Sube la imagen de bytecode a una placa que YA tiene el firmware VM.
 * Resetea, espera el prompt y envía el comando de carga.
 * @param {SerialPort} port
 * @param {Uint8Array} image
 * @returns {Promise<"ok"|"vm-absent"|"upload-failed">}
 */
export async function uploadBytecode(port, image, options = {}) {
  const attempts = options.attempts ?? 2;
  let sawNoPrompt = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await uploadAttempt(port, image);
    if (result === "ok") return "ok";
    if (result === "vm-absent") sawNoPrompt++;
    // pequeña pausa antes de reintentar
    await sleep(300);
  }
  // Si en todos los intentos no apareció el prompt, asumimos que la placa no
  // tiene el firmware VM todavía.
  return sawNoPrompt === attempts ? "vm-absent" : "upload-failed";
}

async function uploadAttempt(port, image) {
  await ensurePortClosed(port);
  await port.open({ baudRate: VM_BAUD });
  let reader;
  let writer;
  try {
    await pulseReset(port);
    reader = port.readable.getReader();
    writer = port.writable.getWriter();

    // El bootloader (optiboot) corre ~1s tras el reset; luego arranca el VM
    // que imprime el prompt repetidamente y abre la ventana de carga.
    const seen = await waitForPrompt(reader, 6000);
    if (!seen) return "vm-absent";

    const len = image.length;
    let sum = 0;
    for (let i = 0; i < len; i++) sum += image[i];
    const head = new Uint8Array([0x7e, 0x55, len & 0xff, (len >> 8) & 0xff]);
    await writer.write(head);
    await writer.write(image);
    await writer.write(new Uint8Array([sum & 0xff]));

    // La placa graba la EEPROM (~3.3 ms/byte) antes de responder 'K'.
    const ack = await waitForAck(reader, 5000);
    return ack === "ok" ? "ok" : "upload-failed";
  } finally {
    try {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      /* ignore */
    }
    try {
      if (writer) {
        await writer.close().catch(() => {});
        writer.releaseLock();
      }
    } catch {
      /* ignore */
    }
    await ensurePortClosed(port);
  }
}

/**
 * Flujo completo: intenta subir; si la placa no tiene el VM, lo graba y
 * vuelve a subir.
 * @param {SerialPort} port
 * @param {Uint8Array} image
 * @param {{ onPhase?: (phase: "uploading"|"flashing"|"retry") => void }} [options]
 */
export async function downloadProgramToArduino(port, image, options = {}) {
  const { onPhase } = options;
  onPhase?.("uploading");
  // Sondeo rápido: ¿la placa ya tiene el firmware VM?
  let result = await uploadBytecode(port, image, { attempts: 1 });
  if (result === "ok") return { flashed: false };

  if (result === "upload-failed") {
    // El VM respondió pero la carga falló: reintentar sin reflashear.
    result = await uploadBytecode(port, image, { attempts: 2 });
    if (result === "ok") return { flashed: false };
  }

  // No hay firmware VM (o sigue fallando) -> grabarlo y reintentar (robusto).
  onPhase?.("flashing");
  await flashVmFirmware(port);
  onPhase?.("retry");
  result = await uploadBytecode(port, image, { attempts: 3 });
  if (result === "ok") return { flashed: true };

  throw new Error("PYBOT_VM:UPLOAD_FAIL");
}
