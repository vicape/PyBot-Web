/**
 * Hardening P5/P16/P15/P13 — tests de comportamiento (no solo regex).
 */
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pickInitialClassroomOrgId } from "../src/platform/classroomOrgContext.js";
import {
  clearClassroomTokenCache,
  getValidClassroomToken,
  primeClassroomAccessToken,
} from "../src/platform/classroomToken.js";
import {
  countPendingClassroomGrades,
  needsClassroomReturnRetry,
} from "../src/platform/pybotClassApi.js";
import { normalizeCourseRole } from "../src/platform/courseRole.js";
import { CLASSROOM_CONNECTION, classifyClassroomConnectionError } from "../src/platform/classifyClassroomConnection.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_OK = "11111111-1111-4111-8111-111111111111";
const ORG_OTHER = "22222222-2222-4222-8222-222222222222";

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function mockRes() {
  const out = { statusCode: 0, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    },
  };
}

before(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-test-key";
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
});

test("1) exchange-classroom-code never returns refresh_token (vault + legacy paths)", async (t) => {
  const calls = { legacy: 0, vault: 0 };
  mock.module(pathToFileURL(join(root, "api/_telemetryHelpers.js")).href, {
    namedExports: {
      resolveUserId: async () => UUID_A,
      supabaseRest: async () => [],
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomOrgAuth.js")).href, {
    namedExports: {
      assertClassroomOrgAccess: async () => ({ ok: true, role: "teacher" }),
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomCredentials.js")).href, {
    namedExports: {
      isUuid: (v) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(v || ""),
        ),
      normalizeClassroomMode: (m) => (m === "student" ? "student" : "teacher"),
      loadClassroomRefreshToken: async () => ({ refreshToken: null, source: null }),
      upsertClassroomCredentials: async () => {
        calls.vault += 1;
        return { ok: false, vaultUnavailable: true, error: "vault_unavailable" };
      },
      upsertLegacyProfileCredentials: async ({ refreshToken }) => {
        calls.legacy += 1;
        assert.equal(refreshToken, "RT_FROM_GOOGLE");
        return { ok: true, source: "profiles_legacy" };
      },
    },
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: "AT",
      refresh_token: "RT_FROM_GOOGLE",
      expires_in: 3600,
    }),
  });

  try {
    const mod = await import(
      `${pathToFileURL(join(root, "api/exchange-classroom-code.js")).href}?t=${Date.now()}`
    );
    const res = mockRes();
    await mod.default(
      {
        method: "POST",
        headers: {
          authorization: "Bearer sb",
          host: "localhost:5173",
        },
        body: {
          code: "auth-code",
          redirect_uri: "http://localhost:5173/auth/classroom/callback",
          mode: "teacher",
          org_id: ORG_OK,
        },
      },
      res,
    );
    assert.equal(res.out.statusCode, 200);
    assert.equal(res.out.body.access_token, "AT");
    assert.equal(Object.prototype.hasOwnProperty.call(res.out.body, "refresh_token"), false);
    assert.equal(res.out.body.refresh_token, undefined);
    assert.equal(calls.legacy, 1);
    assert.equal(res.out.body.source, "profiles_legacy");
  } finally {
    globalThis.fetch = prevFetch;
    mock.restoreAll();
  }
});

