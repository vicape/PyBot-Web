/**
 * Escalado de recuperación MicroPython.
 *
 * Stop NORMAL = niveles 1–3 (Ctrl+C / recuperar REPL).
 * Niveles 4–5 son recuperación administrativa; NO se ocultan detrás de Stop.
 */

export const STOP_LEVEL = Object.freeze({
  CTRL_C: 1,
  CTRL_C_REPEAT: 2,
  REPL_RECOVER: 3,
  SOFT_RESET: 4,
  HARD_RESET: 5,
});

export const STOP_LEVEL_TIMEOUT_MS = Object.freeze({
  1: 800,
  2: 1500,
  3: 2500,
  4: 4000,
  5: 8000,
});

export const STOP_LEVEL_NAME = Object.freeze({
  1: "ctrl-c",
  2: "ctrl-c-repeat",
  3: "repl-recover",
  4: "soft-reset",
  5: "hard-reset",
});

/** @param {number} level */
export function isNormalStopLevel(level) {
  const n = Number(level) || 0;
  return n >= STOP_LEVEL.CTRL_C && n <= STOP_LEVEL.REPL_RECOVER;
}

/** @param {number} level */
export function isResetLevel(level) {
  const n = Number(level) || 0;
  return n >= STOP_LEVEL.SOFT_RESET;
}

/** @param {number} [level] */
export function nextStopLevel(level) {
  const n = Number(level) || STOP_LEVEL.CTRL_C;
  return Math.min(STOP_LEVEL.HARD_RESET, n + 1);
}

/** @param {number} level */
export function timeoutForStopLevel(level) {
  const n = Number(level) || STOP_LEVEL.CTRL_C;
  return STOP_LEVEL_TIMEOUT_MS[n] ?? STOP_LEVEL_TIMEOUT_MS[1];
}
