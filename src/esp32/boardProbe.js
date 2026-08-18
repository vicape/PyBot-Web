/**
 * Clasifica el estado de una ESP32 ya hablada (o no) por MicroPython.
 * No entra al ROM bootloader. Nunca asume raw REPL si no hay MicroPython.
 */

import { PYBOT_RUNTIME_VERSION } from "../bleProtocol.js";
import { BOARD_STATE } from "./provisioningPhases.js";
import {
  PYBOT_MARKER_FILE,
  expectedProvisionFiles,
  missingProvisionFiles,
  parseRuntimeVersionFromSource,
  isCompatibleMicroPython,
} from "./pybotInstallManifest.js";

/**
 * @param {{
 *   hasMicroPython: boolean,
 *   files?: string[],
 *   runtimeVersion?: string | null,
 *   publishedVersion?: string,
 *   mpVersion?: string | null,
 * }} info
 */
export function classifyBoard(info) {
  if (!info?.hasMicroPython) return BOARD_STATE.VIRGIN;
  if (info.mpVersion != null && !isCompatibleMicroPython(info.mpVersion)) {
    return BOARD_STATE.INCOMPATIBLE_MPY;
  }
  const files = Array.isArray(info.files) ? info.files : [];
  if (!files.includes(PYBOT_MARKER_FILE)) return BOARD_STATE.MICROPYTHON_ONLY;
  const missing = missingProvisionFiles(files);
  if (missing.length > 0) return BOARD_STATE.INCOMPLETE;
  const published = info.publishedVersion ?? PYBOT_RUNTIME_VERSION;
  const installed = info.runtimeVersion ?? null;
  if (!installed || installed !== published) return BOARD_STATE.OLD_PYBOT;
  return BOARD_STATE.READY;
}

/**
 * Inspecciona una sesión MicroPython ya detectada (fileExists / execRaw).
 * @param {{ fileExists: (name: string) => Promise<boolean>, execRaw?: Function }} session
 */
export async function inspectPybotOnSession(session, options = {}) {
  const names = options.files ?? expectedProvisionFiles();
  const present = [];
  for (const name of names) {
    try {
      if (await session.fileExists(name)) present.push(name);
    } catch {
      /* ignore individual stat failures */
    }
  }
  let mpVersion = null;
  if (typeof session.execRaw === "function") {
    try {
      const code = [
        "try:",
        "    import sys",
        "    v = sys.implementation.version",
        "    print('PYBOT_MP', str(v[0]) + '.' + str(v[1]) + '.' + str(v[2]))",
        "except Exception:",
        "    print('PYBOT_MP')",
      ].join("\n");
      const { stdout } = await session.execRaw(code, { timeout: 5000 });
      const m = String(stdout ?? "").match(/PYBOT_MP\s+([\d.]+)/);
      mpVersion = m ? m[1] : null;
    } catch {
      mpVersion = null;
    }
  }
  let runtimeVersion = null;
  if (present.includes(PYBOT_MARKER_FILE) && typeof session.execRaw === "function") {
    try {
      const code = [
        "try:",
        "    f = open('pybot_ble.py')",
        "    t = f.read(900)",
        "    f.close()",
        "    print('PYBOT_SRC', t)",
        "except Exception:",
        "    print('PYBOT_SRC')",
      ].join("\n");
      const { stdout } = await session.execRaw(code, { timeout: 8000 });
      const text = String(stdout ?? "");
      const idx = text.indexOf("PYBOT_SRC");
      const src = idx >= 0 ? text.slice(idx + "PYBOT_SRC".length) : text;
      runtimeVersion = parseRuntimeVersionFromSource(src);
    } catch {
      runtimeVersion = null;
    }
  }
  const boardState = classifyBoard({
    hasMicroPython: true,
    files: present,
    runtimeVersion,
    publishedVersion: options.publishedVersion,
    mpVersion,
  });
  return {
    boardState,
    files: present,
    runtimeVersion,
    mpVersion,
    missing: missingProvisionFiles(present),
  };
}

export function recommendedAction(boardState) {
  if (boardState === BOARD_STATE.VIRGIN || boardState === BOARD_STATE.INCOMPATIBLE_MPY) {
    return "prepare";
  }
  if (boardState === BOARD_STATE.MICROPYTHON_ONLY || boardState === BOARD_STATE.MPY_ONLY) {
    return "install";
  }
  if (boardState === BOARD_STATE.INCOMPLETE) return "reinstall";
  if (boardState === BOARD_STATE.OLD_PYBOT) return "update";
  if (boardState === BOARD_STATE.RESET_REQUIRED) return "reset";
  if (boardState === BOARD_STATE.REPL_UNAVAILABLE) return "retry-repl";
  if (boardState === BOARD_STATE.PORT_BUSY) return "port-busy";
  if (boardState === BOARD_STATE.UNKNOWN) return "unknown";
  return "connect";
}
