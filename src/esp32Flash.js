/**
 * Generación de main.py / pybot_hw.py para ejecución autónoma en la ESP32.
 */

import { MPY_PRELUDE } from "./micropythonEsp32Session.js";
import { prepareMainPyForFlash, prepareUserCodeForExec } from "./eda6Profile.js";

export const PYBOT_HW_FILENAME = "pybot_hw.py";
export const MAIN_PY_FILENAME = "main.py";
export const EDA6_FILENAME = "EDA6.py";

export function getPybotHwLibrarySource() {
  return MPY_PRELUDE;
}

/** main.py para modo ESP32 GPIO directo (pin/servo/motor/wait). */
export function prepareMainPyForGpioFlash(code) {
  const body = String(code ?? "").trim();
  return ["from pybot_hw import *", "", body, ""].join("\n");
}

export { prepareMainPyForFlash, prepareUserCodeForExec };
