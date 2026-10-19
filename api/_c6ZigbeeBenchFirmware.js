/**
 * Server-only helpers for pinned C6 MicroPython+_uzigbee firmware delivery
 * (anonymous guest mint allowed; short-lived tickets). Never import from the
 * browser bundle.
 *
 * Durable bytes live outside git (private object storage / local operator path).
 * GitHub Actions artifact IDs are provenance only unless explicitly configured
 * as a temporary server-side source while durable storage is provisioned.
 * Never log storage credentials or GitHub tokens.
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Bundled with the serverless function (keep in sync with firmware/.../private-bench-manifest.json). */
export const PRIVATE_BENCH_MANIFEST = require("./c6ZigbeeBenchPackage.json");
/** Bundled third-party notices (zboss / zigbee / uZigbee) for anonymous UI/API delivery. */
export const C6_FIRMWARE_NOTICES = require("./c6ZigbeeBenchNotices.json");

export const C6_FIRMWARE_API_PATH = "/api/c6-zigbee-bench-firmware";
export const TICKET_TTL_MS = 120_000;
export const C6_FIRMWARE_ALLOWED_CHIP = "ESP32-C6";

/**
 * Exact one-time SERVER-OPERATOR setup (NOT an end-user / login step) when
 * preview secrets / durable private storage are missing.
 */
export const C6_FIRMWARE_OPERATOR_SETUP =
  "OPERATOR_SETUP (Vercel Preview feature/esp32-universal-lab only): upload Maxwell artifact 12161052985 zigbee-firmware-private-bench/*.bin to private object storage that outlives GitHub Actions retention; set PYBOT_C6_FIRMWARE_SIGNING_SECRET, PYBOT_C6_FIRMWARE_STORAGE_BASE_URL, and PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER (Bearer/token for that store). Optional interim: PYBOT_C6_FIRMWARE_GITHUB_TOKEN + PYBOT_C6_FIRMWARE_GHA_ARTIFACT_ID=12161052985 + PYBOT_C6_FIRMWARE_GHA_REPO=vicape/cursor-control (still migrate to durable storage before artifact expiry). Guest/anonymous mint does not require user login.";

export function sha256HexBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function getExpectedComponents(manifest = PRIVATE_BENCH_MANIFEST) {
  return (manifest.components || []).map((c) => ({
    role: c.role,
    name: c.name,
    address: c.address,
    size: c.size,
    sha256: String(c.sha256 || "").toLowerCase(),
  }));
}

