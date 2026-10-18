/**
 * C6 module install preflight — fresh MicroPython FS lacks /pybot.
 * Proves INSTALL_FAIL without parent dir; mkdir + upload success; retries;
 * no false PASS; firmware ≠ operational. Does not claim hardware verified.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureC6PybotInstallRoot,
  installC6LabModules,
  C6_MODULE_ROOT,
  C6_SAFE_RECOVERY_HINT,
  C6_BOARD_MODULES,
  listC6ModulesForInstall,
  flashLabFirmware,
  getLabSession,
  clearLabBoardSelection,
  applyLabBoardSelection,
  BOARD_PROFILE_IDS,
  LAB_BOARD_TYPE_SENTINEL,
} from "../src/esp32UniversalLab/index.js";
import { C6_MODULE_INSTALL_ATTEMPTS } from "../src/esp32UniversalLab/runtime/c6ModuleInstall.js";
import { formatHardwareError } from "../src/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function clearLabOverrides() {
  delete globalThis.__PYBOT_ESP32_LAB_ENABLED__;
  delete globalThis.__PYBOT_ESP32_LAB_PROFILE__;
  clearLabBoardSelection();
}

/**
 * Simulates a fresh MicroPython VFS: no /pybot until mkdir.
 * Models installFile opening path + ".__pybot_tmp" without creating parents.
 */
function createFreshFsSession(options = {}) {
  const dirs = new Set(options.initialDirs ?? []);
  const files = new Map(options.initialFiles ?? []);
  const logs = [];
  let installCalls = 0;
  let failInstallTimes = options.failInstallTimes ?? 0;
  const scripts = [];

  function parentDir(path) {
    const i = path.lastIndexOf("/");
    return i <= 0 ? "" : path.slice(0, i);
  }

  async function execRaw(code) {
    const src = String(code ?? "");
    scripts.push(src);

    if (src.includes("PYBOT_LAB_REPL_OK") && !src.includes("PYBOT_LAB_PREFLIGHT")) {
      if (options.replFail) {
        return { stdout: "", stderr: "REPL dead\n" };
      }
      return { stdout: "PYBOT_LAB_REPL_OK\n", stderr: "" };
    }

    if (src.includes("os.mkdir") || src.includes("PYBOT_LAB_PREFLIGHT_OK")) {
      if (options.fsReadOnly) {
        return {
          stdout: "PYBOT_LAB_FS_FAIL:ENOENT read-only\n",
          stderr: "OSError: read-only\n",
        };
      }
      if (!dirs.has(C6_MODULE_ROOT)) {
        if (/os\.mkdir\(\s*root\s*\)/.test(src) || src.includes("os.mkdir(root)")) {
          dirs.add(C6_MODULE_ROOT);
        }
      }
      // Writable probe path pybot/.__pybot_preflight
      if (dirs.has(C6_MODULE_ROOT)) {
        return { stdout: "PYBOT_LAB_PREFLIGHT_OK\n", stderr: "" };
      }
      return {
        stdout: "PYBOT_LAB_MKDIR_FAIL:ENOENT\n",
        stderr: "OSError: [Errno 2] ENOENT\n",
      };
    }

    // Legacy-style temp open used by installFile (reproduced for proof test)
    if (/open\('([^']+)', 'wb'\)/.test(src) && /__pybot_tmp/.test(src)) {
      const m = src.match(/open\('([^']+)', 'wb'\)/);
      const tempPath = m[1];
      const parent = parentDir(tempPath);
      if (parent && !dirs.has(parent)) {
        return {
          stdout: "",
          stderr: `OSError: [Errno 2] ENOENT open ${tempPath}\n`,
        };
      }
      files.set(tempPath, "");
      return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
    }

    return { stdout: "PYBOT_INSTALL_OK\n", stderr: "" };
  }

  async function installFile(path, source) {
    installCalls += 1;
    const parent = parentDir(path);
    if (parent && !dirs.has(parent)) {
      // Mirror real failure: temp open ENOENT → INSTALL_FAIL (startup may omit OK check)
      const open = await execRaw(
        `with open('${path}.__pybot_tmp', 'wb') as f:\n    pass\nprint('PYBOT_INSTALL_OK')`,
      );
      if (!String(open.stdout).includes("PYBOT_INSTALL_OK")) {
        throw new Error("INSTALL_FAIL");
      }
    }
    if (failInstallTimes > 0) {
      failInstallTimes -= 1;
      throw new Error("INSTALL_FAIL");
    }
    if (options.alwaysFailInstall) {
      throw new Error("INSTALL_FAIL");
    }
    files.set(path, String(source ?? ""));
  }

  return {
    dirs,
    files,
    scripts,
    logs,
    get installCalls() {
      return installCalls;
    },
    execRaw,
    installFile,
    async close() {
      logs.push("closed");
    },
  };
}

