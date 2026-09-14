/**
 * POST /api/disconnect-classroom
 * Header: Authorization: Bearer <supabase_access_token>
 * Body: { org_id: string, mode: "teacher"|"student" }
 *
 * Clears vault + link for that org+mode only. Does not sign out PyBot.
 * Also clears legacy profiles tokens for that mode when disconnecting
 * (legacy global) only if requested via clear_legacy: true — default false
 * to avoid wiping other orgs' legacy shared token accidentally when vault is primary.
 *
 * When vault unavailable: clears legacy profiles for the mode (pre-migration).
 */

import { resolveUserId } from "./_telemetryHelpers.js";
import { supabaseRest } from "./_telemetryHelpers.js";
import {
  clearClassroomCredentials,
  isUuid,
  normalizeClassroomMode,
} from "./_classroomCredentials.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const body = req.body || {};
  const orgId = typeof body.org_id === "string" ? body.org_id.trim() : "";
  const mode = normalizeClassroomMode(body.mode);
  const clearLegacy = body.clear_legacy === true;

  if (!isUuid(orgId)) {
    return res.status(400).json({ error: "missing_org" });
  }

  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const cleared = await clearClassroomCredentials({ userId, orgId, mode });
  if (!cleared.ok && !cleared.vaultUnavailable) {
    return res.status(500).json({ error: cleared.error || "disconnect_failed" });
  }

  // Pre-migration: vault missing → clear legacy profiles for this mode so disconnect works.
  // When vault works: do NOT clear profiles (other orgs may still use dual-read legacy).
  if (cleared.vaultUnavailable || clearLegacy) {
    try {
      const patch =
        mode === "student"
          ? {
              google_student_refresh_token: null,
              google_student_token_expires_at: null,
              classroom_student_linked_at: null,
            }
          : {
              google_refresh_token: null,
              google_token_expires_at: null,
              classroom_linked_at: null,
            };
      await supabaseRest(`profiles?id=eq.${userId}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: patch,
      });
    } catch {
      // ignore missing columns
    }
  }

  return res.status(200).json({
    ok: true,
    org_id: orgId,
    mode,
    vault: !cleared.vaultUnavailable,
  });
}
