/**
 * Punto 11: writeFirmware debe pasar calculateMD5Hash a esptool-js writeFlash
 * (verificación File md5 vs Flash md5 nativa). No MD5 externo ingenuo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeFirmware } from "../src/esp32/esp32Flasher.js";
import { ESP32_GENERIC_FIRMWARE } from "../src/esp32/firmwareManifest.js";
import { PROVISION_ERROR } from "../src/esp32/provisioningPhases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const flasherSrc = readFileSync(join(__dirname, "../src/esp32/esp32Flasher.js"), "utf8");

function oracleMd5(bytes) {
  return createHash("md5").update(Buffer.from(bytes)).digest("hex");
}

function makeCtx(writeFlashImpl) {
  let flashMd5sumCalls = 0;
  return {
    flashMd5sumCalls: () => flashMd5sumCalls,
    ctx: {
      loader: {
        async writeFlash(options) {
          return writeFlashImpl(options);
        },
        async flashMd5sum() {
          flashMd5sumCalls += 1;
          return "00".repeat(16);
        },
      },
    },
  };
}

test("TEST1: MD5 empty vector via calculateMD5Hash", async () => {
  let hashFn;
  const { ctx } = makeCtx(async (opts) => {
    hashFn = opts.calculateMD5Hash;
  });
  await writeFirmware(ctx, new Uint8Array(0));
  assert.equal(typeof hashFn, "function");
  assert.equal(hashFn(new Uint8Array([])), "d41d8cd98f00b204e9800998ecf8427e");
});

test("TEST2: MD5 of ASCII 'abc'", async () => {
  let hashFn;
  const { ctx } = makeCtx(async (opts) => {
    hashFn = opts.calculateMD5Hash;
  });
  await writeFirmware(ctx, new Uint8Array([1]));
  assert.equal(hashFn(new Uint8Array([0x61, 0x62, 0x63])), "900150983cd24fb0d6963f7d28e17f72");
});

test("TEST3: binary bytes match node:crypto oracle", async () => {
  let hashFn;
  const { ctx } = makeCtx(async (opts) => {
    hashFn = opts.calculateMD5Hash;
  });
  await writeFirmware(ctx, new Uint8Array([1]));
  const bin = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0x7f, 0x2a, 0x55, 0xaa]);
  assert.equal(hashFn(bin), oracleMd5(bin));
});

test("TEST4: calculateMD5Hash delivered by default", async () => {
  let captured;
  const { ctx } = makeCtx(async (opts) => {
    captured = opts;
  });
  await writeFirmware(ctx, new Uint8Array([0xde, 0xad]));
  assert.equal(typeof captured.calculateMD5Hash, "function");
});

test("TEST5: verify:false does not activate MD5", async () => {
  let captured;
  const { ctx } = makeCtx(async (opts) => {
    captured = opts;
  });
  await writeFirmware(ctx, new Uint8Array([0xde, 0xad]), { verify: false });
  assert.equal(captured.calculateMD5Hash, undefined);
});

test("TEST6: no duplicate flashMd5sum after writeFlash", async () => {
  const { ctx, flashMd5sumCalls } = makeCtx(async () => {});
  await writeFirmware(ctx, new Uint8Array([9, 8, 7]));
  assert.equal(flashMd5sumCalls(), 0);
  assert.doesNotMatch(flasherSrc, /flashMd5sum\s*\(/);
});

test("TEST7: esptool MD5 mismatch → FLASH_VERIFY_FAIL", async () => {
  const { ctx } = makeCtx(async () => {
    throw new Error("MD5 of file does not match data in flash!");
  });
  await assert.rejects(
    () => writeFirmware(ctx, new Uint8Array([1, 2, 3])),
    (err) => {
      assert.equal(err.code, PROVISION_ERROR.FLASH_VERIFY_FAIL);
      assert.equal(err.message, PROVISION_ERROR.FLASH_VERIFY_FAIL);
      return true;
    },
  );
});

test("TEST8: normal write error → FLASH_FAIL (not VERIFY)", async () => {
  const { ctx } = makeCtx(async () => {
    throw new Error("serial write failed");
  });
  await assert.rejects(
    () => writeFirmware(ctx, new Uint8Array([1, 2, 3])),
    (err) => {
      assert.equal(err.code, PROVISION_ERROR.FLASH_FAIL);
      return true;
    },
  );
});

test("TEST9: reportProgress keeps bytesWritten/bytesTotal/pct", async () => {
  const progress = [];
  const { ctx } = makeCtx(async (opts) => {
    opts.reportProgress(0, 50, 200);
    opts.reportProgress(0, 200, 200);
  });
  await writeFirmware(ctx, new Uint8Array(200), {
    onProgress: (info) => progress.push(info),
  });
  assert.deepEqual(progress, [
    { bytesWritten: 50, bytesTotal: 200, pct: 25 },
    { bytesWritten: 200, bytesTotal: 200, pct: 100 },
  ]);
});

test("TEST10: flash options unchanged", async () => {
  let captured;
  const { ctx } = makeCtx(async (opts) => {
    captured = opts;
  });
  const bytes = new Uint8Array([0xaa, 0xbb]);
  await writeFirmware(ctx, bytes);
  assert.equal(captured.fileArray.length, 1);
  assert.equal(captured.fileArray[0].address, ESP32_GENERIC_FIRMWARE.flashOffset);
  assert.equal(captured.fileArray[0].data, bytes);
  assert.equal(captured.flashMode, ESP32_GENERIC_FIRMWARE.flashMode);
  assert.equal(captured.flashFreq, ESP32_GENERIC_FIRMWARE.flashFreq);
  assert.equal(captured.flashSize, ESP32_GENERIC_FIRMWARE.flashSize);
  assert.equal(captured.eraseAll, false);
  assert.equal(captured.compress, true);
});

test("TEST11: firmware stays binary Uint8Array (not string)", async () => {
  let captured;
  const { ctx } = makeCtx(async (opts) => {
    captured = opts;
  });
  const bytes = new Uint8Array([0x00, 0xff, 0x80]);
  await writeFirmware(ctx, bytes);
  assert.ok(captured.fileArray[0].data instanceof Uint8Array);
  assert.equal(typeof captured.fileArray[0].data, "object");
  assert.notEqual(typeof captured.fileArray[0].data, "string");
});

test("TEST12: MD5 deterministic for same bytes", async () => {
  let hashFn;
  const { ctx } = makeCtx(async (opts) => {
    hashFn = opts.calculateMD5Hash;
  });
  await writeFirmware(ctx, new Uint8Array([1]));
  const sample = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0xff]);
  assert.equal(hashFn(sample), hashFn(new Uint8Array(sample)));
  assert.equal(hashFn(sample), oracleMd5(sample));
});

test("guardrail: PyBot relies on writeFlash calculateMD5Hash, not external compare", () => {
  assert.match(flasherSrc, /calculateMD5Hash:\s*verify\s*\?/);
  assert.doesNotMatch(flasherSrc, /flashMd5sum\s*\(/);
  // No comparación ingenua post-writeFlash sobre el input original
  assert.doesNotMatch(
    flasherSrc,
    /await\s+ctx\.loader\.flashMd5sum|md5HexBytes\(\s*image\s*\)/,
  );
});
