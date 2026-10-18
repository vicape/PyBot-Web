/**
 * C6-only module install helpers for Universal Lab.
 *
 * Board-scoped: does NOT change legacy MicroPythonSession.installFile
 * (EDA6 / classic ESP32 / Arduino paths). Fresh MicroPython filesystems
 * lack /pybot; installFile opens "pybot/…. __pybot_tmp" without mkdir.
 */

import { listC6ModulesForInstall } from "../pythonApi/boardModules.js";

/** Parent directory required by all C6_BOARD_MODULES paths. */
export const C6_MODULE_ROOT = "pybot";

/** Per-file install attempts (includes the first try). */
export const C6_MODULE_INSTALL_ATTEMPTS = 2;

/**
 * Safe recovery copy for terminals / errors.
 * Never implies automatic erase/reflash or verified hardware from cloud tests.
 */
export const C6_SAFE_RECOVERY_HINT =
  "Recovery (manual only): hold BOOT while pressing RESET (or reconnect with BOOT held) " +
  "to enter the USB bootloader; pick the correct USB serial device; flash the verified " +
  "official MicroPython image only via the explicit Flash button; then Connect to install " +
  "lab modules. Do not loop erase/reflash. Preserve data when possible. " +
  "Firmware flashed ≠ board operational. A dark LCD alone with stock ESP32_GENERIC_C6 " +
  "may be expected (no onboard LCD boot init) and does not prove hardware failure. " +
  "Cloud/CI tests never verify physical boards.";

/**
 * @param {{ stdout?: string, stderr?: string }} result
 * @param {string} marker
 */
function stdoutHas(result, marker) {
  return String(result?.stdout ?? "").includes(marker);
}

/**
 * Extract a short reason from REPL output for diagnostics (no secrets).
 * @param {{ stdout?: string, stderr?: string }} result
 */
function replReason(result) {
  const out = String(result?.stdout ?? "");
  const err = String(result?.stderr ?? "");
  const fail =
    out.match(/PYBOT_LAB_[A-Z_]+:([^\r\n]+)/) ||
    err.match(/OSError:\s*([^\r\n]+)/i) ||
    err.match(/([^\r\n]*Error[^\r\n]*)/i);
  if (fail) return String(fail[1] ?? fail[0]).trim().slice(0, 160);
  const compact = (err || out).replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 160) : "unknown";
}

/**
 * Validate MicroPython REPL + writable FS and ensure /pybot exists (idempotent).
 * @param {{ execRaw: (code: string, opts?: object) => Promise<{stdout?:string,stderr?:string}> }} session
 * @param {{ onLog?: (line: string) => void }} [options]
 * @returns {Promise<{ ok: true, path: string }>}
 */
export async function ensureC6PybotInstallRoot(session, options = {}) {
  const log = (line) => {
    try {
      options.onLog?.(line);
    } catch {
      /* diagnostics must not break install */
    }
  };

  if (!session || typeof session.execRaw !== "function") {
    throw new Error(
      `PREFLIGHT_REPL_FAIL:path=${C6_MODULE_ROOT} reason=no_execRaw`,
    );
  }

  log("PYBOT_LAB:PREFLIGHT checking MicroPython REPL…");
  let probe;
  try {
    probe = await session.execRaw("print('PYBOT_LAB_REPL_OK')", {
      timeout: 8000,
    });
  } catch (e) {
    throw new Error(
      `PREFLIGHT_REPL_FAIL:path=${C6_MODULE_ROOT} reason=${e?.message ?? String(e)}`,
    );
  }
  if (!stdoutHas(probe, "PYBOT_LAB_REPL_OK")) {
    throw new Error(
      `PREFLIGHT_REPL_FAIL:path=${C6_MODULE_ROOT} reason=${replReason(probe)}`,
    );
  }
  log("PYBOT_LAB:PREFLIGHT REPL OK");

  const mkdirScript = [
    "import os",
    `root='${C6_MODULE_ROOT}'`,
    "try:",
    "    os.stat(root)",
    "except OSError:",
    "    try:",
    "        os.mkdir(root)",
    "    except OSError as e:",
    "        print('PYBOT_LAB_MKDIR_FAIL:' + str(e))",
    "        raise",
    "p=root+'/.__pybot_preflight'",
    "try:",
    "    with open(p, 'wb') as f:",
    "        f.write(b'ok')",
    "    try:",
    "        os.remove(p)",
    "    except OSError:",
    "        pass",
    "except OSError as e:",
    "    print('PYBOT_LAB_FS_FAIL:' + str(e))",
    "    raise",
    "print('PYBOT_LAB_PREFLIGHT_OK')",
  ].join("\n");

  log(`PYBOT_LAB:PREFLIGHT ensuring directory /${C6_MODULE_ROOT} (idempotent mkdir)…`);
  let fsResult;
  try {
    fsResult = await session.execRaw(mkdirScript, { timeout: 8000 });
  } catch (e) {
    throw new Error(
      `PREFLIGHT_FS_FAIL:path=${C6_MODULE_ROOT} reason=${e?.message ?? String(e)}`,
    );
  }
  if (!stdoutHas(fsResult, "PYBOT_LAB_PREFLIGHT_OK")) {
    throw new Error(
      `PREFLIGHT_FS_FAIL:path=${C6_MODULE_ROOT} reason=${replReason(fsResult)}`,
    );
  }
  log(`PYBOT_LAB:PREFLIGHT /${C6_MODULE_ROOT} ready (writable)`);
  return { ok: true, path: C6_MODULE_ROOT };
}

/**
 * Preflight then install all C6 lab modules with limited retries.
 * Propagates path + reason; never reports success on partial failure.
 *
 * @param {{
 *   execRaw: Function,
 *   installFile: (path: string, source: string) => Promise<void>,
 * }} session
 * @param {{ onLog?: (line: string) => void }} [options]
 */
export async function installC6LabModules(session, options = {}) {
  const log = (line) => {
    try {
      options.onLog?.(line);
    } catch {
      /* ignore */
    }
  };

  await ensureC6PybotInstallRoot(session, options);

  const modules = listC6ModulesForInstall();
  let installed = 0;
  for (const [path, source] of modules) {
    let lastErr = null;
    for (let attempt = 1; attempt <= C6_MODULE_INSTALL_ATTEMPTS; attempt++) {
      try {
        log(
          `PYBOT_LAB:INSTALL ${path} (attempt ${attempt}/${C6_MODULE_INSTALL_ATTEMPTS})`,
        );
        await session.installFile(path, source);
        lastErr = null;
        installed += 1;
        break;
      } catch (e) {
        lastErr = e;
        log(
          `PYBOT_LAB:INSTALL_RETRY ${path} attempt=${attempt} reason=${e?.message ?? String(e)}`,
        );
      }
    }
    if (lastErr) {
      throw new Error(
        `INSTALL_FAIL:path=${path} reason=${lastErr?.message ?? String(lastErr)}`,
      );
    }
  }

  log(
    `PYBOT_LAB:MODULES_INSTALLED count=${installed} root=/${C6_MODULE_ROOT}`,
  );
  return { ok: true, installed, root: C6_MODULE_ROOT };
}
