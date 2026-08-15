/** Códigos de control del REPL de MicroPython (USB y BLE). */
export const CTRL_A = "\x01"; // entrar a raw REPL
export const CTRL_B = "\x02"; // volver a REPL friendly
export const CTRL_C = "\x03"; // KeyboardInterrupt
export const CTRL_D = "\x04"; // ejecutar / EOF
export const CTRL_E = "\x05"; // paste / raw-paste

export const DEFAULT_BAUD = 115200;
export const BOOT_DELAY_MS = 1200;

/** Escritura serial: chunks pequeños para no saturar el USB CDC. */
export const SERIAL_WRITE_CHUNK = 128;
export const SERIAL_WRITE_PACE_MS = 5;

/** MTU BLE por defecto ~20 bytes útiles. */
export const BLE_REPL_CHUNK = 20;
export const BLE_REPL_PACE_MS = 4;

export const RAW_REPL_PROMPT = "raw REPL";
export const RAW_PASTE_HELLO = "\x05A\x01";

export const DETECT_ATTEMPTS = 3;
export const ENTER_RAW_ATTEMPTS = 3;
