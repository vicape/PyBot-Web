/** Códigos de control del REPL de MicroPython (USB y BLE). Bytes, no texto. */

export const BYTE_CTRL_A = 0x01; // entrar a raw REPL
export const BYTE_CTRL_B = 0x02; // volver a REPL friendly
export const BYTE_CTRL_C = 0x03; // KeyboardInterrupt
export const BYTE_CTRL_D = 0x04; // ejecutar / EOF / ACK raw-paste
export const BYTE_CTRL_E = 0x05; // paste / raw-paste

export const CTRL_A = "\x01";
export const CTRL_B = "\x02";
export const CTRL_C = "\x03";
export const CTRL_D = "\x04";
export const CTRL_E = "\x05";

export const DEFAULT_BAUD = 115200;
export const BOOT_DELAY_MS = 1200;

/** Escritura serial: chunks para no saturar el USB CDC. Sin sleep entre chunks. */
export const SERIAL_WRITE_CHUNK = 128;

/** MTU BLE por defecto ~20 bytes útiles. */
export const BLE_REPL_CHUNK = 20;

export const RAW_REPL_BANNER_TEXT = "raw REPL; CTRL-B to exit\r\n>";
export const RAW_REPL_PROMPT = RAW_REPL_BANNER_TEXT;

export const RAW_PASTE_HELLO = new Uint8Array([BYTE_CTRL_E, 0x41, BYTE_CTRL_A]); // \x05A\x01
export const OK_BYTES = new Uint8Array([0x4f, 0x4b]); // "OK" exactamente dos bytes

/** Chunk clásico de pyboard.py (el transporte puede subdividir por MTU). */
export const RAW_REPL_CLASSIC_CHUNK = 256;

export const RAW_REPL_ENTER_TIMEOUT_MS = 8000;
export const RAW_REPL_ACK_TIMEOUT_MS = 8000;
export const RAW_PASTE_HEADER_TIMEOUT_MS = 3000;
export const RAW_PASTE_WINDOW_TIMEOUT_MS = 5000;
export const RAW_PASTE_EOF_TIMEOUT_MS = 5000;
export const RAW_REPL_STDOUT_TIMEOUT_MS = 300000;
export const RAW_REPL_STDERR_TIMEOUT_MS = 8000;
export const RAW_REPL_FOLLOW_AFTER_INTERRUPT_MS = 4000;

export const BLE_NATIVE_PRELUDE = "from pybot_mpy import *\n";

export const BLE_LINK_STATE = Object.freeze({
  GATT_CONNECTED: "GATT_CONNECTED",
  REPL_TRANSPORT_READY: "REPL_TRANSPORT_READY",
  RAW_REPL_READY: "RAW_REPL_READY",
});