test("AC root cause: install without /pybot yields INSTALL_FAIL (ENOENT temp)", async () => {
  const session = createFreshFsSession();
  assert.equal(session.dirs.has("pybot"), false);

  await assert.rejects(
    () => session.installFile("pybot/__init__.py", "#x\n"),
    /INSTALL_FAIL/,
  );
  assert.equal(session.files.has("pybot/__init__.py"), false);
  assert.equal(session.dirs.has("pybot"), false);
});

test("preflight mkdir is idempotent and marks /pybot writable", async () => {
  const session = createFreshFsSession();
  const logs = [];
  const r1 = await ensureC6PybotInstallRoot(session, {
    onLog: (l) => logs.push(l),
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.path, "pybot");
  assert.equal(session.dirs.has("pybot"), true);
  assert.ok(logs.some((l) => /PREFLIGHT/.test(l)));

  const r2 = await ensureC6PybotInstallRoot(session);
  assert.equal(r2.ok, true);
  assert.equal(session.dirs.has("pybot"), true);
});

test("preflight fails clearly when REPL marker missing", async () => {
  const session = createFreshFsSession({ replFail: true });
  await assert.rejects(
    () => ensureC6PybotInstallRoot(session),
    /PREFLIGHT_REPL_FAIL:path=pybot/,
  );
  assert.equal(session.dirs.has("pybot"), false);
});

test("preflight fails clearly when filesystem not writable", async () => {
  const session = createFreshFsSession({ fsReadOnly: true });
  await assert.rejects(
    () => ensureC6PybotInstallRoot(session),
    /PREFLIGHT_FS_FAIL:path=pybot/,
  );
});

test("installC6LabModules: mkdir then upload all modules; no false PASS on error", async () => {
  const session = createFreshFsSession();
  const logs = [];
  const result = await installC6LabModules(session, {
    onLog: (l) => logs.push(l),
  });
  assert.equal(result.ok, true);
  assert.equal(result.root, "pybot");
  const expected = listC6ModulesForInstall();
  assert.equal(result.installed, expected.length);
  for (const [path, source] of expected) {
    assert.equal(session.files.get(path), source);
  }
  assert.ok(logs.some((l) => /MODULES_INSTALLED/.test(l)));

  // Error propagation: do not leave partial success as ok
  const bad = createFreshFsSession({ alwaysFailInstall: true });
  await assert.rejects(
    () => installC6LabModules(bad),
    /INSTALL_FAIL:path=pybot\//,
  );
  assert.ok([...bad.files.keys()].every((k) => !k.endsWith(".py")));
});

test("installC6LabModules: retries then succeeds; exhausted retries propagate", async () => {
  assert.equal(C6_MODULE_INSTALL_ATTEMPTS, 2);
  const okAfterRetry = createFreshFsSession({ failInstallTimes: 1 });
  const r = await installC6LabModules(okAfterRetry);
  assert.equal(r.ok, true);
  assert.ok(okAfterRetry.installCalls >= listC6ModulesForInstall().length + 1);

  const always = createFreshFsSession({ alwaysFailInstall: true });
  await assert.rejects(() => installC6LabModules(always), /INSTALL_FAIL:path=/);
  // First module attempted C6_MODULE_INSTALL_ATTEMPTS times, then abort
  assert.equal(always.installCalls, C6_MODULE_INSTALL_ATTEMPTS);
});

test("C6 modules all live under pybot/; recovery hint is non-destructive", () => {
  for (const path of Object.keys(C6_BOARD_MODULES)) {
    assert.ok(path.startsWith("pybot/"), path);
  }
  assert.match(C6_SAFE_RECOVERY_HINT, /BOOT/);
  assert.match(C6_SAFE_RECOVERY_HINT, /RESET/);
  assert.match(C6_SAFE_RECOVERY_HINT, /manual|explicit|Do not loop/i);
  assert.match(C6_SAFE_RECOVERY_HINT, /dark LCD|LCD/i);
  assert.doesNotMatch(C6_SAFE_RECOVERY_HINT, /automatic reflash|wipe flash/i);
});

test("connectLabBoard: module install failure does not set session (no false PASS)", async () => {
  clearLabOverrides();
  applyLabBoardSelection(BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147);

  // Structural: adapter closes session and throws MODULE_INSTALL_FAIL
  const adapterSrc = readFileSync(
    join(root, "src/esp32UniversalLab/runtime/adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /installC6LabModules/);
  assert.match(adapterSrc, /MODULE_INSTALL_FAIL/);
  assert.match(adapterSrc, /session\.close/);
  assert.match(adapterSrc, /firmware flashed ≠ modules installed/);
  // Connect/recover must not auto-reflash (flashLabFirmware may still call writeC6Firmware).
  const connectFn = adapterSrc.slice(
    adapterSrc.indexOf("export async function connectLabBoard"),
    adapterSrc.indexOf("export async function flashLabFirmware"),
  );
  assert.doesNotMatch(connectFn, /writeC6Firmware|eraseFlash|erase_flash/);
  const recoverFn = adapterSrc.slice(
    adapterSrc.indexOf("export async function recoverLabBoard"),
    adapterSrc.indexOf("export async function disconnectLabBoard"),
  );
  assert.doesNotMatch(recoverFn, /writeC6Firmware|eraseFlash|erase_flash/);
  assert.match(recoverFn, /refrashed: false/);

  assert.equal(getLabSession(), null);
  clearLabOverrides();
});

test("flashLabFirmware message distinguishes firmware vs modules/LCD; no hardware claim", async () => {
  clearLabOverrides();
  // Source contract — flash success text
  const adapterSrc = readFileSync(
    join(root, "src/esp32UniversalLab/runtime/adapter.js"),
    "utf8",
  );
  assert.match(adapterSrc, /Firmware flashed ≠ modules installed/);
  assert.match(adapterSrc, /LCD may remain dark/);
  assert.match(adapterSrc, /modulesInstalled: false/);
  assert.match(adapterSrc, /connected: false/);
  assert.match(adapterSrc, /hardwareValidation: "UNVERIFIED"/);
  assert.match(adapterSrc, /C6_SAFE_RECOVERY_HINT/);

  await assert.rejects(
    () => flashLabFirmware(LAB_BOARD_TYPE_SENTINEL),
    /Esp32UniversalLabNotActiveError|not active/i,
  );
  clearLabOverrides();
});

test("legacy installFile still lacks mkdir — C6 helper owns the fix (no shared refactor)", () => {
  const sessionSrc = readFileSync(
    join(root, "src/micropython/micropythonSession.js"),
    "utf8",
  );
  const fn = sessionSrc.slice(
    sessionSrc.indexOf("async installFile("),
    sessionSrc.indexOf("async syncFilesystem("),
  );
  assert.doesNotMatch(fn, /os\.mkdir|makedirs/);
  assert.match(fn, /\.__pybot_tmp/);
  // First temp open prints OK but never checks stdout (obscures ENOENT); C6 preflight covers.
  const firstOpen = fn.slice(0, fn.indexOf("const total = expected"));
  assert.match(firstOpen, /open\('\$\{safeTemp\}', 'wb'\)/);
  assert.match(firstOpen, /print\('PYBOT_INSTALL_OK'\)/);
  assert.doesNotMatch(firstOpen, /includes\(["']PYBOT_INSTALL_OK["']\)/);
});

test("formatHardwareError: MODULE_INSTALL_FAIL / NEEDS_FIRMWARE safe copy", () => {
  const mod = formatHardwareError(
    "PYBOT_LAB:MODULE_INSTALL_FAIL:INSTALL_FAIL:path=pybot/__init__.py reason=INSTALL_FAIL",
  );
  assert.match(mod, /module install failed|instalación de módulos/i);
  assert.match(mod, /BOOT|pybot/i);

  const needs = formatHardwareError("PYBOT_LAB:NEEDS_FIRMWARE missing");
  assert.match(needs, /MicroPython|Instalar MicroPython/i);
  assert.match(needs, /BOOT|explícit|explicit/i);

  const conn = formatHardwareError("PYBOT_LAB:CONNECT_FAIL:timeout");
  assert.match(conn, /REPL|conectar/i);
});

test("IDE wires onLog diagnostics for lab connect; recover does not wipe", () => {
  const ide = readFileSync(join(root, "src/PyBotIDE.jsx"), "utf8");
  assert.match(ide, /connectLabBoard\(LAB_BOARD_TYPE_SENTINEL,\s*\{/);
  assert.match(ide, /onLog:/);
  assert.match(ide, /recoverLabBoard/);
  assert.doesNotMatch(
    ide.slice(ide.indexOf("labRecoverBtn"), ide.indexOf("labRecoverBtn") + 400),
    /flashLabFirmware/,
  );
});

test("c6ModuleInstall helper is board-scoped (no EDA6/legacy imports)", () => {
  const src = readFileSync(
    join(root, "src/esp32UniversalLab/runtime/c6ModuleInstall.js"),
    "utf8",
  );
  assert.doesNotMatch(src, /from ["'].*hardwareBridge/);
  assert.doesNotMatch(src, /from ["'].*provisionEsp32/);
  assert.doesNotMatch(src, /from ["'].*eda6/i);
  assert.match(src, /ensureC6PybotInstallRoot/);
  assert.match(src, /installC6LabModules/);
  assert.match(src, /os\.mkdir/);
});
