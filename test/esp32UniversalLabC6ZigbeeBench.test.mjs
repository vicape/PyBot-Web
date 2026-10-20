import { test } from "node:test";
import assert from "node:assert/strict";
import {
  C6_ZIGBEE_BENCH_PACKAGE,
  C6_ZIGBEE_BENCH_UI_LABEL,
  C6_ZIGBEE_BENCH_FETCH_ACTION,
  C6_ZIGBEE_BENCH_CONTINUE_LABEL,
  C6_ZIGBEE_BENCH_DISTRIBUTION,
  C6_ZIGBEE_BENCH_POST_FLASH_CHECKS,
  C6_ZIGBEE_BENCH_PRESERVED_VFS_PATHS,
  C6_ZIGBEE_BENCH_OPERATOR_SETUP,
  C6_ZIGBEE_BENCH_NOTICES,
  C6_ZIGBEE_BENCH_PROGRESS_STAGES,
  C6_FULL_FLASH_BYTES,
  validateC6ZigbeeBenchFiles,
  assertC6ZigbeeBenchFlashConsent,
  flashC6ZigbeeBenchPackage,
  resolveC6ZigbeeBenchPackageFetch,
  fetchAndValidateC6ZigbeeBenchPackage,
  detectC6ZigbeeBenchTarget,
  backupC6ZigbeeBenchFlash,
  describeC6ZigbeeBenchGateReason,
  orchestrateC6ZigbeeBenchOneClick,
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
const durableManifest = JSON.parse(
  readFileSync(join(here, "../firmware/pybot-c6-micropython-zigbee/private-bench-manifest.json"), "utf8"),
);
const apiPackage = JSON.parse(
  readFileSync(join(here, "../api/c6ZigbeeBenchPackage.json"), "utf8"),
);

test("C6 Zigbee: only pinned 4 MB C6 private package, never production READY", () => {
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.publicReady, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.autoFlash, false);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.hardwareValidation, "UNVERIFIED");
  assert.deepEqual(specs.map((s) => s.address), [0, 0x8000, 0x10000]);
  assert.equal(specs[2].size, 3236944);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.version, "0.1.2-sc10-aps");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.buildMarker, "SC10-APS-CAPTURE");
  assert.match(C6_ZIGBEE_BENCH_PACKAGE.featureLabel, /on_aps/);
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.board, "waveshare-esp32-c6-lcd-1.47");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId, "sc10-aps-rebuild-20261020");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId, "build-artifact-0.1.2-sc10-aps");
  assert.equal(C6_ZIGBEE_BENCH_PACKAGE.chip, "ESP32-C6");
  assert.equal(
    specs[0].sha256,
    "ea5213729ebcb21541ec34aef195961ecd049f85183390b406d3cb42a4d5a837",
  );
  assert.equal(
    specs[2].sha256,
    "f18811848746fcd5ec3c4c44c714033f6dd1ae67cd5c3951376d27571f073ee2",
  );
});

test("C6 Zigbee: durable manifest anchors versions/chip/offsets/sizes/SHA", () => {
  assert.equal(durableManifest.chip, "ESP32-C6");
  assert.deepEqual(durableManifest.offsets, ["0x0", "0x8000", "0x10000"]);
  assert.equal(durableManifest.components.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(durableManifest.components[i].sha256, specs[i].sha256);
    assert.equal(durableManifest.components[i].size, specs[i].size);
    assert.equal(apiPackage.components[i].sha256, specs[i].sha256);
  }
  assert.equal(existsSync(join(here, "../firmware/pybot-c6-micropython-zigbee/THIRD_PARTY_NOTICES.md")), true);
  assert.equal(
    existsSync(join(here, "../firmware/pybot-c6-micropython-zigbee/licenses/espressif__esp-zboss-lib.LICENSE.txt")),
    true,
  );
  assert.equal(existsSync(join(here, "../api/c6-zigbee-bench-firmware.js")), true);
});

