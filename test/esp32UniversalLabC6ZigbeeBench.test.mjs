import { test } from "node:test";
import assert from "node:assert/strict";
import {
  C6_ZIGBEE_BENCH_PACKAGE,
  C6_ZIGBEE_BENCH_UI_LABEL,
  C6_ZIGBEE_BENCH_DISTRIBUTION,
  C6_ZIGBEE_BENCH_POST_FLASH_CHECKS,
  C6_ZIGBEE_BENCH_PRESERVED_VFS_PATHS,
  C6_FULL_FLASH_BYTES,
  validateC6ZigbeeBenchFiles,
  assertC6ZigbeeBenchFlashConsent,
  flashC6ZigbeeBenchPackage,
  resolveC6ZigbeeBenchPackageFetch,
  detectC6ZigbeeBenchTarget,
  backupC6ZigbeeBenchFlash,
  describeC6ZigbeeBenchGateReason,
} from "../src/esp32UniversalLab/runtime/c6ZigbeeBench.js";
import {
  writeC6MultiOffsetFirmware,
  detectC6ChipAndFlashSize,
  readC6FullFlashBackup,
  saveC6BackupToUserFile,
} from "../src/esp32UniversalLab/runtime/c6Flasher.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const specs = C6_ZIGBEE_BENCH_PACKAGE.components;
function file(spec, name = spec.name, size = spec.size) {
  const bytes = new Uint8Array(size);
  return { name, size, arrayBuffer: async () => bytes.buffer };
}
const mockDigest = async (bytes) => {
  const matching = specs.find((s) => s.size === bytes.byteLength);
  return matching?.sha256 ?? "0".repeat(64);
};

const here = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(join(here, "../src/C6ZigbeeBenchModal.jsx"), "utf8");
const benchSrc = readFileSync(join(here, "../src/esp32UniversalLab/runtime/c6ZigbeeBench.js"), "utf8");
const flasherSrc = readFileSync(join(here, "../src/esp32UniversalLab/runtime/c6Flasher.js"), "utf8");
const ideSrc = readFileSync(join(here, "../src/PyBotIDE.jsx"), "utf8");
const i18nSrc = readFileSync(join(here, "../src/i18n.js"), "utf8");

test("C6 Zigbee: only pinned 4 MB C6 private package, never production READY", () => {
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.publicReady, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.autoFlash, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.hardwareValidation, "UNVERIFIED");
  assert.deepEqual(specs.map((s) => s.address), [0, 0x8000, 0x10000]);
  assert.equal(specs[2].size, 3221280);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.board, "waveshare-esp32-c6-lcd-1.47");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId, "39193349317");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId, "12161052985");
});

test("C6 Zigbee: UI label is exactly Preparar e instalar", () => {
  assert.equal(C6_ZIGBEE_BENCH_UI_LABEL, "Preparar e instalar");
  assert.match(modalSrc, /Preparar e instalar/);
});

test("C6 Zigbee: menu separates MicroPython+Zigbee install from ESP-IDF coordinator", () => {
  assert.match(ideSrc, /lab-mpy-zigbee-section/);
  assert.match(ideSrc, /lab-c6-zigbee-bench-entry/);
  assert.match(ideSrc, /data-zigbee-path="esp-idf-coordinator"/);
  assert.match(ideSrc, /toolbar-menu-item--highlight/);
  assert.match(i18nSrc, /labMpyZigbeeSection/);
  assert.match(i18nSrc, /labZigbeeCoordinatorSection/);
  assert.doesNotMatch(i18nSrc, /Zigbee coordinador: BLOCKED/);
  assert.doesNotMatch(i18nSrc, /Zigbee coordinator: BLOCKED/);
  // Desired path entry appears before ESP-IDF coordinator status in the board menu.
  const mpyIdx = ideSrc.indexOf('data-testid="lab-c6-zigbee-bench-entry"');
  const coordIdx = ideSrc.indexOf('data-testid="lab-zigbee-status"');
  assert.ok(mpyIdx > 0 && coordIdx > mpyIdx);
});

