/**
 * Verificación liviana de EDA6 instalada y prelude por import.
 * Sin versionado artificial: si EDA6 ya está en la placa, no se sobrescribe.
 */

export function buildEda6ImportedPrelude(profile) {
  const placa = profile === "ESP32" ? "ESP32" : "WEMOS";
  return [
    "import EDA6",
    `EDA6.PLACA_ACTUAL = "${placa}"`,
    "from EDA6 import *",
    "try:",
    "    _pybot_cleanup_normal = EDA6._pybot_cleanup_normal",
    "except Exception:",
    "    pass",
    "",
  ].join("\n");
}

/** Probe de presencia (no exige EDA6_VERSION). */
export const EDA6_PRESENCE_QUERY_SCRIPT = [
  "try:",
  "    import EDA6",
  "    print('EDA6_OK')",
  "except Exception:",
  "    print('EDA6_MISSING')",
].join("\n");

export const EDA6_INVALIDATE_SCRIPT = [
  "try:",
  "    import sys",
  "    if 'EDA6' in sys.modules:",
  "        del sys.modules['EDA6']",
  "except Exception:",
  "    pass",
  "import gc",
  "gc.collect()",
].join("\n");

export function parseEda6PresenceProbe(stdout) {
  return /EDA6_OK/.test(String(stdout ?? ""));
}

/** true solo si falta el módulo; una EDA6 original presente no se reinstala. */
export function eda6NeedsInstall(present) {
  return !present;
}

/**
 * Instala EDA6.py solo si falta en la placa.
 * Tras escribir, invalida sys.modules["EDA6"] para no retener el módulo viejo.
 *
 * @param {{ execRaw: Function, installFile: Function }} session
 * @param {{ getSource: () => string, timeout?: number }} options
 */
export async function ensureEda6OnSession(session, options) {
  const timeout = options.timeout ?? 8000;
  let present = false;
  try {
    const { stdout } = await session.execRaw(EDA6_PRESENCE_QUERY_SCRIPT, { timeout });
    present = parseEda6PresenceProbe(stdout);
  } catch {
    present = false;
  }
  if (!eda6NeedsInstall(present)) {
    return { updated: false, present: true };
  }
  await session.installFile("EDA6.py", options.getSource());
  await session.execRaw(EDA6_INVALIDATE_SCRIPT, { timeout });
  return { updated: true, present: true };
}