test("C6 Zigbee: one-click UI — single Instalar firmware CTA, same simplicity as stock C6", () => {
  assert.equal(C6_ZIGBEE_BENCH_UI_LABEL, "Instalar firmware");
  assert.equal(C6_ZIGBEE_BENCH_FETCH_ACTION, "Obtener firmware y verificar");
  assert.equal(C6_ZIGBEE_BENCH_CONTINUE_LABEL, "Continuar");
  assert.match(modalSrc, /Instalar firmware/);
  assert.match(ideSrc, /Instalar firmware/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-start/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-progress/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-progress-stages/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-erase-notice/);
  assert.match(modalSrc, /orchestrateC6ZigbeeBenchOneClick/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-continue/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-flash-consent/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-detect/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-obtain/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-backup"/);
  assert.doesNotMatch(modalSrc, /Detectar placa/);
  assert.doesNotMatch(modalSrc, /Obtener firmware y verificar/);
  assert.doesNotMatch(modalSrc, /Respaldar flash 4 MB/);
  assert.doesNotMatch(modalSrc, /Preparar e instalar/);
  assert.doesNotMatch(modalSrc, /Escribí ESP32-C6|Type ESP32-C6/);
  assert.doesNotMatch(modalSrc, /type="file"/);
  assert.doesNotMatch(modalSrc, /showSaveFilePicker|backup_wait|needsContinue|needsFlashConsent/);
  assert.doesNotMatch(modalSrc, /DECISION REQUIRED/);
  assert.doesNotMatch(benchSrc, /status:\s*"DECISION REQUIRED"/);
  assert.notEqual(C6_ZIGBEE_BENCH_DISTRIBUTION.status, "DECISION REQUIRED");
  assert.equal(C6_ZIGBEE_BENCH_PROGRESS_STAGES.map((s) => s.id).join(","), "fetch,flash");
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
  const mpyIdx = ideSrc.indexOf('data-testid="lab-c6-zigbee-bench-entry"');
  const coordIdx = ideSrc.indexOf('data-testid="lab-zigbee-status"');
  assert.ok(mpyIdx > 0 && coordIdx > mpyIdx);
});

test("C6 Zigbee: progress stages + path label; no backup/consent wizard UI", () => {
  assert.match(modalSrc, /lab-c6-zigbee-bench-stage-\$\{item\.id\}/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-progress-stages/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-path-label/);
  assert.match(modalSrc, /lab-c6-zigbee-bench-erase-notice/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-continue/);
  assert.doesNotMatch(modalSrc, /lab-c6-zigbee-bench-flash-consent/);
  assert.match(modalSrc, /MicroPython \+ native Zigbee|Zigbee nativo/);
  assert.match(modalSrc, /not the ESP-IDF coordinator|no es el coordinador ESP-IDF/);
  assert.match(describeC6ZigbeeBenchGateReason("BENCH_FLASH_CONSENT_REQUIRED", "es"), /Instalar firmware/);
  assert.match(describeC6ZigbeeBenchGateReason("BENCH_DISCONNECT_FIRST", "en"), /Disconnect/);
  assert.deepEqual(C6_ZIGBEE_BENCH_PROGRESS_STAGES.map((s) => s.id), ["fetch", "flash"]);
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
  assert.equal(existsSync(join(root, "vicape/PyBot-Web")), true);
  assert.match(readFileSync(join(root, "main.py"), "utf8"), /vicape\/PyBot-Web/);
  assert.match(readFileSync(join(root, "vicape/PyBot-Web"), "utf8"), /vicape\/PyBot-Web/);
});

test("C6 Zigbee: static guest distributor is wired; no secrets in client", () => {
  const resolved = resolveC6ZigbeeBenchPackageFetch();
  assert.equal(resolved.status, "STATIC_PUBLIC");
  assert.equal(C6_ZIGBEE_BENCH_DISTRIBUTION.status, "STATIC_PUBLIC");
  assert.equal(resolved.automaticFetchSupported, true);
  assert.equal(resolved.authorizedEndpointSupported, false);
  assert.equal(resolved.guestAnonymousSupported, true);
  assert.equal(resolved.endpointPath, "/firmware/c6-zigbee");
  assert.equal(resolved.fetchActionLabel, "Obtener firmware y verificar");
  assert.match(C6_ZIGBEE_BENCH_OPERATOR_SETUP, /obsolete|static \/firmware\/c6-zigbee/i);
  assert.doesNotMatch(C6_ZIGBEE_BENCH_OPERATOR_SETUP, /SUPABASE_SERVICE_KEY|OPERATOR_EMAILS/);
  assert.match(C6_ZIGBEE_BENCH_DISTRIBUTION.licensePolicy, /Guest anonymous/i);
  assert.equal(C6_ZIGBEE_BENCH_NOTICES.apiPath, "/firmware/c6-zigbee/THIRD_PARTY_NOTICES.md");
  for (const spec of specs) {
    assert.match(spec.url, /^\/firmware\/c6-zigbee\//);
    assert.equal(spec.url, `/firmware/c6-zigbee/${spec.name}`);
  }
  // Env *names* may mention GITHUB_TOKEN; never embed live credential material.
  assert.doesNotMatch(benchSrc, /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,}|ACTIONS_RUNTIME_TOKEN\s*[:=]|service_role\s*[:=]/i);
  assert.doesNotMatch(modalSrc, /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,}|ACTIONS_RUNTIME_TOKEN\s*[:=]|service_role\s*[:=]/i);
  assert.doesNotMatch(benchSrc, /fetch\(\s*C6_ZIGBEE_BENCH_PACKAGE\.sourceArtifact/);
  assert.doesNotMatch(modalSrc, /fetch\(\s*C6_ZIGBEE_BENCH_PACKAGE\.sourceArtifact/);
  assert.doesNotMatch(benchSrc, /method:\s*"POST"/);
});

function staticFetchImpl(url, init = {}) {
  assert.notEqual(init.method, "POST");
  const role = String(url).includes("bootloader")
    ? "bootloader"
    : String(url).includes("partition")
      ? "partition-table"
      : "app";
  const spec = specs.find((s) => s.role === role);
  assert.ok(spec, "unknown static url " + url);
  assert.equal(url, spec.url);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(spec.size).buffer,
  };
}

test("C6 Zigbee: guest/no session fetches static bins anonymously (no login / no guest policy blocker)", async () => {
  let getCount = 0;
  const ok = await fetchAndValidateC6ZigbeeBenchPackage({
    getAccessToken: async () => null,
    fetchImpl: async (url, init = {}) => {
      getCount += 1;
      return staticFetchImpl(url, init);
    },
    digest: mockDigest,
  });
  assert.equal(getCount, 3);
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.source, "static-public");
  assert.ok(ok.notices);
  assert.doesNotMatch(benchSrc, /sb\.auth\.getSession/);
  assert.doesNotMatch(benchSrc, /BENCH_GUEST_APPROVAL_REQUIRED/);
  assert.doesNotMatch(modalSrc, /DECISION REQUIRED/);
  assert.ok(C6_ZIGBEE_BENCH_NOTICES.restrictions.length >= 3);
  assert.match(modalSrc, /lab-c6-zigbee-bench-notices/);
});

