import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GOOGLE_CLASSROOM_STUDENT_SCOPES,
  GOOGLE_CLASSROOM_TEACHER_SCOPES,
  CLASSROOM_OAUTH_CALLBACK_PATH,
  CLASSROOM_OAUTH_TTL_MS,
  buildClassroomAuthorizeUrl,
  createClassroomOAuthState,
  scopesForClassroomMode,
  validateClassroomOAuthFlow,
  baseLoginOAuthOptions,
} from "../src/platform/googleOAuth.js";
import { isAllowedClassroomRedirectUri } from "../api/exchange-classroom-code.js";
import { confirmClassroomPersistence } from "../src/platform/confirmClassroomPersistence.js";
import { CLASSROOM_CONNECTION, classifyClassroomConnectionError } from "../src/platform/classifyClassroomConnection.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("P4 login normal sigue usando baseLoginOAuthOptions / scopes base", () => {
  const opts = baseLoginOAuthOptions("https://example.com/auth/callback");
  assert.equal(opts.redirectTo, "https://example.com/auth/callback");
  assert.match(opts.scopes, /openid/);
  assert.doesNotMatch(opts.scopes, /classroom\.courses/);
  const login = readSrc("src/pages/LoginPage.jsx");
  assert.match(login, /signInWithOAuth/);
  assert.match(login, /baseLoginOAuthOptions/);
});

test("P4 connectGoogleClassroom NO usa sb.auth.signInWithOAuth", () => {
  const src = readSrc("src/platform/googleOAuth.js");
  const fnStart = src.indexOf("export async function connectGoogleClassroom");
  assert.ok(fnStart >= 0);
  const fnBody = src.slice(fnStart, src.indexOf("export async function exchangeClassroomAuthorizationCode", fnStart));
  assert.doesNotMatch(fnBody, /signInWithOAuth/);
  assert.match(fnBody, /buildClassroomAuthorizeUrl/);
  assert.match(fnBody, /window\.location\.assign/);
});

test("P4 Classroom usa callback dedicado", () => {
  const app = readSrc("src/App.jsx");
  assert.match(app, /\/auth\/classroom\/callback/);
  assert.match(app, /ClassroomAuthCallbackPage/);
  assert.equal(CLASSROOM_OAUTH_CALLBACK_PATH, "/auth/classroom/callback");
  const authCb = readSrc("src/pages/AuthCallbackPage.jsx");
  assert.doesNotMatch(authCb, /confirmClassroomPersistence/);
  assert.doesNotMatch(authCb, /wasClassroomOAuthIntent/);
  assert.doesNotMatch(authCb, /provider_refresh_token/);
});

