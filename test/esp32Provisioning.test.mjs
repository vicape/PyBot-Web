import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runEsp32Provisioning } from "../src/esp32/provisionEsp32.js";
import { PHASE, BOARD_STATE, PROVISION_ERROR, isCriticalPhase, canCloseModal } from "../src/esp32/provisioningPhases.js";
import { classifyBoard } from "../src/esp32/boardProbe.js";
import { parseRuntimeVersionFromSource, expectedProvisionFiles, PYBOT_RUNTIME_FILES } from "../src/esp32/pybotInstallManifest.js";
import { PYBOT_RUNTIME_VERSION } from "../src/bleProtocol.js";
import { ESP32_GENERIC_FIRMWARE } from "../src/esp32/firmwareManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function firmwareBytes() {
  return new Uint8Array(32);
}

function provisionError(code, extra) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra || {});
  return err;
}

function createAdapters(overrides = {}) {
  const calls = {
    requestPort: 0,
    probeBoard: 0,
    connectBootloader: 0,
    eraseFlash: 0,
    writeFirmware: 0,
    resetAndRelease: 0,
    loadFirmware: 0,
    connectRepl: 0,
    installPybot: 0,
    verifyPybotFiles: 0,
    closePort: 0,
    progress: [],
  };
  const adapters = {
    async requestPort() {
      calls.requestPort += 1;
      if (typeof overrides.requestPort === "function") return overrides.requestPort();
      return { id: "port-1" };
    },
    async probeBoard(port) {
      calls.probeBoard += 1;
      if (typeof overrides.probeBoard === "function") return overrides.probeBoard(port);
      return { boardState: BOARD_STATE.VIRGIN, session: null };
    },
    async connectBootloader() {
      calls.connectBootloader += 1;
      if (typeof overrides.connectBootloader === "function") return overrides.connectBootloader();
      return { loader: {}, transport: {}, chipName: "ESP32" };
    },
    async eraseFlash() {
      calls.eraseFlash += 1;
      if (typeof overrides.eraseFlash === "function") return overrides.eraseFlash();
    },
    async writeFirmware(_ctx, bytes, opts) {
      calls.writeFirmware += 1;
      if (typeof overrides.writeFirmware === "function") {
        return overrides.writeFirmware(_ctx, bytes, opts);
      }
      const total = bytes.byteLength || 100;
      opts?.onProgress?.({ bytesWritten: total, bytesTotal: total, pct: 100 });
    },
    async resetAndRelease() {
      calls.resetAndRelease += 1;
      if (typeof overrides.resetAndRelease === "function") return overrides.resetAndRelease();
    },
    async loadFirmware() {
      calls.loadFirmware += 1;
      if (typeof overrides.loadFirmware === "function") return overrides.loadFirmware();
      const bytes = firmwareBytes();
      return { bytes, sha256: ESP32_GENERIC_FIRMWARE.sha256, manifest: ESP32_GENERIC_FIRMWARE };
    },
    async connectRepl() {
      calls.connectRepl += 1;
      if (typeof overrides.connectRepl === "function") return overrides.connectRepl();
      return { session: { id: "repl" } };
    },
    async installPybot() {
      calls.installPybot += 1;
      if (typeof overrides.installPybot === "function") return overrides.installPybot();
      return { size: 12 };
    },
    async verifyPybotFiles() {
      calls.verifyPybotFiles += 1;
      if (typeof overrides.verifyPybotFiles === "function") return overrides.verifyPybotFiles();
      return { ok: true, missing: [] };
    },
    async closePort() {
      calls.closePort += 1;
      if (typeof overrides.closePort === "function") return overrides.closePort();
    },
    async sleep() {},
  };
  return { adapters, calls };
}

function collectPhases(onStore) {
  const phases = [];
  return {
    phases,
    onPhase(ev) {
      phases.push(ev.phase);
      onStore?.(ev);
    },
  };
}

test("critical phases block modal close during erase/flash/verify", () => {
  assert.equal(isCriticalPhase(PHASE.FLASHING), true);
  assert.equal(isCriticalPhase(PHASE.ERASING), true);
  assert.equal(isCriticalPhase(PHASE.VERIFYING_FLASH), true);
  assert.equal(canCloseModal(PHASE.FLASHING), false);
  assert.equal(canCloseModal(PHASE.IDLE), true);
  assert.equal(canCloseModal(PHASE.READY), true);
});

test("classifyBoard: virgin / mpy only / old / ready", () => {
  assert.equal(classifyBoard({ hasMicroPython: false }), BOARD_STATE.VIRGIN);
  assert.equal(classifyBoard({ hasMicroPython: true, files: [] }), BOARD_STATE.MPY_ONLY);
  assert.equal(
    classifyBoard({
      hasMicroPython: true,
      files: ["pybot_ble.py", "main.py"],
      runtimeVersion: "3.2.7",
      publishedVersion: "4.0.0",
    }),
    BOARD_STATE.OLD_PYBOT,
  );
  assert.equal(
    classifyBoard({
      hasMicroPython: true,
      files: ["pybot_ble.py", "pybot_repl.py"],
      runtimeVersion: "4.0.0",
      publishedVersion: "4.0.0",
    }),
    BOARD_STATE.READY,
  );
});