export function storageConfigFromEnv(env = process.env) {
  const localDir = String(env.PYBOT_C6_FIRMWARE_LOCAL_DIR || "").trim();
  const baseUrl = String(env.PYBOT_C6_FIRMWARE_STORAGE_BASE_URL || "").trim().replace(/\/+$/, "");
  const authHeader = String(env.PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER || "").trim();
  const ghToken = String(env.PYBOT_C6_FIRMWARE_GITHUB_TOKEN || "").trim();
  const ghArtifactId = String(env.PYBOT_C6_FIRMWARE_GHA_ARTIFACT_ID || "").trim();
  const ghRepo = String(env.PYBOT_C6_FIRMWARE_GHA_REPO || "vicape/cursor-control").trim();
  const signingSecret = String(env.PYBOT_C6_FIRMWARE_SIGNING_SECRET || "").trim();
  const operatorEmails = String(env.PYBOT_C6_FIRMWARE_OPERATOR_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  let mode = null;
  if (localDir) mode = "local";
  else if (baseUrl) mode = "object";
  else if (ghToken && ghArtifactId) mode = "gha-artifact";

  return {
    mode,
    localDir,
    baseUrl,
    authHeader,
    ghToken,
    ghArtifactId,
    ghRepo,
    signingSecret,
    operatorEmails,
    supabaseUrl: String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim(),
    serviceKey: String(env.SUPABASE_SERVICE_KEY || "").trim(),
  };
}

export function describeMissingOperatorSetup(cfg) {
  // Anonymous guest mint: only signing secret + pinned storage source are required.
  // Supabase / operator allowlist are not prerequisites for firmware delivery.
  if (!cfg.signingSecret) return C6_FIRMWARE_OPERATOR_SETUP;
  if (!cfg.mode) return C6_FIRMWARE_OPERATOR_SETUP;
  return null;
}

/** Strict chip allowlist for the pinned package (no open/generic firmware proxy). */
export function assertAllowedFirmwareChip(chip) {
  const normalized = String(chip || "").trim();
  if (normalized === C6_FIRMWARE_ALLOWED_CHIP) {
    return { ok: true, chip: C6_FIRMWARE_ALLOWED_CHIP };
  }
  return {
    ok: false,
    status: 403,
    error: "chip_denied",
    reason: `only_${C6_FIRMWARE_ALLOWED_CHIP}`,
  };
}

export function getBundledFirmwareNotices() {
  return {
    path: "firmware/pybot-c6-micropython-zigbee/THIRD_PARTY_NOTICES.md",
    paths: C6_FIRMWARE_NOTICES.paths,
    restrictions: C6_FIRMWARE_NOTICES.restrictions,
    documents: C6_FIRMWARE_NOTICES.documents,
    distribution: C6_FIRMWARE_NOTICES.distribution,
  };
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

export function mintSegmentTicket(role, secret, now = Date.now()) {
  const payload = {
    role,
    exp: now + TICKET_TTL_MS,
    v: 1,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return { ticket: `${body}.${sig}`, expiresAt: payload.exp };
}

export function verifySegmentTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== "string" || !ticket.includes(".")) {
    return { ok: false, reason: "ticket_malformed" };
  }
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return { ok: false, reason: "ticket_malformed" };
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "ticket_invalid" };
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "ticket_payload" };
  }
  if (!payload?.role || typeof payload.exp !== "number") {
    return { ok: false, reason: "ticket_payload" };
  }
  if (now > payload.exp) return { ok: false, reason: "ticket_expired" };
  return { ok: true, role: payload.role, exp: payload.exp };
}

/** In-memory verified segment cache (warm serverless instances only). */
const segmentCache = new Map();

export function clearFirmwareSegmentCache() {
  segmentCache.clear();
}

async function loadFromLocalDir(cfg, component) {
  const bytes = await readFile(join(cfg.localDir, component.name));
  return Buffer.from(bytes);
}

