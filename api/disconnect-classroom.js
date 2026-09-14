/**
 * POST /api/disconnect-classroom
 * Header: Authorization: Bearer <supabase_access_token>
 * Body: { org_id: string, mode: "teacher"|"student" }
 *
 * Org-scoped only. If vault unavailable → org_scoped_disconnect_unavailable
 * (does NOT wipe legacy global profiles under "este colegio").
 */

import { resolveUserId } from "./_telemetryHelpers.js";
import { assertClassroomOrgAccess } from "./_classroomOrgAuth.js";
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

  if (!isUuid(orgId)) {
    return res.status(400).json({ error: "missing_org" });
  }

  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const access = await assertClassroomOrgAccess({ userId, orgId, mode });
  if (!access.ok) {
    return res.status(403).json({ error: access.error || "forbidden_org" });
  }

  const cleared = await clearClassroomCredentials({ userId, orgId, mode });
  if (cleared.vaultUnavailable) {
    return res.status(409).json({
      ok: false,
      error: "org_scoped_disconnect_unavailable",
      org_id: orgId,
      mode,
    });
  }
  if (!cleared.ok) {
    return res.status(500).json({ error: cleared.error || "disconnect_failed" });
  }

  return res.status(200).json({
    ok: true,
    org_id: orgId,
    mode,
    vault: true,
  });
}
