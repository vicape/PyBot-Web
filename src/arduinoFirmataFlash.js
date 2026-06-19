/**
 * Graba StandardFirmata en Arduino Uno/Nano (ATmega328P) desde el navegador.
 * Se usa cuando el puerto USB responde pero no hay firmware Firmata (p. ej. Blink).
 */

import { STK500, WebSerialTransport, BOARDS } from "webserial-flasher";

const FIRMWARE_URLS = [
  "/firmware/StandardFirmata_uno.hex",
  "https://raw.githubusercontent.com/ajfisher/interchange-firmata/master/bin/uno/StandardFirmata.ino.hex",
];

/** @type {readonly string[]} */
const BOARD_IDS = ["arduino-uno", "arduino-nano", "arduino-nano-old"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadStandardFirmataHex() {
  let lastErr;
  for (const url of FIRMWARE_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes(":")) return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("HEX_FETCH_FAIL");
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

/**
 * webserial-flasher usa { dtr, rts }; Web Serial API usa dataTerminalReady / requestToSend.
 * @param {import('webserial-flasher').WebSerialTransport} transport
 */
function patchWebSerialSignals(transport) {
  const original = transport.setSignals?.bind(transport);
  if (!original) return;
  transport.setSignals = async (opts = {}) => {
    /** @type {Record<string, boolean>} */
    const mapped = {};
    if ("dtr" in opts) mapped.dataTerminalReady = !!opts.dtr;
    if ("rts" in opts) mapped.requestToSend = !!opts.rts;
    if ("dataTerminalReady" in opts) mapped.dataTerminalReady = !!opts.dataTerminalReady;
    if ("requestToSend" in opts) mapped.requestToSend = !!opts.requestToSend;
    return original(mapped);
  };
}

/**
 * @param {SerialPort} port puerto ya autorizado por Web Serial
 * @param {{ onProgress?: (info: { boardId: string, status: string, pct: number }) => void }} [options]
 */
export async function flashStandardFirmata(port, options = {}) {
  const hexString = await loadStandardFirmataHex();
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

  throw lastErr ?? new Error("FLASH_FAIL");
}