test("parseRuntimeVersionFromSource reads pybot_ble.py constant", () => {
  const src = readFileSync(join(root, "firmware/pybot-ble-runtime/pybot_ble.py"), "utf8");
  assert.equal(parseRuntimeVersionFromSource(src), PYBOT_RUNTIME_VERSION);
});

test("chooser cancel is CANCELLED, not a scary ERROR", async () => {
  const { adapters, calls } = createAdapters({
    async requestPort() {
      const e = new Error("No port");
      e.name = "NotFoundError";
      throw e;
    },
  });
  const { phases, onPhase } = collectPhases();
  const result = await runEsp32Provisioning(adapters, { onPhase, autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, PROVISION_ERROR.PORT_CANCELLED);
  assert.equal(result.phase, PHASE.CANCELLED);
  assert.ok(!phases.includes(PHASE.READY));
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.writeFirmware, 0);
});

test("bootloader failure asks for BOOT button and does not mark READY", async () => {
  const { adapters, calls } = createAdapters({
    async connectBootloader() {
      throw provisionError(PROVISION_ERROR.BOOTLOADER_FAIL);
    },
  });
  const { phases, onPhase } = collectPhases();
  const result = await runEsp32Provisioning(adapters, { onPhase, autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, PROVISION_ERROR.BOOTLOADER_FAIL);
  assert.ok(phases.includes(PHASE.NEED_BOOT_BUTTON));
  assert.ok(!phases.includes(PHASE.READY));
  assert.equal(calls.writeFirmware, 0);
});

test("unsupported chip (S3) does not flash the classic image", async () => {
  const { adapters, calls } = createAdapters({
    async connectBootloader() {
      throw provisionError(PROVISION_ERROR.VARIANT_UNSUPPORTED, { chipName: "ESP32-S3" });
    },
  });
  const { phases, onPhase } = collectPhases();
  const result = await runEsp32Provisioning(adapters, { onPhase, autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.phase, PHASE.UNSUPPORTED_VARIANT);
  assert.equal(calls.loadFirmware, 0);
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.writeFirmware, 0);
  assert.ok(phases.includes(PHASE.UNSUPPORTED_VARIANT));
});

test("classic chip proceeds to erase/write after hash verify", async () => {
  const { adapters, calls } = createAdapters();
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, true);
  assert.equal(result.phase, PHASE.READY);
  assert.equal(result.flashed, true);
  assert.equal(calls.connectBootloader, 1);
  assert.equal(calls.loadFirmware, 1);
  assert.equal(calls.eraseFlash, 1);
  assert.equal(calls.writeFirmware, 1);
  assert.equal(calls.installPybot, 1);
  assert.equal(calls.verifyPybotFiles, 1);
  assert.ok(calls.connectRepl >= 2);
});

for (const pct of [10, 50, 95]) {
  test(`write failure at ${pct}% is ERROR, not READY, and retry is possible`, async () => {
    const { adapters, calls } = createAdapters({
      async writeFirmware(_ctx, bytes, opts) {
        const total = 1000;
        opts?.onProgress?.({ bytesWritten: Math.floor((pct / 100) * total), bytesTotal: total, pct });
        throw provisionError(PROVISION_ERROR.FLASH_FAIL);
      },
    });
    const { phases, onPhase } = collectPhases();
    const result = await runEsp32Provisioning(adapters, { onPhase, autoConfirm: true });
    assert.equal(result.ok, false);
    assert.equal(result.error, PROVISION_ERROR.FLASH_FAIL);
    assert.ok(phases.includes(PHASE.ERROR));
    assert.ok(!phases.includes(PHASE.READY));
    assert.equal(calls.installPybot, 0);
    assert.equal(result.flashed, false);
  });
}

