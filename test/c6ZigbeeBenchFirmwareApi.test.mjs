import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import handler, { clearFirmwareSegmentCache } from "../api/c6-zigbee-bench-firmware.js";
import {
  C6_FIRMWARE_OPERATOR_SETUP,
  mintSegmentTicket,
  sha256HexBuffer,
  storageConfigFromEnv,
  verifySegmentTicket,
  getBundledFirmwareNotices,
} from "../api/_c6ZigbeeBenchFirmware.js";
import { C6_ZIGBEE_BENCH_PACKAGE } from "../src/esp32UniversalLab/runtime/c6ZigbeeBench.js";

const LOCAL_DIR =
  process.env.PYBOT_C6_TEST_FIRMWARE_DIR ||
  "/tmp/c6-fw-pkg/extracted/maxwell-555/zigbee-firmware-private-bench";
const hasRealBins = existsSync(
  `${LOCAL_DIR}/pybot-c6-micropython-zigbee-0.1.0-bootloader.bin`,
);

const savedEnv = { ...process.env };

function setOperatorEnv(overrides = {}) {
  process.env.PYBOT_C6_FIRMWARE_SIGNING_SECRET = "unit-test-signing-secret";
  process.env.PYBOT_C6_FIRMWARE_LOCAL_DIR = LOCAL_DIR;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_BASE_URL;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER;
  delete process.env.PYBOT_C6_FIRMWARE_GITHUB_TOKEN;
  // Auth envs no longer required for guest mint; leave unset by default.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.PYBOT_C6_FIRMWARE_OPERATOR_EMAILS;
  Object.assign(process.env, overrides);
}

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
}

function mockRes() {
  const state = { statusCode: 200, headers: {}, body: null, chunks: [] };
  return {
    state,
    statusCode: 200,
    setHeader(k, v) {
      state.headers[k.toLowerCase()] = v;
    },
    end(buf) {
      state.statusCode = this.statusCode;
      state.body = buf;
      if (buf) state.chunks.push(buf);
    },
  };
}

before(() => {
  clearFirmwareSegmentCache();
});

after(() => {
  clearFirmwareSegmentCache();
  restoreEnv();
});

test("API helper: tickets mint/verify and expire", () => {
  const secret = "abc";
  const { ticket, expiresAt } = mintSegmentTicket("bootloader", secret, 1_000_000);
  assert.equal(verifySegmentTicket(ticket, secret, 1_000_100).ok, true);
  assert.equal(verifySegmentTicket(ticket, secret, expiresAt + 1).ok, false);
  assert.equal(verifySegmentTicket(ticket + "x", secret, 1_000_100).ok, false);
});

test("API: bundled notices include zboss / zigbee / uzigbee texts", () => {
  const notices = getBundledFirmwareNotices();
  assert.ok(notices.documents["espressif__esp-zboss-lib.LICENSE.txt"].includes("DSR Corporation"));
  assert.ok(notices.documents["espressif__esp-zigbee-lib.LICENSE.txt"].includes("Apache License"));
  assert.ok(notices.documents["uZigbee.MIT.txt"].includes("MIT License"));
  assert.ok(notices.restrictions.some((r) => /reverse.?engineered/i.test(r)));
});

test("API: anonymous notices GET without login", async () => {
  const res = mockRes();
  await handler(
    { method: "GET", headers: {}, url: "/api/c6-zigbee-bench-firmware?notices=1" },
    res,
  );
  assert.equal(res.state.statusCode, 200);
  const body = JSON.parse(res.state.body);
  assert.equal(body.ok, true);
  assert.ok(body.notices.documents["THIRD_PARTY_NOTICES.md"]);
});

test("API: operator_setup_required when storage secrets missing (no login demand)", async () => {
  restoreEnv();
  delete process.env.PYBOT_C6_FIRMWARE_LOCAL_DIR;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_BASE_URL;
  delete process.env.PYBOT_C6_FIRMWARE_GITHUB_TOKEN;
  process.env.PYBOT_C6_FIRMWARE_SIGNING_SECRET = "s";
  const cfg = storageConfigFromEnv(process.env);
  assert.equal(cfg.mode, null);
  const res = mockRes();
  await handler(
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { chip: "ESP32-C6" },
      url: "/api/c6-zigbee-bench-firmware",
    },
    res,
  );
  assert.equal(res.state.statusCode, 503);
  const body = JSON.parse(res.state.body);
  assert.equal(body.error, "operator_setup_required");
  assert.match(body.reason, /PYBOT_C6_FIRMWARE_STORAGE_BASE_URL/);
  assert.equal(body.reason, C6_FIRMWARE_OPERATOR_SETUP);
  assert.match(body.reason, /does not require user login/i);
  assert.doesNotMatch(body.error, /auth_denied/);
});

