/**
 * Verificación liviana de EDA6 instalada y prelude por import.
 * Sin source de EDA6.py: el bundle declara la versión esperada.
 */

export const EDA6_LIBRARY_VERSION = "1.1.1";

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

/**
 * Guardia de versión para Run BLE: la placa usa el EDA6.py instalado (USB).
 * No actualizar por BLE; exigir refresco USB si la versión no coincide.
 */
export function buildEda6VersionGuard(expected = EDA6_LIBRARY_VERSION) {
  const ver = String(expected ?? EDA6_LIBRARY_VERSION);
  return [
    "import EDA6",
    `_eda6_ver = getattr(EDA6, "EDA6_VERSION", "")`,
    `if _eda6_ver != "${ver}":`,
    `    raise RuntimeError("EDA6_BLE_STALE_LIB:" + str(_eda6_ver or "MISSING"))`,
    "",
  ].join("\n");
}

export const EDA6_VERSION_QUERY_SCRIPT = [
  "try:",
  "    import EDA6",
  "    print('EDA6_VER', getattr(EDA6, 'EDA6_VERSION', ''))",
  "except Exception:",
  "    print('EDA6_VER', 'MISSING')",
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

export function parseEda6VersionProbe(stdout) {
  const m = String(stdout ?? "").match(/EDA6_VER\s+(\S*)/);
  if (!m) return { present: false, version: null };
  const token = m[1];
  if (!token || token === "MISSING") return { present: false, version: null };
  return { present: true, version: token };
}

export function eda6NeedsInstall(probe, expected = EDA6_LIBRARY_VERSION) {
  return !probe?.present || !probe.version || probe.version !== expected;
}

/**
 * Instala EDA6.py solo si falta o la versión no coincide.
 * Tras escribir, invalida sys.modules["EDA6"] para no retener el módulo viejo.
 *
 * @param {{ execRaw: Function, installFile: Function }} session
 * @param {{ getSource: () => string, expectedVersion?: string, timeout?: number }} options
 */
export async function ensureEda6OnSession(session, options) {
  const expected = options.expectedVersion ?? EDA6_LIBRARY_VERSION;
  const timeout = options.timeout ?? 8000;
  let probe = { present: false, version: null };
  try {
    const { stdout } = await session.execRaw(EDA6_VERSION_QUERY_SCRIPT, { timeout });
    probe = parseEda6VersionProbe(stdout);
  } catch {
    probe = { present: false, version: null };
  }
  if (!eda6NeedsInstall(probe, expected)) {
    return { updated: false, version: probe.version };
  }
  await session.installFile("EDA6.py", options.getSource());
  await session.execRaw(EDA6_INVALIDATE_SCRIPT, { timeout });
  return { updated: true, version: expected };
}