test("REPL timeout after flash is not READY", async () => {
  let replCalls = 0;
  const { adapters } = createAdapters({
    async connectRepl() {
      replCalls += 1;
      throw new Error("NEEDS_PREP");
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, PROVISION_ERROR.REPL_TIMEOUT);
  assert.notEqual(result.phase, PHASE.READY);
  assert.ok(replCalls >= 1);
});

test("install files failure is not READY", async () => {
  const { adapters } = createAdapters({
    async installPybot() {
      throw new Error("BLE_INSTALL_VERIFY_FAIL");
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, PROVISION_ERROR.INSTALL_FAIL);
  assert.notEqual(result.phase, PHASE.READY);
});

test("file verify failure after install is not READY", async () => {
  const { adapters } = createAdapters({
    async verifyPybotFiles() {
      return { ok: false, missing: ["pybot_repl.py"] };
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, PROVISION_ERROR.VERIFY_FILES_FAIL);
  assert.notEqual(result.phase, PHASE.READY);
});

test("already prepared board does not erase", async () => {
  const { adapters, calls } = createAdapters({
    async probeBoard() {
      return {
        boardState: BOARD_STATE.READY,
        session: { id: "s" },
        files: expectedProvisionFiles(),
        runtimeVersion: "4.0.0",
      };
    },
  });
  const { phases, onPhase } = collectPhases();
  const result = await runEsp32Provisioning(adapters, { onPhase, autoConfirm: true });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyPrepared, true);
  assert.equal(result.flashed, false);
  assert.equal(result.phase, PHASE.ALREADY_PREPARED);
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.writeFirmware, 0);
  assert.equal(calls.installPybot, 0);
  assert.ok(phases.includes(PHASE.ALREADY_PREPARED));
  assert.ok(!phases.includes(PHASE.READY));
});

test("reinstall of a prepared board flashes after confirmation", async () => {
  const { adapters, calls } = createAdapters({
    async probeBoard() {
      return { boardState: BOARD_STATE.READY, session: { id: "s" } };
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true, forceReinstall: true });
  assert.equal(result.ok, true);
  assert.equal(result.flashed, true);
  assert.equal(calls.eraseFlash, 1);
  assert.equal(calls.writeFirmware, 1);
  assert.equal(calls.installPybot, 1);
});

test("MicroPython without PyBot installs files and does not reflash", async () => {
  const { adapters, calls } = createAdapters({
    async probeBoard() {
      return { boardState: BOARD_STATE.MPY_ONLY, session: { id: "mpy" }, files: [] };
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, true);
  assert.equal(result.flashed, false);
  assert.equal(result.installed, true);
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.writeFirmware, 0);
  assert.equal(calls.connectBootloader, 0);
  assert.equal(calls.installPybot, 1);
  assert.equal(result.phase, PHASE.READY);
});

test("old PyBot updates files without reflash", async () => {
  const { adapters, calls } = createAdapters({
    async probeBoard() {
      return {
        boardState: BOARD_STATE.OLD_PYBOT,
        session: { id: "old" },
        runtimeVersion: "3.2.7",
      };
    },
  });
  const result = await runEsp32Provisioning(adapters, { autoConfirm: true });
  assert.equal(result.ok, true);
  assert.equal(result.flashed, false);
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.installPybot, 1);
  assert.equal(result.phase, PHASE.READY);
});

test("declining destructive confirm cancels without erase", async () => {
  const { adapters, calls } = createAdapters();
  const result = await runEsp32Provisioning(adapters, {
    confirmFlash: async () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, PHASE.CANCELLED);
  assert.equal(calls.eraseFlash, 0);
  assert.equal(calls.writeFirmware, 0);
});

test("virgin board end-to-end simulated orchestration reaches READY", async () => {
  const events = [];
  const { adapters, calls } = createAdapters({
    async writeFirmware(_ctx, bytes, opts) {
      opts?.onProgress?.({ bytesWritten: 10, bytesTotal: 100, pct: 10 });
      opts?.onProgress?.({ bytesWritten: 50, bytesTotal: 100, pct: 50 });
      opts?.onProgress?.({ bytesWritten: 100, bytesTotal: 100, pct: 100 });
    },
  });
  const result = await runEsp32Provisioning(adapters, {
    autoConfirm: true,
    onPhase: (ev) => events.push(ev),
  });
  assert.equal(result.ok, true);
  assert.equal(result.phase, PHASE.READY);
  assert.equal(result.flashed, true);
  assert.equal(result.installed, true);
  const names = events.map((e) => e.phase);
  assert.ok(names.indexOf(PHASE.SELECTING_PORT) < names.indexOf(PHASE.PROBING));
  assert.ok(names.indexOf(PHASE.CONNECTING_BOOTLOADER) < names.indexOf(PHASE.IDENTIFYING_CHIP));
  assert.ok(names.indexOf(PHASE.IDENTIFYING_CHIP) < names.indexOf(PHASE.LOADING_FIRMWARE));
  assert.ok(names.indexOf(PHASE.VERIFYING_IMAGE_HASH) < names.indexOf(PHASE.ERASING));
  assert.ok(names.indexOf(PHASE.FLASHING) < names.indexOf(PHASE.WAITING_REPL));
  assert.ok(names.indexOf(PHASE.INSTALLING_PYBOT) < names.indexOf(PHASE.VERIFYING_FILES));
  assert.equal(names[names.length - 1], PHASE.READY);
  assert.equal(calls.verifyPybotFiles, 1);
  const flashEv = events.find((e) => e.phase === PHASE.FLASHING && e.pct === 50);
  assert.ok(flashEv, "real write progress should surface");
});

test("READY is never emitted from writeFlash alone", async () => {
  const { adapters } = createAdapters({
    async connectRepl() {
      throw new Error("no repl");
    },
  });
  const phases = [];
  const result = await runEsp32Provisioning(adapters, {
    autoConfirm: true,
    onPhase: (ev) => phases.push(ev.phase),
  });
  assert.equal(result.ok, false);
  assert.ok(!phases.includes(PHASE.READY));
});