test("C6 Zigbee: one-click guest path fetches static without auth denial", async () => {
  let flashed = false;
  const result = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    getAccessToken: async () => null,
    fetchImpl: staticFetchImpl,
    digest: mockDigest,
    flash: async () => {
      flashed = true;
      return { written: true, postFlashChecks: C6_ZIGBEE_BENCH_POST_FLASH_CHECKS };
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.flashed, true);
  assert.equal(flashed, true);
  assert.notEqual(result.reason, "BENCH_AUTH_DENIED");
  assert.notEqual(result.reason, "BENCH_GUEST_APPROVAL_REQUIRED");
  assert.notEqual(result.reason, "BENCH_OPERATOR_SETUP_REQUIRED");
});

test("C6 Zigbee: client fetch anonymous static path + SHA verify", async () => {
  const ok = await fetchAndValidateC6ZigbeeBenchPackage({
    fetchImpl: staticFetchImpl,
    digest: mockDigest,
  });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.source, "static-public");
  assert.deepEqual(ok.segments.map((s) => s.address), [0, 0x8000, 0x10000]);
});

test("C6 Zigbee: client fetch hash mismatch and interruption", async () => {
  const mismatch = await fetchAndValidateC6ZigbeeBenchPackage({
    fetchImpl: async (url) => {
      const spec = specs.find((s) => s.url === url) || specs[0];
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array(spec.size).buffer,
      };
    },
    digest: async () => "0".repeat(64),
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /SHA256_MISMATCH/);

  const interrupted = await fetchAndValidateC6ZigbeeBenchPackage({
    fetchImpl: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.reason, "BENCH_FETCH_INTERRUPTED");

  const missingSeg = await fetchAndValidateC6ZigbeeBenchPackage({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(missingSeg.ok, false);
  assert.equal(missingSeg.reason, "BENCH_SEGMENT_FETCH_FAILED");
});

test("C6 Zigbee: public static bins exist with pinned size+SHA256", async () => {
  const { createHash } = await import("node:crypto");
  const root = join(here, "..");
  for (const spec of specs) {
    // url is /firmware/c6-zigbee/... → public/firmware/c6-zigbee/...
    const filePath = join(root, "public", ...spec.url.split("/").filter(Boolean));
    assert.equal(existsSync(filePath), true, "missing " + filePath);
    const bytes = readFileSync(filePath);
    assert.equal(bytes.byteLength, spec.size, spec.role + " size");
    const sha = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha, spec.sha256, spec.role + " sha256");
  }
  assert.equal(
    existsSync(join(root, "public/firmware/c6-zigbee/THIRD_PARTY_NOTICES.md")),
    true,
  );
  assert.equal(
    existsSync(join(root, "public/firmware/c6-zigbee/licenses/espressif__esp-zboss-lib.LICENSE.txt")),
    true,
  );
});

test("C6 Zigbee: exact three binary names, SHA and bytes validated before WebSerial", async () => {
  const valid = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: mockDigest });
  assert.equal(valid.ok, true, valid.reason || "validation failed");
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

test("C6 Zigbee: consent is CTA + package/board gates; backup not required; no port before gates", async () => {
  const validated = await validateC6ZigbeeBenchFiles(specs.map((s) => file(s)), { digest: mockDigest });
  const base = {
    validated,
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    connected: false,
    destructiveFlashConsent: true,
  };
  assert.equal(assertC6ZigbeeBenchFlashConsent(base).allowed, true);
  assert.equal(assertC6ZigbeeBenchFlashConsent({
    ...base,
    destructiveFlashConsent: false,
    eraseAcknowledged: true,
  }).allowed, true);
  // Optional pre-detection still fail-closed when provided and wrong.
  assert.equal(assertC6ZigbeeBenchFlashConsent({
    ...base,
    detection: { ok: true, chipName: "ESP32-C6", flashSize: "8MB" },
  }).allowed, false);
  assert.equal(assertC6ZigbeeBenchFlashConsent({
    ...base,
    detection: { ok: true, chipName: "ESP32-S3", flashSize: "4MB" },
  }).allowed, false);

  for (const override of [
    { validated: null },
    { profileId: "some-other-board" },
    { connected: true },
    { destructiveFlashConsent: false, eraseAcknowledged: false },
  ]) {
    assert.equal(assertC6ZigbeeBenchFlashConsent({ ...base, ...override }).allowed, false);
  }
  let portRequested = false;
  await assert.rejects(
    () => flashC6ZigbeeBenchPackage(validated, {
      ...base,
      destructiveFlashConsent: false,
      eraseAcknowledged: false,
      requestPort: async () => { portRequested = true; return {}; },
    }),
    /BENCH_FLASH_CONSENT_REQUIRED/,
  );
  assert.equal(portRequested, false, "No serial permission before every safety gate passes");
});

test("C6 Zigbee: one-click orchestration is fetch→flash; CTA consent; no backup wizard", async () => {
  const stages = [];
  const validatedOk = {
    ok: true,
    segments: specs.map((s) => ({ role: s.role, address: s.address, data: new Uint8Array(8) })),
    autoFlash: false,
  };
  let flashCalls = 0;

  const wrongBoard = await orchestrateC6ZigbeeBenchOneClick({
    profileId: "other-board",
    connected: false,
    fetchPackage: async () => validatedOk,
    flash: async () => { flashCalls += 1; return { written: true }; },
  });
  assert.equal(wrongBoard.ok, false);
  assert.equal(wrongBoard.reason, "BENCH_WRONG_BOARD_PROFILE");
  assert.equal(flashCalls, 0);

  const stillConnected = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    connected: true,
    fetchPackage: async () => validatedOk,
    flash: async () => { flashCalls += 1; return { written: true }; },
  });
  assert.equal(stillConnected.reason, "BENCH_DISCONNECT_FIRST");
  assert.equal(flashCalls, 0);

  const ok = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    connected: false,
    fetchPackage: async () => validatedOk,
    flash: async (_v, opts) => {
      flashCalls += 1;
      assert.equal(opts.destructiveFlashConsent, true);
      return { written: true, postFlashChecks: C6_ZIGBEE_BENCH_POST_FLASH_CHECKS };
    },
    onProgress: (p) => stages.push(p.stage),
  });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.flashed, true);
  assert.equal(flashCalls, 1);
  assert.deepEqual(
    stages.filter((s, i) => stages.indexOf(s) === i),
    ["fetch", "flash"],
  );
  assert.doesNotMatch(benchSrc, /waitForContinue/);
  assert.doesNotMatch(benchSrc, /requestFlashConsent/);
  assert.doesNotMatch(modalSrc, /backup_wait|showSaveFilePicker|needsContinue|needsFlashConsent/);
});