test("C6 Zigbee: compact 4-step installer with honest distribution blocker", () => {
  assert.match(modalSrc, /lab-c6-zigbee-bench-step-1/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-step-2/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-step-3/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-step-4/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-path-label/);
  assert.match(modalSrc, /MicroPython \+ native Zigbee|_uzigbee/);
  assert.match(modalSrc, /not the ESP-IDF coordinator|no es el coordinador ESP-IDF/);
  assert.equal(describeC6ZigbeeBenchGateReason("BENCH_BACKUP_REQUIRED", "es").length > 10, true);
  assert.match(describeC6ZigbeeBenchGateReason("BENCH_DISCONNECT_FIRST", "en"), /Disconnect/);
});

test("C6 Zigbee: TARGET vicape/PyBot-Web + backup preserves /main.py /boot.py /pybot/assets", () => {
  assert.match(benchSrc, /vicape\/PyBot-Web/);
  assert.deepEqual(C6_ZIGBEE_BENCH_PRESERVED_VFS_PATHS, [
    "/main.py",
    "/boot.py",
    "/pybot/assets",
  ]);
  assert.match(flasherSrc, /\/main\.py/);
  assert.match(flasherSrc, /\/boot\.py/);
  assert.match(flasherSrc, /\/pybot\/assets/);
  const root = join(here, "..");
  assert.equal(existsSync(join(root, "main.py")), true);
  assert.equal(existsSync(join(root, "boot.py")), true);
  assert.equal(existsSync(join(root, "pybot/assets")), true);
  assert.match(readFileSync(join(root, "main.py"), "utf8"), /vicape\/PyBot-Web/);
});

test("C6 Zigbee: automatic fetch returns DECISION REQUIRED without secrets or simulated fetch", () => {
  const resolved = resolveC6ZigbeeBenchPackageFetch();
  assert.equal(resolved.status, "DECISION REQUIRED");
  assert.equal(C6_ZIGBEE_BENCH_DISTRIBUTION.status, "DECISION REQUIRED");
  assert.equal(resolved.automaticFetchSupported, false);
  assert.equal(resolved.authorizedEndpointSupported, false);
  assert.ok(resolved.blockers.length >= 3);
  assert.ok(resolved.alternatives.length >= 3);
  assert.doesNotMatch(benchSrc, /github_pat_|ghp_|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|service_role/i);
  assert.doesNotMatch(modalSrc, /github_pat_|ghp_|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|service_role/i);
  // Provenance URL may be documented; must not be used as fetch() target in frontend code.
  assert.doesNotMatch(benchSrc, /fetch\(\s*C6_ZIGBEE_BENCH_PACKAGE\.sourceArtifact/);
  assert.doesNotMatch(modalSrc, /fetch\(\s*C6_ZIGBEE_BENCH_PACKAGE\.sourceArtifact/);
});

test("C6 Zigbee: exact three binary names, SHA and bytes validated before WebSerial", async () => {
  const valid = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: mockDigest });
  assert.equal(valid.ok, true, valid.reason || 'validation failed');
  assert.equal(valid.autoFlash, false);
  assert.deepEqual(valid.segments.map((s) => s.address), [0, 0x8000, 0x10000]);

  const missing = await validateC6ZigbeeBenchFiles(specs.slice(0, 2).map((s) => file(s)), { digest: mockDigest });
  assert.equal(missing.ok, false);
  const renamed = await validateC6ZigbeeBenchFiles([file(specs[0]), file(specs[1]), file(specs[2], "unknown-app.bin")], { digest: mockDigest });
  assert.match(renamed.reason, /FILE_MISSING_OR_WRONG/);
  const truncated = await validateC6ZigbeeBenchFiles([file(specs[0]), file(specs[1]), file(specs[2], specs[2].name, 1200)], { digest: mockDigest });
  assert.match(truncated.reason, /SIZE_MISMATCH/);
  const tampered = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: async () => "0".repeat(64) });
  assert.match(tampered.reason, /SHA256_MISMATCH/);
});

