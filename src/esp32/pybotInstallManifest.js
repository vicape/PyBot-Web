/**
 * Manifest unificado de instalación PyBot en ESP32.
 * Fuente de verdad para: install, reinstall, verify, diagnose, READY/OLD/INCOMPLETE.
 * Los bytes de cada archivo viven en pybotBleRuntime.js (imports ?raw); acá solo
 * nombres, orden, versión/protocolo requeridos, MicroPython compatible y scripts
 * de verificación USB.
 */

import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION } from "../bleProtocol.js";
import { ESP32_GENERIC_FIRMWARE } from "./firmwareManifest.js";

export const PYBOT_MARKER_FILE = "pybot_ble.py";

/** MicroPython oficial que PyBot flashea (y que se considera compatible). */
export const PYBOT_REQUIRED_MICROPYTHON = ESP32_GENERIC_FIRMWARE.version;

export const PYBOT_REQUIRED_PROTOCOL = PYBOT_PROTOCOL_VERSION;

/** Orden de instalación USB: boot.py primero, luego módulos del runtime. */
export const PYBOT_RUNTIME_FILES = Object.freeze([
  "boot.py",
  "main.py",
  "pybot_ble.py",
  "pybot_run.py",
  "pybot_deploy.py",
  "pybot_update.py",
  "pybot_boot_update.py",
  "pybot_repl.py",
  "pybot_rble.py",
  "pybot_net.py",
  "pybot_mpy.py",
]);

/** Módulos del runtime (sin boot.py) — pack OTA PYBOTRT1. */
export const PYBOT_RUNTIME_MODULE_FILES = Object.freeze(
  PYBOT_RUNTIME_FILES.filter((n) => n !== "boot.py"),
);

export const PYBOT_PROVISION_EXTRA_FILES = Object.freeze(["EDA6.py"]);

/** Todos los archivos obligatorios en la placa tras preparar/reinstalar. */
export function expectedProvisionFiles() {
  const extra = PYBOT_PROVISION_EXTRA_FILES.filter((n) => !PYBOT_RUNTIME_FILES.includes(n));
  return [...PYBOT_RUNTIME_FILES, ...extra];
}

