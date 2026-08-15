import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  ESP32_GENERIC_FIRMWARE,
  MICROPYTHON_ESP32_FLASH_OFFSET,
  isClassicEsp32Chip,
  UNSUPPORTED_ESP_FAMILIES,
} from "../src/esp32/firmwareManifest.js";
import { loadOfficialFirmware, assertFirmwareHash } from "../src/esp32/firmwareLoader.js";
import { sha256Hex } from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const binPath = join(root, "public/firmware/micropython", ESP32_GENERIC_FIRMWARE.filename);
const jsonPath = join(root, "public/firmware/micropython/manifest.json");

test("official firmware file exists with documented size", () => {
  const st = statSync(binPath);
  assert.equal(st.size, ESP32_GENERIC_FIRMWARE.size);
});

test("SHA-256 of vendored firmware matches the centralized manifest", () => {
  const bytes = new Uint8Array(readFileSync(binPath));
  const nodeHash = createHash("sha256").update(bytes).digest("hex");
  const jsHash = sha256Hex(bytes);
  assert.equal(nodeHash, ESP32_GENERIC_FIRMWARE.sha256);
  assert.equal(jsHash, ESP32_GENERIC_FIRMWARE.sha256);
});

test("public manifest.json matches firmwareManifest.js", () => {
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.version, ESP32_GENERIC_FIRMWARE.version);
  assert.equal(json.sha256, ESP32_GENERIC_FIRMWARE.sha256);
  assert.equal(json.size, ESP32_GENERIC_FIRMWARE.size);
  assert.equal(json.flashOffset, MICROPYTHON_ESP32_FLASH_OFFSET);
  assert.equal(json.license, "MIT");
  assert.match(json.origin, /micropython\.org/);
});

test("classic ESP32 is supported; other families are not", () => {
  assert.equal(isClassicEsp32Chip("ESP32"), true);
  assert.equal(isClassicEsp32Chip("ESP32 (revision v3.0)"), true);
  for (const fam of UNSUPPORTED_ESP_FAMILIES) {
    assert.equal(isClassicEsp32Chip(fam), false, fam);
  }
  assert.equal(isClassicEsp32Chip("ESP32-S3"), false);
  assert.equal(isClassicEsp32Chip(""), false);
});

test("loadOfficialFirmware verifies hash before returning bytes", async () => {
  const raw = readFileSync(binPath);
  const bytes = Uint8Array.from(raw);
  const { sha256, manifest } = await loadOfficialFirmware({
    fetchImpl: async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    }),
  });
  assert.equal(sha256, ESP32_GENERIC_FIRMWARE.sha256);
  assert.equal(manifest.flashOffset, 0x1000);
});

test("loadOfficialFirmware rejects a tampered image (no flash)", async () => {
  const bad = new Uint8Array(ESP32_GENERIC_FIRMWARE.size);
  bad.fill(1);
  await assert.rejects(
    () =>
      loadOfficialFirmware({
        fetchImpl: async () => ({
          ok: true,
          arrayBuffer: async () => bad.buffer,
        }),
      }),
    /FIRMWARE_HASH_MISMATCH/,
  );
});

test("assertFirmwareHash rejects mismatches", () => {
  assert.throws(() => assertFirmwareHash(new Uint8Array([1, 2, 3]), ESP32_GENERIC_FIRMWARE.sha256));
});