test("P4 genera state aleatorio", () => {
  const a = createClassroomOAuthState();
  const b = createClassroomOAuthState();
  assert.equal(typeof a, "string");
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

test("P4 callback rechaza state incorrecto / ausente / expirado", () => {
  const now = 1_700_000_000_000;
  const flow = {
    state: "abc123",
    initiatingPybotUserId: "user-pybot",
    mode: "teacher",
    nextPath: "/dashboard/classes",
    createdAt: now,
  };
  assert.equal(validateClassroomOAuthFlow(flow, "wrong", now).ok, false);
  assert.equal(validateClassroomOAuthFlow(flow, "wrong", now).code, "state_mismatch");
  assert.equal(validateClassroomOAuthFlow(flow, null, now).ok, false);
  assert.equal(validateClassroomOAuthFlow(null, "abc123", now).ok, false);
  assert.equal(
    validateClassroomOAuthFlow(flow, "abc123", now + CLASSROOM_OAUTH_TTL_MS + 1).code,
    "flow_expired",
  );
  assert.equal(validateClassroomOAuthFlow(flow, "abc123", now + 1000).ok, true);
});

test("P4 authorize URL: code + offline + consent select_account + state", () => {
  const url = buildClassroomAuthorizeUrl({
    clientId: "cid",
    redirectUri: "http://localhost:5173/auth/classroom/callback",
    scopes: GOOGLE_CLASSROOM_TEACHER_SCOPES,
    state: "staterand",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent select_account");
  assert.equal(u.searchParams.get("state"), "staterand");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:5173/auth/classroom/callback");
  assert.match(u.searchParams.get("scope") || "", /classroom\.courses\.readonly/);
});

test("P4 teacher/student conservan scopes diferentes", () => {
  assert.notEqual(GOOGLE_CLASSROOM_TEACHER_SCOPES, GOOGLE_CLASSROOM_STUDENT_SCOPES);
  assert.match(scopesForClassroomMode("teacher"), /courses\.readonly/);
  assert.doesNotMatch(scopesForClassroomMode("student"), /courses\.readonly/);
  assert.match(scopesForClassroomMode("student"), /coursework\.me/);
});

test("P4 callback page exige sesión PyBot e iniciador; NO compara email", () => {
  const page = readSrc("src/pages/ClassroomAuthCallbackPage.jsx");
  assert.match(page, /initiatingPybotUserId/);
  assert.match(page, /getSession/);
  assert.match(page, /user\.id !== flow\.initiatingPybotUserId/);
  assert.doesNotMatch(page, /expectedEmail|emailMismatch|session\.user\.email/);
  assert.doesNotMatch(page, /\.signInWithOAuth\(|\.signOut\(|linkIdentity/);
  assert.match(page, /No se pudo conectar Google Classroom/);
  assert.doesNotMatch(page, /Error al iniciar sesión/);
});

test("P4 server exchange: redirect URI + Bearer; secret no en frontend", () => {
  const api = readSrc("api/exchange-classroom-code.js");
  assert.match(api, /req\.method !== "POST"/);
  assert.match(api, /unauthorized/);
  assert.match(api, /GOOGLE_CLIENT_SECRET/);
  assert.match(api, /grant_type.*authorization_code|authorization_code/);
  assert.match(api, /isAllowedClassroomRedirectUri/);

  const front = readSrc("src/platform/googleOAuth.js") + readSrc("src/pages/ClassroomAuthCallbackPage.jsx");
  assert.doesNotMatch(front, /VITE_GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_SECRET/);

  assert.equal(
    isAllowedClassroomRedirectUri("http://localhost:5173/auth/classroom/callback", {}),
    true,
  );
  assert.equal(
    isAllowedClassroomRedirectUri("https://evil.com/auth/classroom/callback", {
      headers: { host: "pybot-web.vercel.app" },
    }),
    false,
  );
  assert.equal(
    isAllowedClassroomRedirectUri("https://pybot-web.vercel.app/auth/classroom/callback", {
      headers: { host: "pybot-web.vercel.app" },
    }),
    true,
  );
  assert.equal(
    isAllowedClassroomRedirectUri("https://pybot-web.vercel.app/auth/callback", {
      headers: { host: "pybot-web.vercel.app" },
    }),
    false,
  );
});

test("P4 P2 persistencia sigue utilizándose en callback Classroom", () => {
  const page = readSrc("src/pages/ClassroomAuthCallbackPage.jsx");
  assert.match(page, /confirmClassroomPersistence/);
  assert.match(page, /primeClassroomAccessToken/);
});

test("P4 P1 refresh intacto", () => {
  const tok = readSrc("src/platform/classroomToken.js");
  assert.match(tok, /\/api\/refresh-classroom-token/);
  assert.doesNotMatch(tok, /oauth2\.googleapis\.com\/token/);
  assert.doesNotMatch(tok, /VITE_GOOGLE_CLIENT_SECRET/);
});

test("P4 P3 estado intacto", () => {
  const r = classifyClassroomConnectionError({ code: "invalid_grant" });
  assert.equal(r.status, CLASSROOM_CONNECTION.RECONNECT_REQUIRED);
  const ok = classifyClassroomConnectionError({ code: "something_else", message: "tmp" });
  assert.equal(ok.status, CLASSROOM_CONNECTION.ERROR);
});

test("P4 confirmClassroomPersistence teacher sigue ok (smoke P2)", async () => {
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT", expiresIn: 3600 },
    {
      saveGoogleTokens: async () => ({ ok: true, skipped: false }),
      saveStudentGoogleTokens: async () => ({ ok: true }),
      getStoredGoogleRefreshToken: async () => ({ google_refresh_token: "RT" }),
      getStoredStudentGoogleRefreshToken: async () => "RT",
      markClassroomLinked: async () => ({ ok: true, skipped: false }),
      markStudentClassroomLinked: async () => ({ ok: true }),
    },
  );
  assert.equal(r.ok, true);
});