test("API: chip denied for non-ESP32-C6", async () => {
  setOperatorEnv();
  const res = mockRes();
  await handler(
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { chip: "ESP32-S3" },
      url: "/api/c6-zigbee-bench-firmware",
    },
    res,
  );
  assert.equal(res.state.statusCode, 403);
  const body = JSON.parse(res.state.body);
  assert.equal(body.error, "chip_denied");
});

test("API: storage unavailable returns operator_setup / mint failure (not auth)", async () => {
  setOperatorEnv({
    PYBOT_C6_FIRMWARE_LOCAL_DIR: "/tmp/c6-fw-pkg-missing-dir-should-fail",
  });
  clearFirmwareSegmentCache();
  const res = mockRes();
  await handler(
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { chip: "ESP32-C6" },
      url: "/api/c6-zigbee-bench-firmware",
    },
    res,
  );
  assert.notEqual(res.state.statusCode, 200);
  const body = JSON.parse(res.state.body);
  assert.notEqual(body.error, "auth_denied");
  assert.ok(
    ["mint_failed", "segment_load_failed", "hash_mismatch", "operator_setup_required"].includes(
      body.error,
    ) || res.state.statusCode >= 400,
  );
});

test(
  "API: anonymous guest mint + segment GET with real Maxwell bins + SHA",
  { skip: !hasRealBins },
  async () => {
    setOperatorEnv();
    clearFirmwareSegmentCache();
    const mintRes = mockRes();
    await handler(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { chip: "ESP32-C6" },
        url: "/api/c6-zigbee-bench-firmware",
      },
      mintRes,
    );
    assert.equal(mintRes.state.statusCode, 200, String(mintRes.state.body));
    const minted = JSON.parse(mintRes.state.body);
    assert.equal(minted.ok, true);
    assert.equal(minted.guest, true);
    assert.equal(minted.chip, "ESP32-C6");
    assert.equal(minted.tickets.length, 3);
    assert.ok(minted.notices?.documents?.["espressif__esp-zboss-lib.LICENSE.txt"]);

    for (const t of minted.tickets) {
      const segRes = mockRes();
      await handler(
        {
          method: "GET",
          headers: {},
          url: `/api/c6-zigbee-bench-firmware?ticket=${encodeURIComponent(t.ticket)}`,
        },
        segRes,
      );
      assert.equal(segRes.state.statusCode, 200, String(segRes.state.body));
      const bytes = Buffer.from(segRes.state.body);
      const expected = C6_ZIGBEE_BENCH_PACKAGE.components.find((c) => c.role === t.role);
      assert.equal(bytes.byteLength, expected.size);
      assert.equal(sha256HexBuffer(bytes), expected.sha256);
    }
  },
);

test("API: altered hash fails closed (negative)", async () => {
  const dir = join(tmpdir(), `c6-fw-altered-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    for (const c of C6_ZIGBEE_BENCH_PACKAGE.components) {
      // Wrong bytes / size → sha or size mismatch
      writeFileSync(join(dir, c.name), Buffer.alloc(Math.max(8, c.size - 1), 0x5a));
    }
    setOperatorEnv({ PYBOT_C6_FIRMWARE_LOCAL_DIR: dir });
    clearFirmwareSegmentCache();
    const mintRes = mockRes();
    await handler(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { chip: "ESP32-C6" },
        url: "/api/c6-zigbee-bench-firmware",
      },
      mintRes,
    );
    assert.notEqual(mintRes.state.statusCode, 200);
    const body = JSON.parse(mintRes.state.body);
    assert.ok(
      ["hash_mismatch", "mint_failed", "segment_load_failed"].includes(body.error),
      body.error,
    );
    assert.notEqual(body.error, "auth_denied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("API: unauthenticated open redistribution blocked (GET without ticket)", async () => {
  setOperatorEnv();
  const res = mockRes();
  await handler({ method: "GET", headers: {}, url: "/api/c6-zigbee-bench-firmware" }, res);
  assert.equal(res.state.statusCode, 400);
});

test("API: http server smoke — anonymous POST reaches setup or mint (not auth_denied)", async () => {
  setOperatorEnv({
    PYBOT_C6_FIRMWARE_LOCAL_DIR: "/tmp/c6-fw-pkg-missing-dir-should-fail",
  });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      handler(req, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/c6-zigbee-bench-firmware`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chip: "ESP32-C6" }),
    });
    assert.notEqual(r.status, 401);
    const body = await r.json();
    assert.notEqual(body.error, "auth_denied");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
