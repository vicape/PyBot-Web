import { test } from "node:test";
import assert from "node:assert/strict";
import {
  C6_ZIGBEE_BENCH_PACKAGE,
  validateC6ZigbeeBenchFiles,
  assertC6ZigbeeBenchFlashConsent,
  flashC6ZigbeeBenchPackage,
} from "../src/esp32UniversalLab/runtime/c6ZigbeeBench.js";
import { writeC6MultiOffsetFirmware } from "../src/esp32UniversalLab/runtime/c6Flasher.js";

const specs = C6_ZIGBEE_BENCH_PACKAGE.components;
function file(spec, name = spec.name, size = spec.size) {
  const bytes = new Uint8Array(size);
  return { name, size, arrayBuffer: async () => bytes.buffer };
}
const mockDigest = async (bytes) => {
  const matching = specs.find((s) => s.size === bytes.byteLength);
  return matching?.sha256 ?? "0".repeat(64);
};

test("C6 Zigbee: only pinned 4 MB C6 private package, never production READY", () => {
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.publicReady, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.autoFlash, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.hardwareValidation, "UNVERIFIED");
  assert.deepEqual(specs.map((s) => s.address), [0, 0x8000, 0x10000]);
  assert.equal(specs[2].size, 3221280);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.board, "waveshare-esp32-c6-lcd-1.47");
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

test("C6 Zigbee: two consent gates, backup, correct board and disconnected session", async () => {
  const validated = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: mockDigest });
  const base = {
    validated,
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    connected: false,
    backupConfirmed: true,
    eraseAcknowledged: true,
    secondConfirmation: "ESP32-C6",
  };
  assert.equal(assertC6ZigbeeBenchFlashConsent(base).allowed, true);
  for (const override of [
    { validated: null },
    { profileId: "some-other-board" },
    { connected: true },
    { backupConfirmed: false },
    { eraseAcknowledged: false },
    { secondConfirmation: "" },
  ]) {
    assert.equal(assertC6ZigbeeBenchFlashConsent({ ...base, ...override }).allowed, false);
  }
  let portRequested = false;
  await assert.rejects(
    () => flashC6ZigbeeBenchPackage(validated, { ...base, eraseAcknowledged: false,
      requestPort: async () => { portRequested = true; return {}; } }),
    /BENCH_ERASE_ACK_REQUIRED/,
  );
  assert.equal(portRequested, false, "No serial permission before every safety gate passes");
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
