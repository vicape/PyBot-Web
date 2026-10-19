/**
 * Pinned ESP32-C6 MicroPython+_uzigbee firmware distributor (anonymous guest mint).
 *
 * POST /api/c6-zigbee-bench-firmware
 *   Body: { chip: "ESP32-C6" } (exact chip allowlist)
 *   → short-lived per-segment tickets after server-side SHA verification + notices
 *   No login / session required (product-owner authorized guest delivery).
 *
 * GET /api/c6-zigbee-bench-firmware?ticket=...
 *   → raw verified segment bytes (ticket is scoped + short-lived)
 *
 * GET /api/c6-zigbee-bench-firmware?notices=1
 *   → bundled third-party notices (no login)
 *
 * Never exposes GitHub tokens, storage credentials, or long-lived privileged URLs.
 * Not an open generic proxy: only the pinned package components are served.
 */
import {
  C6_FIRMWARE_OPERATOR_SETUP,
  assertAllowedFirmwareChip,
  clearFirmwareSegmentCache,
  describeMissingOperatorSetup,
  getBundledFirmwareNotices,
  loadVerifiedSegment,
  mintPackageTickets,
  storageConfigFromEnv,
  verifySegmentTicket,
} from "./_c6ZigbeeBenchFirmware.js";

export { clearFirmwareSegmentCache, C6_FIRMWARE_OPERATOR_SETUP };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  const cfg = storageConfigFromEnv(process.env);

  if (req.method === "GET") {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("notices") === "1") {
      return json(res, 200, { ok: true, notices: getBundledFirmwareNotices() });
    }
    const ticket = url.searchParams.get("ticket") || "";
    if (!ticket) {
      return json(res, 400, { error: "missing_ticket" });
    }
    if (!cfg.signingSecret) {
      return json(res, 503, {
        error: "operator_setup_required",
        reason: C6_FIRMWARE_OPERATOR_SETUP,
      });
    }
    const verified = verifySegmentTicket(ticket, cfg.signingSecret);
    if (!verified.ok) {
      return json(res, 401, { error: "auth_denied", reason: verified.reason });
    }
    try {
      const { bytes, component } = await loadVerifiedSegment(verified.role, cfg);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-PyBot-Firmware-Role", component.role);
      res.setHeader("X-PyBot-Firmware-Sha256", component.sha256);
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.end(bytes);
      return;
    } catch (e) {
      const code = e?.code || "segment_load_failed";
      if (code === "sha256_mismatch" || code === "size_mismatch") {
        return json(res, 502, { error: "hash_mismatch", reason: String(e.message || code) });
      }
      if (code === "operator_setup_required" || code === "storage_not_configured") {
        return json(res, 503, {
          error: "operator_setup_required",
          reason: C6_FIRMWARE_OPERATOR_SETUP,
        });
      }
      return json(res, 502, { error: "segment_load_failed", reason: code });
    }
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "method_not_allowed" });
  }

  const body = readJsonBody(req);
  const chipGate = assertAllowedFirmwareChip(body.chip || "ESP32-C6");
  if (!chipGate.ok) {
    return json(res, chipGate.status, { error: chipGate.error, reason: chipGate.reason });
  }

  const missing = describeMissingOperatorSetup(cfg);
  if (missing) {
    return json(res, 503, { error: "operator_setup_required", reason: missing });
  }

  try {
    const minted = await mintPackageTickets(cfg);
    if (!minted.ok) {
      return json(res, minted.status, { error: minted.error, reason: minted.reason });
    }
    return json(res, 200, {
      ok: true,
      packageVersion: minted.packageVersion,
      chip: minted.chip,
      distribution: minted.distribution,
      notices: minted.notices,
      durableHint: minted.durableHint,
      tickets: minted.tickets,
      guest: true,
    });
  } catch (e) {
    const code = e?.code || "mint_failed";
    if (code === "sha256_mismatch" || code === "size_mismatch") {
      return json(res, 502, { error: "hash_mismatch", reason: String(e.message || code) });
    }
    if (code === "operator_setup_required" || code === "storage_not_configured") {
      return json(res, 503, {
        error: "operator_setup_required",
        reason: C6_FIRMWARE_OPERATOR_SETUP,
      });
    }
    return json(res, 502, { error: "mint_failed", reason: code });
  }
}
