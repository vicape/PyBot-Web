/**
 * Verificación de EDA6 canónica por integridad (hash de contenido).
 * Sin versionado artificial: se compara SHA-256 del archivo en placa vs el bundle.
 */

import { sha256HexUtf8 } from "./bleProtocol.js";

/** LF-normalize only (perfil PLACA_ACTUAL incluido). */
export function eda6FileHash(source) {
  return sha256HexUtf8(String(source ?? "").replace(/\r\n/g, "\n"));
}

/** Normaliza PLACA_ACTUAL para comparar semántica de librería entre perfiles. */
export function normalizeEda6SourceForHash(source) {
  return String(source ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/PLACA_ACTUAL\s*=\s*"[^"]*"/, 'PLACA_ACTUAL = "WEMOS"');
}

export function eda6CanonicalHash(source) {
  return sha256HexUtf8(normalizeEda6SourceForHash(source));
}

export function buildEda6ImportedPrelude(profile) {
  const placa = profile === "ESP32" ? "ESP32" : "WEMOS";
  return [
    "import EDA6",
    "try:",
    `    EDA6._aplicar_placa("${placa}")`,
    "except Exception:",
    `    EDA6.PLACA_ACTUAL = "${placa}"`,
    "from EDA6 import *",
    "try:",
    "    _pybot_cleanup_normal = EDA6._pybot_cleanup_normal",
    "except Exception:",
    "    pass",
    "",
  ].join("\n");
}

/** Probe de presencia (legacy / diagnóstico). */
export const EDA6_PRESENCE_QUERY_SCRIPT = [
  "try:",
  "    import EDA6",
  "    print('EDA6_OK')",
  "except Exception:",
  "    print('EDA6_MISSING')",
].join("\n");

/** SHA-256 exacto del archivo (solo normaliza CRLF→LF). */
export const EDA6_EXACT_HASH_QUERY_SCRIPT = [
  "try:",
  "    import binascii",
  "    try:",
  "        import hashlib",
  "    except ImportError:",
  "        import uhashlib as hashlib",
  "    text = open('EDA6.py', 'rb').read().decode().replace('\\r\\n', '\\n')",
  "    h = hashlib.sha256()",
  "    h.update(text.encode())",
  "    print('EDA6_HASH:' + binascii.hexlify(h.digest()).decode())",
  "except Exception:",
  "    print('EDA6_MISSING')",
].join("\n");

/**
 * SHA-256 con PLACA_ACTUAL normalizado a WEMOS (integridad semántica entre perfiles).
 */
export const EDA6_HASH_QUERY_SCRIPT = [
  "try:",
  "    import binascii",
  "    try:",
  "        import hashlib",
  "    except ImportError:",
  "        import uhashlib as hashlib",
  "    text = open('EDA6.py', 'rb').read().decode().replace('\\r\\n', '\\n')",
  "    marker = 'PLACA_ACTUAL'",
  "    idx = text.find(marker)",
  "    if idx >= 0:",
  "        j = idx + len(marker)",
  "        while j < len(text) and text[j] in ' \\t':",
  "            j += 1",
  "        if j < len(text) and text[j] == '=':",
  "            j += 1",
  "            while j < len(text) and text[j] in ' \\t':",
  "                j += 1",
  "            if j < len(text) and text[j] == '\"':",
  "                j += 1",
  "                while j < len(text) and text[j] != '\"':",
  "                    j += 1",
  "                if j < len(text) and text[j] == '\"':",
  "                    j += 1",
  "                    text = text[:idx] + 'PLACA_ACTUAL = \"WEMOS\"' + text[j:]",
  "    h = hashlib.sha256()",
  "    h.update(text.encode())",
  "    print('EDA6_HASH:' + binascii.hexlify(h.digest()).decode())",
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

export function parseEda6HashProbe(stdout) {
  const m = String(stdout ?? "").match(/EDA6_HASH:([0-9a-fA-F]{64})/);
  if (!m) return null;
  return m[1].toLowerCase();
}

/**
 * @param {string|null} boardHash hash en placa (null = ausente)
 * @param {string} expectedHash hash esperado
 */
export function eda6NeedsInstall(boardHash, expectedHash) {
  if (!expectedHash) return true;
  if (!boardHash) return true;
  return String(boardHash).toLowerCase() !== String(expectedHash).toLowerCase();
}

/**
 * USB: instala si el archivo no coincide exactamente con getSource() (perfil incluido).
 *
 * @param {{ execRaw: Function, installFile: Function }} session
 * @param {{ getSource: () => string, timeout?: number }} options
 */
export async function ensureEda6OnSession(session, options) {
  const timeout = options.timeout ?? 8000;
  const source = options.getSource();
  const expectedHash = eda6FileHash(source);
  let boardHash = null;
  try {
    const { stdout } = await session.execRaw(EDA6_EXACT_HASH_QUERY_SCRIPT, { timeout });
    boardHash = parseEda6HashProbe(stdout);
  } catch {
    boardHash = null;
  }
  if (!eda6NeedsInstall(boardHash, expectedHash)) {
    return { updated: false, present: true, hash: boardHash };
  }
  await session.installFile("EDA6.py", source);
  await session.execRaw(EDA6_INVALIDATE_SCRIPT, { timeout });
  return { updated: true, present: true, hash: expectedHash };
}

/**
 * BLE: no puede subir EDA6.py; exige contenido canónico (ignora solo PLACA_ACTUAL).
 * @throws {Error} EDA6_NEED_USB_SYNC si falta o el hash no coincide
 */
export async function assertEda6CanonicalOnSession(session, options) {
  const timeout = options.timeout ?? 8000;
  const source = options.getSource();
  const expectedHash = eda6CanonicalHash(source);
  let boardHash = null;
  try {
    const { stdout } = await session.execRaw(EDA6_HASH_QUERY_SCRIPT, { timeout });
    boardHash = parseEda6HashProbe(stdout);
  } catch {
    boardHash = null;
  }
  if (eda6NeedsInstall(boardHash, expectedHash)) {
    throw new Error("EDA6_NEED_USB_SYNC");
  }
  return { present: true, hash: boardHash };
}
