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
 *
 * La ESP32 tiene memoria acotada: se colecta GC entre archivos y se liberan
 * explícitamente los buffers grandes después de hash+compile. La verificación no
 * se relaja: siguen siendo obligatorios tamaño, hash, compilación e imports.
 */
export const PYBOT_USB_SELFTEST_SCRIPT = [
  "import json",
  "try:",
  "    import os",
  "    import gc",
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
  '        "missing": [],',
  '        "file_errors": {},',
  "    }",
  `    for fn in (${selftestFileTuple()}):`,
  "        gc.collect()",
  "        try:",
  "            f = open(fn, 'rb')",
  "            raw = f.read()",
  "            f.close()",
  "            r['sizes'][fn] = len(raw)",
  "            if len(raw) < 8:",
  '                r["files"] = False',
  "                r['file_errors'][fn] = 'too_small'",
  "            else:",
  "                h = hashlib.sha256(raw)",
  "                r['hashes'][fn] = binascii.hexlify(h.digest()).decode()",
  "                src = raw.decode()",
  "                compile(src, fn, 'exec')",
  "                del src",
  "                del h",
  "            if fn == 'boot.py':",
  "                r['boot'] = len(raw) >= 8",
  "            if fn == 'main.py':",
  "                r['main'] = len(raw) >= 8",
  "            del raw",
  "        except OSError as e:",
  '            r["files"] = False',
  "            r['missing'].append(fn)",
  "            r['file_errors'][fn] = 'os:' + str(e)",
  "        except Exception as e:",
  '            r["files"] = False',
  "            r['file_errors'][fn] = type(e).__name__ + ':' + str(e)",
  "        gc.collect()",
  "    try:",
  "        import EDA6",
  '        r["eda6"] = True',
  "    except Exception as e:",
  "        r['file_errors']['EDA6:import'] = type(e).__name__ + ':' + str(e)",
  "    gc.collect()",
  "    try:",
  "        import pybot_mpy",
  '        r["pybot_mpy"] = True',
  "    except Exception as e:",
  "        r['file_errors']['pybot_mpy:import'] = type(e).__name__ + ':' + str(e)",
  "    print('PYBOT_SELFTEST:OK', json.dumps(r))",
  "except Exception as e:",
  "    print('PYBOT_SELFTEST:FAIL', type(e).__name__ + ':' + str(e))",
].join("\n");

/**
 * Parsea stdout de PYBOT_USB_SELFTEST_SCRIPT.
 * @param {string} text
 * @param {string} [publishedVersion]
 */
export function parseSelftestOutput(text, publishedVersion = PYBOT_RUNTIME_VERSION) {
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
  for (const name of expected) {
    const size = sizes[name];
    if (!(typeof size === "number" && size >= 8)) sizesOk = false;
    if (typeof hashes[name] !== "string" || hashes[name].length === 0) hashesOk = false;
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

  let reason = null;
  if (!ok) {
    const parts = [];
    const missing = Array.isArray(data.missing) ? data.missing.filter(Boolean) : [];
    if (missing.length) parts.push("missing=" + missing.join(","));
    if (!runtimeOk) parts.push("runtime=" + String(data.runtime ?? "missing"));
    if (!protocolOk) parts.push("protocol=" + String(data.protocol ?? "missing"));
    if (!replOk) parts.push("repl_import");
    if (!rbleOk) parts.push("rble_import/version");
    if (!duptermOk) parts.push("dupterm");
    if (!eda6Ok) parts.push("EDA6_import");
    if (!mpyOk) parts.push("pybot_mpy_import");
    if (!bootOk) parts.push("boot.py");
    if (!mainOk) parts.push("main.py");
    if (!sizesOk) parts.push("sizes");
    if (!hashesOk) parts.push("hashes");
    const fileErrors = data.file_errors && typeof data.file_errors === "object" ? data.file_errors : {};
    const errorKeys = Object.keys(fileErrors);
    if (errorKeys.length) {
      parts.push("errors=" + errorKeys.map((k) => k + ":" + String(fileErrors[k])).join("|"));
    }
    reason = parts.join("; ") || "selftest_failed";
  }

  return {
    ok,
    reason,
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
  };
}