test("C6 Zigbee: detect requires ESP32-C6 and exact 4MB; wrong flash fails closed", async () => {
  const ok = await detectC6ChipAndFlashSize({
    chipName: "ESP32-C6",
    loader: { detectFlashSize: async () => "4MB" },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.flashBytes, C6_FULL_FLASH_BYTES);

  const wrongSize = await detectC6ChipAndFlashSize({
    chipName: "ESP32-C6",
    loader: { detectFlashSize: async () => "8MB" },
  });
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.reason, /FLASH_NOT_4MB/);

  const wrongChip = await detectC6ChipAndFlashSize({
    chipName: "ESP32-S3",
    loader: { detectFlashSize: async () => "4MB" },
  });
  assert.equal(wrongChip.ok, false);

  const noDetect = await detectC6ChipAndFlashSize({ chipName: "ESP32-C6", loader: {} });
  assert.equal(noDetect.ok, false);
  assert.match(noDetect.reason, /FLASH_DETECT_UNAVAILABLE/);
});

test("C6 Zigbee: full 4 MB readFlash backup verifies size; missing capability fails closed", async () => {
  const bytes = new Uint8Array(C6_FULL_FLASH_BYTES);
  const read = await readC6FullFlashBackup({
    loader: { readFlash: async (addr, size) => {
      assert.equal(addr, 0);
      assert.equal(size, C6_FULL_FLASH_BYTES);
      return bytes;
    } },
  });
  assert.equal(read.ok, true);
  assert.equal(read.byteLength, C6_FULL_FLASH_BYTES);

  await assert.rejects(
    () => readC6FullFlashBackup({ loader: {} }),
    /LAB_READ_FLASH_UNAVAILABLE/,
  );
  await assert.rejects(
    () => readC6FullFlashBackup({
      loader: { readFlash: async () => new Uint8Array(100) },
    }),
    /LAB_BACKUP_SIZE_MISMATCH/,
  );
  assert.match(flasherSrc, /readFlash/);
});

test("C6 Zigbee: save backup — picker confirms; anchor requires ack limitation", async () => {
  const image = new Uint8Array(C6_FULL_FLASH_BYTES);
  const confirmed = await saveC6BackupToUserFile(image, {
    showSaveFilePicker: async () => ({
      name: "backup.bin",
      createWritable: async () => {
        const chunks = [];
        return {
          write: async (data) => { chunks.push(data); },
          close: async () => {
            assert.equal(chunks[0].byteLength, C6_FULL_FLASH_BYTES);
          },
        };
      },
    }),
  });
  assert.equal(confirmed.downloadConfirmed, true);
  assert.equal(confirmed.byteLength, C6_FULL_FLASH_BYTES);

  const clicks = [];
  const anchor = await saveC6BackupToUserFile(image, {
    showSaveFilePicker: null,
    document: {
      createElement: () => {
        const el = { click: () => clicks.push(1), remove() {}, href: "", download: "" };
        return el;
      },
      body: { appendChild() {} },
    },
  });
  assert.equal(anchor.downloadConfirmed, false);
  assert.ok(anchor.limitation);
  assert.equal(clicks.length, 1);
});

