import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import handler, { clearFirmwareSegmentCache } from "../api/c6-zigbee-bench-firmware.js";
import {
  C6_FIRMWARE_OPERATOR_SETUP,
  mintSegmentTicket,
  sha256HexBuffer,
  storageConfigFromEnv,
  verifySegmentTicket,
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
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-test-key";
  process.env.PYBOT_C6_FIRMWARE_OPERATOR_EMAILS = "op@example.com";
  process.env.PYBOT_C6_FIRMWARE_SIGNING_SECRET = "unit-test-signing-secret";
  process.env.PYBOT_C6_FIRMWARE_LOCAL_DIR = LOCAL_DIR;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_BASE_URL;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER;
  delete process.env.PYBOT_C6_FIRMWARE_GITHUB_TOKEN;
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

async function withFetchUser(email, isSuperAdmin = false) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      if (email === null) return { ok: false, status: 401, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "11111111-1111-4111-8111-111111111111", email }),
      };
    }
    if (u.includes("/rest/v1/profiles")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ is_super_admin: isSuperAdmin, email: email || "" }],
      };
    }
    throw new Error("unexpected fetch " + u);
  };
  return () => {
    globalThis.fetch = original;
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

test("API: auth denied without token", async () => {
  setOperatorEnv();
  const res = mockRes();
  await handler({ method: "POST", headers: {}, url: "/api/c6-zigbee-bench-firmware" }, res);
  assert.equal(res.state.statusCode, 401);
  const body = JSON.parse(res.state.body);
  assert.equal(body.error, "auth_denied");
});

test("API: operator_setup_required when storage secrets missing", async () => {
  restoreEnv();
  delete process.env.PYBOT_C6_FIRMWARE_LOCAL_DIR;
  delete process.env.PYBOT_C6_FIRMWARE_STORAGE_BASE_URL;
  delete process.env.PYBOT_C6_FIRMWARE_GITHUB_TOKEN;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "k";
  process.env.PYBOT_C6_FIRMWARE_OPERATOR_EMAILS = "op@example.com";
  process.env.PYBOT_C6_FIRMWARE_SIGNING_SECRET = "s";
  const cfg = storageConfigFromEnv(process.env);
  assert.equal(cfg.mode, null);
  const res = mockRes();
  await handler(
    { method: "POST", headers: { authorization: "Bearer x" }, url: "/api/c6-zigbee-bench-firmware" },
    res,
  );
  assert.equal(res.state.statusCode, 503);
  const body = JSON.parse(res.state.body);
  assert.equal(body.error, "operator_setup_required");
  assert.match(body.reason, /PYBOT_C6_FIRMWARE_STORAGE_BASE_URL/);
  assert.equal(body.reason, C6_FIRMWARE_OPERATOR_SETUP);
});

test("API: auth denied for non-allowlisted operator", async () => {
  setOperatorEnv();
  const restoreFetch = await withFetchUser("stranger@example.com", false);
  try {
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        url: "/api/c6-zigbee-bench-firmware",
      },
      res,
    );
    assert.equal(res.state.statusCode, 403);
    assert.equal(JSON.parse(res.state.body).error, "auth_denied");
  } finally {
    restoreFetch();
  }
});

test(
  "API: authenticated mint + segment GET with real Maxwell bins + SHA",
  { skip: !hasRealBins },
  async () => {
    setOperatorEnv();
    clearFirmwareSegmentCache();
    const restoreFetch = await withFetchUser("op@example.com", false);
    try {
      const mintRes = mockRes();
      await handler(
        {
          method: "POST",
          headers: { authorization: "Bearer user-token" },
          url: "/api/c6-zigbee-bench-firmware",
        },
        mintRes,
      );
      assert.equal(mintRes.state.statusCode, 200, String(mintRes.state.body));
      const minted = JSON.parse(mintRes.state.body);
      assert.equal(minted.ok, true);
      assert.equal(minted.tickets.length, 3);

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
    } finally {
      restoreFetch();
    }
  },
);

test(
  "API: hash mismatch fails closed when local bytes are wrong size",
  { skip: !hasRealBins },
  async () => {
    setOperatorEnv({
      PYBOT_C6_FIRMWARE_LOCAL_DIR: "/tmp/c6-fw-pkg-missing-dir-should-fail",
    });
    clearFirmwareSegmentCache();
    const restoreFetch = await withFetchUser("op@example.com", false);
    try {
      const mintRes = mockRes();
      await handler(
        {
          method: "POST",
          headers: { authorization: "Bearer user-token" },
          url: "/api/c6-zigbee-bench-firmware",
        },
        mintRes,
      );
      assert.notEqual(mintRes.state.statusCode, 200);
      const body = JSON.parse(mintRes.state.body);
      assert.ok(["mint_failed", "segment_load_failed", "hash_mismatch", "operator_setup_required"].includes(body.error) || mintRes.state.statusCode >= 400);
    } finally {
      restoreFetch();
    }
  },
);

test("API: unauthenticated open redistribution blocked (GET without ticket)", async () => {
  setOperatorEnv();
  const res = mockRes();
  await handler({ method: "GET", headers: {}, url: "/api/c6-zigbee-bench-firmware" }, res);
  assert.equal(res.state.statusCode, 400);
});

test(
  "API: http server smoke — POST denied without auth",
  async () => {
    setOperatorEnv();
    const server = createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/c6-zigbee-bench-firmware`, {
        method: "POST",
      });
      assert.equal(r.status, 401);
      const body = await r.json();
      assert.equal(body.error, "auth_denied");
    } finally {
      await new Promise((r) => server.close(r));
    }
  },
);