test("2) refresh-classroom-token rejects browser refresh_token", async () => {
  mock.module(pathToFileURL(join(root, "api/_telemetryHelpers.js")).href, {
    namedExports: {
      resolveUserId: async () => UUID_A,
      supabaseRest: async () => [],
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomOrgAuth.js")).href, {
    namedExports: {
      assertClassroomOrgAccess: async () => ({ ok: true }),
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomCredentials.js")).href, {
    namedExports: {
      isUuid: () => true,
      normalizeClassroomMode: (m) => (m === "student" ? "student" : "teacher"),
      loadClassroomRefreshToken: async () => {
        throw new Error("should_not_load_when_body_has_rt");
      },
    },
  });

  try {
    const mod = await import(
      `${pathToFileURL(join(root, "api/refresh-classroom-token.js")).href}?t=${Date.now()}`
    );
    const res = mockRes();
    await mod.default(
      {
        method: "POST",
        headers: { authorization: "Bearer sb" },
        body: {
          mode: "teacher",
          org_id: ORG_OK,
          refresh_token: "BROWSER_RT",
        },
      },
      res,
    );
    assert.equal(res.out.statusCode, 400);
    assert.equal(res.out.body.error, "refresh_token_not_allowed");
  } finally {
    mock.restoreAll();
  }
});

test("3-4) frontend never SELECTs google_refresh_token / google_student_refresh_token", () => {
  const srcDirs = ["src/platform", "src/pages", "src/components", "src/classroom"];
  const offenders = [];
  for (const dir of srcDirs) {
    const abs = join(root, dir);
    const walk = (d) => {
      for (const name of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, name.name);
        if (name.isDirectory()) walk(p);
        else if (/\.(js|jsx|mjs|ts|tsx)$/.test(name.name)) {
          const txt = readFileSync(p, "utf8");
          // SELECT of RT columns (not nulling in clearClassroomTokens UPDATE)
          const selectHits = [
            ...txt.matchAll(/\.select\s*\(\s*[`"']([^`"']*)[`"']/g),
            ...txt.matchAll(/\.select\s*\(\s*\n?\s*[`"']([^`"']*)[`"']/g),
          ];
          for (const m of selectHits) {
            const cols = m[1] || "";
            if (/\bgoogle_refresh_token\b/.test(cols) || /\bgoogle_student_refresh_token\b/.test(cols)) {
              offenders.push(`${p}: ${cols}`);
            }
          }
          // PROFILE_COLUMNS / string selects
          if (
            /select\([^)]*google_refresh_token/.test(txt) ||
            /select\([^)]*google_student_refresh_token/.test(txt)
          ) {
            offenders.push(p);
          }
          if (
            /PROFILE_COLUMNS[^;]*google_refresh_token/.test(txt) ||
            /PROFILE_COLUMNS[^;]*google_student_refresh_token/.test(txt)
          ) {
            offenders.push(p);
          }
        }
      }
    };
    try {
      walk(abs);
    } catch {
      //
    }
  }
  // Explicit known stubs must not SELECT RT
  const profile = readSrc("src/platform/profileApi.js");
  assert.doesNotMatch(profile, /\.select\([^)]*google_refresh_token/);
  assert.doesNotMatch(profile, /\.select\([^)]*google_student_refresh_token/);
  const fullColsMatch = profile.match(/const PROFILE_COLUMNS_FULL\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(fullColsMatch);
  assert.doesNotMatch(fullColsMatch[1], /google_refresh_token|google_student_refresh_token/);
  assert.equal(offenders.length, 0, offenders.join("\n"));
});

test("5-6) assertClassroomOrgAccess: foreign org forbidden; teacher needs staff", async () => {
  const { assertClassroomOrgAccess } = await import("../api/_classroomOrgAuth.js");

  // Patch supabaseRest via temporary monkey — use mock.module then reimport
  mock.module(pathToFileURL(join(root, "api/_telemetryHelpers.js")).href, {
    namedExports: {
      resolveUserId: async () => UUID_A,
      supabaseRest: async (path) => {
        if (String(path).startsWith("profiles?")) {
          return [{ is_super_admin: false }];
        }
        if (String(path).includes(`org_id=eq.${ORG_OTHER}`)) {
          return []; // no membership
        }
        if (String(path).includes(`org_id=eq.${ORG_OK}`) && String(path).includes("organization_members")) {
          return [{ role: "student" }]; // member but not staff
        }
        if (String(path).startsWith("courses?")) return [];
        return [];
      },
    },
  });

  try {
    const mod = await import(
      `${pathToFileURL(join(root, "api/_classroomOrgAuth.js")).href}?auth=${Date.now()}`
    );
    const foreign = await mod.assertClassroomOrgAccess({
      userId: UUID_A,
      orgId: ORG_OTHER,
      mode: "teacher",
    });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error, "forbidden_org");

    const studentAsTeacher = await mod.assertClassroomOrgAccess({
      userId: UUID_A,
      orgId: ORG_OK,
      mode: "teacher",
    });
    assert.equal(studentAsTeacher.ok, false);
    assert.equal(studentAsTeacher.error, "forbidden_org");
  } finally {
    mock.restoreAll();
  }

  // Direct import without mock still exports function
  assert.equal(typeof assertClassroomOrgAccess, "function");
});

test("5b) teacher staff allowed", async () => {
  mock.module(pathToFileURL(join(root, "api/_telemetryHelpers.js")).href, {
    namedExports: {
      resolveUserId: async () => UUID_A,
      supabaseRest: async (path) => {
        if (String(path).startsWith("profiles?")) return [{ is_super_admin: false }];
        if (String(path).includes("organization_members")) return [{ role: "teacher" }];
        return [];
      },
    },
  });
  try {
    const mod = await import(
      `${pathToFileURL(join(root, "api/_classroomOrgAuth.js")).href}?staff=${Date.now()}`
    );
    const ok = await mod.assertClassroomOrgAccess({
      userId: UUID_A,
      orgId: ORG_OK,
      mode: "teacher",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.role, "teacher");
  } finally {
    mock.restoreAll();
  }
});

test("7) multi-org no elige org arbitrariamente", () => {
  const staff = [{ id: "org-a" }, { id: "org-b" }];
  assert.equal(pickInitialClassroomOrgId({ staffOrgs: staff }), "");
  assert.equal(pickInitialClassroomOrgId({ staffOrgs: [{ id: "only" }] }), "only");
  assert.equal(
    pickInitialClassroomOrgId({ preferredOrgId: "org-b", staffOrgs: staff }),
    "org-b",
  );
  const home = readSrc("src/components/pybotclass/layout/PyBotClassHome.jsx");
  assert.doesNotMatch(home, /orgMemberships\[0\]\.(id|org_id)/);
  assert.match(home, /pickInitialClassroomOrgId/);
  assert.match(home, /Seleccioná un colegio/);
});

test("8) access-token cache aislada por user+mode+org", async () => {
  clearClassroomTokenCache();
  primeClassroomAccessToken(UUID_A, "teacher", "TOK_A_TEACHER_ORG1", 3600, ORG_OK);
  primeClassroomAccessToken(UUID_A, "teacher", "TOK_A_TEACHER_ORG2", 3600, ORG_OTHER);
  primeClassroomAccessToken(UUID_A, "student", "TOK_A_STUDENT_ORG1", 3600, ORG_OK);
  primeClassroomAccessToken(UUID_B, "teacher", "TOK_B", 3600, ORG_OK);

  // Without network: getValid uses cache when not expired
  const a1 = await getValidClassroomToken(UUID_A, { mode: "teacher", orgId: ORG_OK });
  const a2 = await getValidClassroomToken(UUID_A, { mode: "teacher", orgId: ORG_OTHER });
  const a3 = await getValidClassroomToken(UUID_A, { mode: "student", orgId: ORG_OK });
  const b1 = await getValidClassroomToken(UUID_B, { mode: "teacher", orgId: ORG_OK });
  assert.equal(a1, "TOK_A_TEACHER_ORG1");
  assert.equal(a2, "TOK_A_TEACHER_ORG2");
  assert.equal(a3, "TOK_A_STUDENT_ORG1");
  assert.equal(b1, "TOK_B");
  assert.equal(await getValidClassroomToken(UUID_A, { mode: "teacher", orgId: null }), null);
  clearClassroomTokenCache();
});

test("9) disconnect org-scoped no borra legacy si vault unavailable", async () => {
  mock.module(pathToFileURL(join(root, "api/_telemetryHelpers.js")).href, {
    namedExports: {
      resolveUserId: async () => UUID_A,
      supabaseRest: async () => {
        throw new Error("should_not_hit_profiles");
      },
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomOrgAuth.js")).href, {
    namedExports: {
      assertClassroomOrgAccess: async () => ({ ok: true, role: "teacher" }),
    },
  });
  mock.module(pathToFileURL(join(root, "api/_classroomCredentials.js")).href, {
    namedExports: {
      isUuid: () => true,
      normalizeClassroomMode: () => "teacher",
      clearClassroomCredentials: async () => ({
        ok: false,
        vaultUnavailable: true,
        error: "vault_unavailable",
      }),
    },
  });

  try {
    const mod = await import(
      `${pathToFileURL(join(root, "api/disconnect-classroom.js")).href}?t=${Date.now()}`
    );
    const res = mockRes();
    await mod.default(
      {
        method: "POST",
        headers: { authorization: "Bearer sb" },
        body: { org_id: ORG_OK, mode: "teacher" },
      },
      res,
    );
    assert.equal(res.out.statusCode, 409);
    assert.equal(res.out.body.error, "org_scoped_disconnect_unavailable");
    const apiSrc = readSrc("api/disconnect-classroom.js");
    assert.doesNotMatch(apiSrc, /google_refresh_token/);
    assert.doesNotMatch(apiSrc, /clearClassroomTokens/);
  } finally {
    mock.restoreAll();
  }
});

test("10) return fallido queda reintentable (pending + needs retry)", () => {
  const gradebook = {
    activities: [{ id: "act1", classroom_coursework_id: "cw1" }],
    grades: [
      {
        activity_id: "act1",
        grade: 8,
        classroom_grade_synced_at: "2026-01-01T00:00:00Z",
        classroom_grade_return_status: "error_retryable",
      },
      {
        activity_id: "act1",
        grade: 9,
        classroom_grade_synced_at: "2026-01-01T00:00:00Z",
        classroom_grade_return_status: "ok",
      },
    ],
  };
  assert.equal(countPendingClassroomGrades(gradebook), 1);
  assert.equal(needsClassroomReturnRetry(gradebook.grades[0]), true);
  assert.equal(needsClassroomReturnRetry(gradebook.grades[1]), false);

  const mig = readSrc("supabase/migrations/20260914000048_classroom_grade_return_status.sql");
  assert.match(mig, /classroom_grade_return_status/);
  assert.match(mig, /error_retryable/);
  const act = readSrc("src/platform/activityClassroom.js");
  assert.match(act, /returnOnly/);
  assert.match(act, /error_retryable/);
});

test("11) P1–P4 y P19 siguen verdes (smoke)", () => {
  const tok = readSrc("src/platform/classroomToken.js");
  assert.match(tok, /\/api\/refresh-classroom-token/);
  assert.doesNotMatch(tok, /VITE_GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(tok, /oauth2\.googleapis\.com\/token/);

  assert.equal(normalizeCourseRole("owner"), "teacher");
  assert.equal(
    classifyClassroomConnectionError({ code: "invalid_grant" }).status,
    CLASSROOM_CONNECTION.RECONNECT_REQUIRED,
  );

  const login = readSrc("src/pages/LoginPage.jsx");
  assert.match(login, /baseLoginOAuthOptions/);
  const oauth = readSrc("src/platform/googleOAuth.js");
  assert.match(oauth, /buildClassroomAuthorizeUrl/);
});

after(() => {
  mock.restoreAll();
});