async function loadFromObjectStore(cfg, component, fetchImpl) {
  const url = `${cfg.baseUrl}/${encodeURIComponent(component.name)}`;
  const headers = {};
  if (cfg.authHeader) headers.Authorization = cfg.authHeader;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    const err = new Error(`storage_fetch_failed:${component.role}:${res.status}`);
    err.code = "storage_fetch_failed";
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadFromGithubArtifact(cfg, component, fetchImpl) {
  const cacheKey = `gha:${cfg.ghRepo}:${cfg.ghArtifactId}`;
  let zipBuf = segmentCache.get(cacheKey);
  if (!zipBuf) {
    const url = `https://api.github.com/repos/${cfg.ghRepo}/actions/artifacts/${cfg.ghArtifactId}/zip`;
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${cfg.ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const err = new Error(`gha_artifact_fetch_failed:${res.status}`);
      err.code = "gha_artifact_fetch_failed";
      throw err;
    }
    zipBuf = Buffer.from(await res.arrayBuffer());
    segmentCache.set(cacheKey, zipBuf);
  }
  // Lazy unzip via node:zlib + manual zip central directory is heavy; use
  // dynamic import of built-in unzip only when available — prefer matching
  // path suffix inside zip via simple local inflate helper.
  const extracted = await extractNamedFileFromZip(zipBuf, component.name);
  if (!extracted) {
    const err = new Error(`gha_artifact_missing:${component.name}`);
    err.code = "gha_artifact_missing";
    throw err;
  }
  return extracted;
}

/**
 * ZIP extractor via end-of-central-directory (handles data-descriptor GHA zips).
 * @param {Buffer} zipBuf
 * @param {string} fileName
 */
export async function extractNamedFileFromZip(zipBuf, fileName) {
  const { inflateRawSync } = await import("node:zlib");
  // Find EOCD signature 0x06054b50 within the last 64 KiB.
  const maxBack = Math.min(zipBuf.length, 65557);
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= zipBuf.length - maxBack; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdOffset = zipBuf.readUInt32LE(eocd + 16);
  const cdSize = zipBuf.readUInt32LE(eocd + 12);
  const cdEnd = cdOffset + cdSize;
  let offset = cdOffset;
  while (offset + 46 <= cdEnd && offset + 46 <= zipBuf.length) {
    if (zipBuf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = zipBuf.readUInt16LE(offset + 10);
    const compSize = zipBuf.readUInt32LE(offset + 20);
    const nameLen = zipBuf.readUInt16LE(offset + 28);
    const extraLen = zipBuf.readUInt16LE(offset + 30);
    const commentLen = zipBuf.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(offset + 42);
    const name = zipBuf.slice(offset + 46, offset + 46 + nameLen).toString("utf8");
    const base = name.split("/").pop();
    if (base === fileName || name === fileName || name.endsWith("/" + fileName)) {
      if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;
      const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressed = zipBuf.slice(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(compressed);
      if (method === 8) return inflateRawSync(compressed);
      return null;
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export async function loadVerifiedSegment(role, cfg, fetchImpl = fetch, manifest = PRIVATE_BENCH_MANIFEST) {
  const component = getExpectedComponents(manifest).find((c) => c.role === role);
  if (!component) {
    const err = new Error("unknown_role");
    err.code = "unknown_role";
    throw err;
  }
  const cacheKey = `seg:${cfg.mode}:${component.sha256}`;
  const cached = segmentCache.get(cacheKey);
  if (cached) return { bytes: cached, component };

  let bytes;
  if (cfg.mode === "local") bytes = await loadFromLocalDir(cfg, component);
  else if (cfg.mode === "object") bytes = await loadFromObjectStore(cfg, component, fetchImpl);
  else if (cfg.mode === "gha-artifact") bytes = await loadFromGithubArtifact(cfg, component, fetchImpl);
  else {
    const err = new Error("storage_not_configured");
    err.code = "operator_setup_required";
    throw err;
  }

  if (bytes.byteLength !== component.size) {
    const err = new Error(`size_mismatch:${component.role}`);
    err.code = "size_mismatch";
    throw err;
  }
  const digest = sha256HexBuffer(bytes);
  if (digest !== component.sha256) {
    const err = new Error(`sha256_mismatch:${component.role}`);
    err.code = "sha256_mismatch";
    throw err;
  }
  segmentCache.set(cacheKey, bytes);
  return { bytes, component };
}

export async function mintPackageTickets(cfg, fetchImpl = fetch, manifest = PRIVATE_BENCH_MANIFEST) {
  const missing = describeMissingOperatorSetup(cfg);
  if (missing) {
    return { ok: false, status: 503, error: "operator_setup_required", reason: missing };
  }
  const components = getExpectedComponents(manifest);
  const tickets = [];
  for (const c of components) {
    // Verify bytes exist and match before minting any ticket.
    await loadVerifiedSegment(c.role, cfg, fetchImpl, manifest);
    const minted = mintSegmentTicket(c.role, cfg.signingSecret);
    tickets.push({
      role: c.role,
      name: c.name,
      address: c.address,
      size: c.size,
      sha256: c.sha256,
      ticket: minted.ticket,
      expiresAt: minted.expiresAt,
      path: `${C6_FIRMWARE_API_PATH}?ticket=${encodeURIComponent(minted.ticket)}`,
    });
  }
  return {
    ok: true,
    status: 200,
    packageVersion: manifest.version,
    chip: manifest.chip || C6_FIRMWARE_ALLOWED_CHIP,
    distribution: manifest.distribution,
    notices: getBundledFirmwareNotices(),
    durableHint:
      cfg.mode === "gha-artifact"
        ? "Serving from GitHub Actions artifact (interim). Migrate to PYBOT_C6_FIRMWARE_STORAGE_BASE_URL before artefact expiry."
        : null,
    tickets,
  };
}
