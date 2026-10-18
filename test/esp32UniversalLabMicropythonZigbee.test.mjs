/**
 * Focused tests: MicroPython + native Zigbee (uZigbee v1.6 PoC) integration.
 * No fabricated RF pairing. Firmware binary checked only if a real build exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CAPABILITY_STATUS,
  BOARD_PROFILE_IDS,
  getCapability,
  listUsablePythonModules,
  describePythonModuleAvailability,
  ESP32_GENERIC_C6_FIRMWARE,
  C6_BOARD_MODULES,
  C6_FIRMWARE_MODE_MICROPYTHON,
  C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR,
  C6_FIRMWARE_MODE_MICROPYTHON_ZIGBEE,
  getDefaultC6FirmwareMode,
  clearC6FirmwareRuntimeMode,
  setC6FirmwareRuntimeMode,
  listC6FirmwareModeDescriptors,
  canSelectMicropythonZigbeeMode,
  canOfferMicropythonZigbeeFlash,
  assertMicropythonZigbeeFlashExplicitOptIn,
  describeMicropythonZigbeeReadiness,
  MICROPYTHON_ZIGBEE_MANIFEST_PATH,
  MICROPYTHON_ZIGBEE_PROJECT_DIR,
  MICROPYTHON_ZIGBEE_MANIFEST,
  loadMicropythonZigbeeManifest,
  isMicropythonZigbeeSourcePresent,
  resolveMicropythonZigbeeArtifact,
  isValidatedZigbeePackaging,
  getC6FirmwareModeSnapshot,
} from "../src/esp32UniversalLab/index.js";
import { ZIGBEE_PY_SOURCE } from "../src/esp32UniversalLab/pythonApi/zigbeePySource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fwRoot = join(root, MICROPYTHON_ZIGBEE_PROJECT_DIR);

test("MPY+ZB: isolated source tree, pins, partitions, licenses present", () => {
  assert.equal(isMicropythonZigbeeSourcePresent(), true);
  for (const rel of [
    "DECISION.md",
    "LICENSE_ATTRIBUTION.md",
    "PINS.json",
    "manifest.json",
    "partitions.csv",
    "flash_layout.json",
    "build.sh",
    "onboard/pybot_zigbee.py",
    "onboard/main.py",
    "docs/BACKUP_RESTORE.md",
    "docs/LIMITATIONS.md",
    "docs/BENCH_COMMISSIONING.md",
  ]) {
    assert.ok(existsSync(join(fwRoot, rel)), rel);
  }

  const pins = JSON.parse(readFileSync(join(fwRoot, "PINS.json"), "utf8"));
  assert.equal(pins.decision, "PIN_UZIGBEE_V1_6_AS_POC");
  assert.equal(pins.toolchain.espIdf, "v5.3.2");
  assert.equal(pins.upstream.zigbeeSdk["esp-zigbee-lib"], "~1.6.0");
  assert.equal(
    pins.upstream.commit,
    "ff25553c5fc9d59754eba9a89811e6433e0d4479",
  );
  assert.match(pins.incompatibleWith.espZigbeeLib, /2\.0\.0/);

  const decision = readFileSync(join(fwRoot, "DECISION.md"), "utf8");
  assert.match(decision, /PIN_UZIGBEE_V1_6_AS_POC/);
  assert.match(decision, /ZBOSS/);
  assert.doesNotMatch(decision, /mix v1.*v2 headers/i);

  const license = readFileSync(join(fwRoot, "LICENSE_ATTRIBUTION.md"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /esp-zboss-lib/);
  assert.match(license, /not redistribute/i);

  const parts = readFileSync(join(fwRoot, "partitions.csv"), "utf8");
  assert.match(parts, /factory.*0x10000.*0x390000/);
  assert.match(parts, /zb_storage/);
  assert.match(parts, /vfs/);
});

test("MPY+ZB: static validation gate passes", () => {
  const r = spawnSync("python3", [join(fwRoot, "scripts/validate_static.py")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /STATIC_VALIDATION: PASS/);
});

test("MPY+ZB: manifest JS mirrors disk; artifact BLOCKED; no invented READY", () => {
  const disk = JSON.parse(
    readFileSync(join(root, MICROPYTHON_ZIGBEE_MANIFEST_PATH), "utf8"),
  );
  const js = loadMicropythonZigbeeManifest();
  assert.equal(js.id, disk.id);
  assert.equal(js.decision, "PIN_UZIGBEE_V1_6_AS_POC");
  assert.equal(js.toolchain.espIdf, "v5.3.2");
  assert.equal(js.autoFlash, false);
  assert.equal(js.modeReady, false);
  assert.equal(js.zigbee.hardwareValidation, "UNVERIFIED");

  const art = resolveMicropythonZigbeeArtifact(js);
  assert.equal(art.status, "BLOCKED");
  assert.equal(art.sha256, null);
  assert.equal(art.autoFlash, false);

  const fakeReady = {
    ...MICROPYTHON_ZIGBEE_MANIFEST,
    artifact: {
      status: "READY",
      sha256: "deadbeef",
      filename: "nope.bin",
      flashOffset: 0,
      packaging: null,
    },
  };
  assert.equal(resolveMicropythonZigbeeArtifact(fakeReady).status, "BLOCKED");

  const appOnly = {
    status: "READY",
    sha256: "a".repeat(64),
    filename: "app.bin",
    flashOffset: 0,
    packaging: null,
    components: null,
  };
  assert.equal(isValidatedZigbeePackaging(appOnly), false);
});

test("MPY+ZB: mode NOT READY; never auto-flash; stock default preserved", () => {
  clearC6FirmwareRuntimeMode();
  assert.equal(getDefaultC6FirmwareMode(), C6_FIRMWARE_MODE_MICROPYTHON);
  assert.equal(canSelectMicropythonZigbeeMode(), false);
  assert.equal(canOfferMicropythonZigbeeFlash(), false);
  assert.throws(() => setC6FirmwareRuntimeMode(C6_FIRMWARE_MODE_MICROPYTHON_ZIGBEE));

  const modes = listC6FirmwareModeDescriptors();
  const mpyZb = modes.find((m) => m.id === C6_FIRMWARE_MODE_MICROPYTHON_ZIGBEE);
  assert.ok(mpyZb);
  assert.equal(mpyZb.selectable, false);
  assert.equal(mpyZb.autoFlash, false);
  assert.equal(mpyZb.modeReady, false);
  assert.match(mpyZb.warning, /NOT READY/i);

  const gate = assertMicropythonZigbeeFlashExplicitOptIn({
    explicitOptIn: true,
    acknowledgeErasesStockMicroPython: true,
  });
  assert.equal(gate.allowed, false);

  const interim = modes.find((m) => m.id === C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR);
  assert.ok(interim);
  assert.match(interim.warning, /not the desired standalone Python/i);

  const snap = getC6FirmwareModeSnapshot();
  assert.equal(snap.micropythonZigbee.artifact.status, "BLOCKED");
  assert.equal(snap.micropythonZigbee.modeReady, false);
  assert.equal(snap.micropythonZigbee.hardwareValidation, "UNVERIFIED");
});

test("MPY+ZB: profile Zigbee stays UNVERIFIED; stock C6 image preserved", () => {
  const c6Id = BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147;
  const zig = getCapability(c6Id, "zigbee");
  assert.equal(zig.status, CAPABILITY_STATUS.UNVERIFIED);
  assert.equal(zig.usable, false);
  assert.ok(!listUsablePythonModules(c6Id).includes("pybot.zigbee"));
  assert.equal(describePythonModuleAvailability(c6Id, "pybot.zigbee").usable, false);
  assert.match(zig.note, /UNVERIFIED/);
  // Profile file stays baseline (AC16 preserve); desired MPY+ZB path is documented elsewhere.
  assert.match(
    MICROPYTHON_ZIGBEE_MANIFEST.id,
    /^pybot-c6-micropython-zigbee$/,
  );

  const mp = join(
    root,
    "public/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
  );
  assert.ok(existsSync(mp));
  assert.equal(
    ESP32_GENERIC_C6_FIRMWARE.sha256,
    "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
  );
  assert.equal(
    MICROPYTHON_ZIGBEE_MANIFEST.restoreMicroPython.sha256,
    ESP32_GENERIC_C6_FIRMWARE.sha256,
  );
});

test("MPY+ZB: Python API / native interface contract (no mock radio)", () => {
  const py = C6_BOARD_MODULES["pybot/zigbee.py"];
  assert.equal(py, ZIGBEE_PY_SOURCE);
  const onboard = readFileSync(join(fwRoot, "onboard/pybot_zigbee.py"), "utf8");
  assert.equal(onboard, ZIGBEE_PY_SOURCE);

  assert.match(py, /import _uzigbee/);
  assert.match(py, /NATIVE_MODULE_MISSING/);
  assert.match(py, /def start_coordinator/);
  assert.match(py, /def permit_join/);
  assert.match(py, /PERMIT_JOIN_MAX_S/);
  assert.match(py, /def last_joined_short_addr/);
  assert.match(py, /def discover_active_endpoints/);
  assert.match(py, /def onoff_on/);
  assert.match(py, /def onoff_off/);
  assert.match(py, /def onoff_read/);
  assert.match(py, /CLUSTER_ON_OFF = 0x0006/);
  assert.match(py, /never invent/);
  assert.doesNotMatch(py, /class Mock|FakeRadio/);

  const mainPy = readFileSync(join(fwRoot, "onboard/main.py"), "utf8");
  assert.match(mainPy, /PERMIT_JOIN_ON_BOOT = False/);
  assert.doesNotMatch(mainPy, /while True:[\s\S]*permit_join/);
  assert.match(mainPy, /diagnose/);
});

test("MPY+ZB: autonomous boot assumptions documented; preflight build proof", () => {
  const mainPy = readFileSync(join(fwRoot, "onboard/main.py"), "utf8");
  assert.match(mainPy, /no PC|without PC|Boot-safe/i);
  assert.match(mainPy, /close_join|PERMIT_JOIN_ON_BOOT = False/);

  const buildSh = readFileSync(join(fwRoot, "build.sh"), "utf8");
  assert.match(buildSh, /BLOCKED/);
  assert.match(buildSh, /idf\.py/);
  assert.match(buildSh, /v5\.3\.2/);
  assert.match(buildSh, /sha256|hashlib\.sha256/);
  assert.match(buildSh, /multi-offset|bootloader/);
  assert.match(buildSh, /exit 2/);

  // Live preflight: without IDF, build must BLOCK without inventing .bin
  const r = spawnSync("bash", [join(fwRoot, "build.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH },
  });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const statusPath = join(fwRoot, "build-artifact/BUILD_STATUS.json");
  assert.ok(existsSync(statusPath));
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  assert.equal(status.status, "BLOCKED");
  assert.equal(status.sha256, null);
  assert.equal(status.filename, null);
  assert.match(status.reason || "", /idf\.py|ESP-IDF/i);

  const artifactDir = join(fwRoot, "build-artifact");
  const bins = readdirSync(artifactDir).filter((n) => n.endsWith(".bin"));
  assert.equal(bins.length, 0, "must not invent firmware .bin without real build");
});

test("MPY+ZB: firmware-binary gate only if real artifact built", () => {
  const readiness = describeMicropythonZigbeeReadiness();
  if (readiness.artifact.status !== "READY") {
    assert.equal(readiness.artifact.sha256, null);
    return;
  }
  // Only reached when a real READY artifact is recorded with packaging proof
  assert.ok(readiness.artifact.sha256);
  assert.ok(
    isValidatedZigbeePackaging({
      ...readiness.artifact,
      status: "READY",
    }),
  );
  const binPath = join(root, readiness.artifact.path || "");
  assert.ok(existsSync(binPath), "READY artifact path must exist on disk");
});

test("MPY+ZB: limitations + backup docs cover Tuya/Smart Life and coexistence", () => {
  const lim = readFileSync(join(fwRoot, "docs/LIMITATIONS.md"), "utf8");
  assert.match(lim, /0x0006/);
  assert.match(lim, /Tuya/);
  assert.match(lim, /Smart Life/);
  assert.match(lim, /no Tuya cloud/i);
  assert.match(lim, /user-supervised physical bench/i);
  assert.match(lim, /coexistence/i);
  assert.match(lim, /not.*proof/i);

  const bak = readFileSync(join(fwRoot, "docs/BACKUP_RESTORE.md"), "utf8");
  assert.match(bak, /ESP32_GENERIC_C6/);
  assert.match(bak, /111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183/);
  assert.match(bak, /Backup|backup/);
});