export function parseRuntimeVersionFromSource(text) {
  const m = String(text ?? "").match(/PYBOT_RUNTIME_VERSION\s*=\s*["']([\d.]+)["']/);
  return m ? m[1] : null;
}

/** Archivos del manifest que faltan en la lista detectada en placa. */
export function missingProvisionFiles(present) {
  const have = new Set(Array.isArray(present) ? present : []);
  return expectedProvisionFiles().filter((name) => !have.has(name));
}

/**
 * True si la versión de MicroPython en placa coincide con la imagen oficial.
 * Si no hay versión (REPL habla pero no se pudo parsear), no se fuerza reflash.
 */
export function isCompatibleMicroPython(version) {
  const v = String(version ?? "").trim();
  if (!v) return true;
  const required = PYBOT_REQUIRED_MICROPYTHON;
  return v === required || v.startsWith(required + ".");
}

function selftestFileTuple() {
  return expectedProvisionFiles()
    .filter((n) => n.endsWith(".py"))
    .map((n) => `"${n}"`)
    .join(", ");
}

/**
 * Script MicroPython ejecutado por USB tras install/reinstall.
 * Debe imprimir una línea `PYBOT_SELFTEST:OK` + JSON con runtime, protocol, files, etc.
 */
export const PYBOT_USB_SELFTEST_SCRIPT = [
  "import json",
  "try:",
  "    import os",
  "    import binascii",
  "    try:",
  "        import hashlib",
  "    except ImportError:",
  "        import uhashlib as hashlib",
    "    import pybot_ble",
    "    import pybot_repl",
    "    import pybot_rble",
    "    r = {",
    '        "runtime": pybot_ble.PYBOT_RUNTIME_VERSION,',
    '        "protocol": pybot_ble.PYBOT_PROTOCOL_VERSION,',
    '        "repl_import": True,',
    '        "rble_import": True,',
    '        "rble_version": getattr(pybot_rble, "RBLE_VERSION", 0),',
    '        "dupterm_available": hasattr(os, "dupterm"),',
  '        "eda6": False,',
  '        "pybot_mpy": False,',
  '        "files": True,',
  '        "boot": False,',
  '        "main": False,',
  '        "hashes": {},',
  '        "sizes": {},',
  "    }",
  "    try:",
  "        import EDA6",
  '        r["eda6"] = True',
  "    except Exception:",
  "        pass",
  "    try:",
  "        import pybot_mpy",
  '        r["pybot_mpy"] = True',
  "    except Exception:",
  "        pass",
  "    import gc",
  "    gc.collect()",
  `    for fn in (${selftestFileTuple()}):`,
  "        try:",
  "            size = os.stat(fn)[6]",
  "            r['sizes'][fn] = size",
  "            if size < 8:",
  '                r["files"] = False',
  "                r['hashes'][fn] = ''",
  "            else:",
  "                h = hashlib.sha256()",
  "                f = open(fn, 'rb')",
  "                while True:",
  "                    chunk = f.read(256)",
  "                    if not chunk:",
  "                        break",
  "                    h.update(chunk)",
  "                f.close()",
  "                try:",
  "                    r['hashes'][fn] = binascii.hexlify(h.digest()).decode()",
  "                except Exception:",
  "                    r['hashes'][fn] = ''",
  "                    r['files'] = False",
  "            if fn == 'boot.py':",
  "                r['boot'] = size >= 8",
  "            if fn == 'main.py':",
  "                r['main'] = size >= 8",
  "            gc.collect()",
  "        except Exception:",
  '            r["files"] = False',
  "    print('PYBOT_SELFTEST:OK', json.dumps(r))",
  "except Exception as e:",
  "    print('PYBOT_SELFTEST:FAIL', str(e))",
].join("\n");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Parsea stdout de PYBOT_USB_SELFTEST_SCRIPT.
 * @param {string} text
 * @param {string} [publishedVersion]
 * @param {Record<string, string>|null|undefined} [expectedHashes]
 *   Si se pasa (flujo USB real), cada archivo obligatorio debe coincidir
 *   byte-for-byte con el SHA-256 del source instalado. Si se omite, solo se
 *   exige hash no vacío (compat tests unitarios históricos).
 */
export function parseSelftestOutput(
  text,
  publishedVersion = PYBOT_RUNTIME_VERSION,
  expectedHashes = undefined,
) {
  const raw = String(text ?? "");
  const idx = raw.indexOf("PYBOT_SELFTEST:OK");
  if (idx < 0) {
    const failIdx = raw.indexOf("PYBOT_SELFTEST:FAIL");
    const reason = failIdx >= 0 ? raw.slice(failIdx + "PYBOT_SELFTEST:FAIL".length).trim() : "missing marker";
    return { ok: false, reason };
  }
  const tail = raw.slice(idx + "PYBOT_SELFTEST:OK".length).trim();
  const nl = tail.indexOf("\n");
  const jsonPart = nl >= 0 ? tail.slice(0, nl).trim() : tail;
  let data;
  try {
    data = JSON.parse(jsonPart);
  } catch {
    return { ok: false, reason: "invalid json" };
  }
  const expected = expectedProvisionFiles().filter((n) => n.endsWith(".py"));
  const runtimeOk = data.runtime === publishedVersion;
  const protocolOk = data.protocol === PYBOT_REQUIRED_PROTOCOL;
  const replOk = data.repl_import === true;
  const rbleOk = data.rble_import === true && data.rble_version === 1;
  const duptermOk = data.dupterm_available === true;
  const filesOk = data.files === true;
  const eda6Ok = data.eda6 === true;
  const mpyOk = data.pybot_mpy === true;
  const bootOk = data.boot === true;
  const mainOk = data.main === true;
  const sizes = data.sizes && typeof data.sizes === "object" ? data.sizes : {};
  const hashes = data.hashes && typeof data.hashes === "object" ? data.hashes : {};
  let sizesOk = true;
  let hashesOk = true;
  const hashMismatches = [];
  const requireExpected = expectedHashes != null && typeof expectedHashes === "object";
  for (const name of expected) {
    const size = sizes[name];
    if (!(typeof size === "number" && size >= 8)) sizesOk = false;
    const actualRaw = hashes[name];
    const actual = String(actualRaw ?? "").trim().toLowerCase();
    if (!requireExpected) {
      if (typeof actualRaw !== "string" || actualRaw.length === 0) hashesOk = false;
      continue;
    }
    const expectedRaw = expectedHashes[name];
    // EDA6 original en placa: si no hay hash esperado del bundle, basta presencia.
    if (name === "EDA6.py" && (expectedRaw == null || expectedRaw === "")) {
      if (typeof actualRaw !== "string" || actualRaw.length === 0) hashesOk = false;
      continue;
    }
    const expectedNorm = String(expectedRaw ?? "").trim().toLowerCase();
    const actualValid = SHA256_HEX_RE.test(actual);
    const expectedValid = SHA256_HEX_RE.test(expectedNorm);
    if (!actualValid || !expectedValid || actual !== expectedNorm) {
      hashesOk = false;
      hashMismatches.push({
        name,
        expected: expectedValid ? expectedNorm : "",
        actual: actualValid ? actual : String(actualRaw ?? ""),
      });
    }
  }
  const ok =
    runtimeOk &&
    protocolOk &&
    replOk &&
    rbleOk &&
    duptermOk &&
    filesOk &&
    eda6Ok &&
    mpyOk &&
    bootOk &&
    mainOk &&
    sizesOk &&
    hashesOk;
  const out = {
    ok,
    data,
    runtimeOk,
    protocolOk,
    replOk,
    rbleOk,
    duptermOk,
    filesOk,
    eda6Ok,
    mpyOk,
    bootOk,
    mainOk,
    sizesOk,
    hashesOk,
    hashMismatches,
  };
  if (!ok && requireExpected && hashMismatches.length > 0) {
    out.reason = "hash_mismatch";
  }
  return out;
}