test("C6 Zigbee: one-click fail-closed on auth, setup, SHA, and flash errors", async () => {
  const validatedOk = { ok: true, segments: [], autoFlash: false };

  const auth = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    fetchPackage: async () => ({ ok: false, reason: "BENCH_AUTH_DENIED" }),
    flash: async () => { assert.fail("flash"); },
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.reason, "BENCH_AUTH_DENIED");
  assert.equal(auth.flashed, false);

  const setup = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    fetchPackage: async () => ({ ok: false, reason: "BENCH_OPERATOR_SETUP_REQUIRED", detail: "missing storage" }),
    flash: async () => { assert.fail("flash"); },
  });
  assert.equal(setup.reason, "BENCH_OPERATOR_SETUP_REQUIRED");
  assert.equal(setup.flashed, false);

  const sha = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    fetchPackage: async () => ({ ok: false, reason: "BENCH_SHA256_MISMATCH:app" }),
    flash: async () => { assert.fail("flash"); },
  });
  assert.match(sha.reason, /SHA256_MISMATCH/);
  assert.equal(sha.flashed, false);

  const flashFail = await orchestrateC6ZigbeeBenchOneClick({
    profileId: C6_ZIGBEE_BENCH_PACKAGE.board,
    fetchPackage: async () => validatedOk,
    flash: async () => { throw new Error("BENCH_WEBSERIAL_REQUIRED"); },
  });
  assert.equal(flashFail.ok, false);
  assert.equal(flashFail.reason, "BENCH_WEBSERIAL_REQUIRED");
  assert.equal(flashFail.flashed, false);
  assert.equal(flashFail.stage, "flash");
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