test("C6 Zigbee: consent requires detection + verified backup + erase + ESP32-C6; no port before gates", async () => {
  const validated = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: mockDigest });
  const detection = { ok: true, chipName: "ESP32-C6", flashSize: "4MB", flashBytes: C6_FULL_FLASH_BYTES };
  const backupResult = {
    ok: true,
    byteLength: C6_FULL_FLASH_BYTES,
    downloadConfirmed: true,
    fileName: "backup.bin",
  };
  const base = {
    validated,
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    connected: false,
    detection,
    backupResult,
    backupDownloadAcknowledged: false,
    eraseAcknowledged: true,
    secondConfirmation: "ESP32-C6",
  };
  assert.equal(assertC6ZigbeeBenchFlashConsent(base).allowed, true);

  // Anchor-download path: needs explicit ack when downloadConfirmed is false
  assert.equal(assertC6ZigbeeBenchFlashConsent({
    ...base,
    backupResult: { ...backupResult, downloadConfirmed: false },
  }).allowed, false);
  assert.equal(assertC6ZigbeeBenchFlashConsent({
    ...base,
    backupResult: { ...backupResult, downloadConfirmed: false },
    backupDownloadAcknowledged: true,
  }).allowed, true);

  for (const override of [
    { validated: null },
    { profileId: "some-other-board" },
    { connected: true },
    { detection: null },
    { detection: { ok: false, reason: "LAB_FLASH_NOT_4MB" } },
    { detection: { ok: true, chipName: "ESP32-C6", flashSize: "8MB" } },
    { backupResult: null },
    { backupResult: { ok: false, byteLength: 0 } },
    { backupResult: { ok: true, byteLength: 100, downloadConfirmed: true } },
    { eraseAcknowledged: false },
    { secondConfirmation: "" },
  ]) {
    assert.equal(assertC6ZigbeeBenchFlashConsent({ ...base, ...override }).allowed, false);
  }
  let portRequested = false;
  await assert.rejects(
    () => flashC6ZigbeeBenchPackage(validated, {
      ...base,
      eraseAcknowledged: false,
      requestPort: async () => { portRequested = true; return {}; },
    }),
    /BENCH_ERASE_ACK_REQUIRED/,
  );
  assert.equal(portRequested, false, "No serial permission before every safety gate passes");
});

test("C6 Zigbee: detect/backup high-level helpers fail closed without Web Serial in Node", async () => {
  await assert.rejects(() => detectC6ZigbeeBenchTarget({}), /BENCH_WEBSERIAL_REQUIRED|BENCH_HTTPS_REQUIRED/);
  await assert.rejects(() => backupC6ZigbeeBenchFlash({}), /BENCH_WEBSERIAL_REQUIRED|BENCH_HTTPS_REQUIRED/);
});

test("C6 Zigbee: low-level flash is three exact offsets, correct silicon, full-erase opt-in", async () => {
  let flashParams;
  const segments = specs.map((s) => ({ role: s.role, address: s.address, data: new Uint8Array(256) }));
  const ctx = { chipName: "ESP32-C6", loader: { writeFlash: async (opts) => { flashParams = opts; } } };
  await writeC6MultiOffsetFirmware(ctx, segments);
  assert.deepEqual(flashParams.fileArray.map((v) => v.address), [0, 0x8000, 0x10000]);
  assert.equal(flashParams.eraseAll, true);
  assert.equal(flashParams.flashSize, "4MB");
  flashParams = undefined;
  await assert.rejects(() => writeC6MultiOffsetFirmware(ctx, segments.slice(1)), /NEED_THREE/);
  await assert.rejects(() => writeC6MultiOffsetFirmware(ctx, [
    segments[0], segments[1], { ...segments[2], address: 0x0 },
  ]), /LAB_MULTI_OFFSET_INVALID/);
  await assert.rejects(() => writeC6MultiOffsetFirmware({ ...ctx, chipName: "ESP32-S3" }, segments), /LAB_CHIP_NOT_C6/);
  assert.equal(flashParams, undefined, "No write was attempted on invalid packages");
});

test("C6 Zigbee: post-flash checks mark Zigbee pairing/dual ON/OFF as UNVERIFIED only", () => {
  const byId = Object.fromEntries(C6_ZIGBEE_BENCH_POST_FLASH_CHECKS.map((c) => [c.id, c]));
  assert.equal(byId["zigbee-pairing"].status, "UNVERIFIED");
  assert.equal(byId["zigbee-dual-onoff"].status, "UNVERIFIED");
  for (const id of ["micropython-repl", "uzigbee-import", "st7789", "gpio", "wifi", "ble"]) {
    assert.equal(byId[id].status, "OPERATOR_CHECK");
  }
  assert.match(byId.st7789.label, /172×320|172x320/);
  assert.doesNotMatch(modalSrc, /zigbee-pairing.*PASS|PASS.*zigbee-pairing/);
});
