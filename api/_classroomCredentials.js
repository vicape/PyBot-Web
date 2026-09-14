/**
 * Server-only Classroom credentials (P5/P16).
 * Refresh tokens: private.classroom_oauth_secrets via SECURITY DEFINER RPCs (service role).
 * Metadata: public.organization_classroom_links (no RT).
 * Dual-read fallback: profiles.google_* while vault migrates.
 */

import { supabaseRest } from "./_telemetryHelpers.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeClassroomMode(mode) {
  return mode === "student" ? "student" : "teacher";
}

export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function isMissingRelation(err) {
  const msg = String(err?.message || err?.data?.message || err?.data?.error || "");
  const code = String(err?.data?.code || err?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST202" ||
    /does not exist|schema cache|Could not find the function|upsert_classroom_oauth|get_classroom_oauth|organization_classroom_links/i.test(
      msg,
    )
  );
}

/**
 * Persist refresh token + link metadata.
 * @returns {{ ok: boolean, vault?: boolean, vaultUnavailable?: boolean, error?: string }}
 */
export async function upsertClassroomCredentials({
  userId,
  orgId,
  mode,
  refreshToken,
  expiresIn,
}) {
  const uid = String(userId || "").trim();
  const oid = String(orgId || "").trim();
  const m = normalizeClassroomMode(mode);
  const rt = String(refreshToken || "").trim();
  if (!isUuid(uid) || !isUuid(oid) || !rt) {
    return { ok: false, error: "missing_params" };
  }

  const expiresAt =
    Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;
  const now = new Date().toISOString();

  try {
    await supabaseRest("rpc/upsert_classroom_oauth_secret", {
      method: "POST",
      body: {
        p_user_id: uid,
        p_org_id: oid,
        p_mode: m,
        p_refresh_token: rt,
      },
    });
  } catch (err) {
    if (isMissingRelation(err) || err?.status === 404) {
      return { ok: false, vaultUnavailable: true, error: "vault_unavailable" };
    }
    return { ok: false, error: err.message || "vault_upsert_failed" };
  }

  try {
    await supabaseRest("organization_classroom_links?on_conflict=user_id,org_id,mode", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        user_id: uid,
        org_id: oid,
        mode: m,
        classroom_linked_at: now,
        google_token_expires_at: expiresAt,
        updated_at: now,
      },
    });
  } catch (err) {
    if (isMissingRelation(err) || err?.status === 404) {
      return { ok: false, vaultUnavailable: true, error: "links_unavailable" };
    }
    return { ok: false, error: err.message || "link_upsert_failed" };
  }

  return { ok: true, vault: true };
}

/**
 * Load refresh token for (user, org, mode). Vault first, then legacy profiles.
 */
export async function loadClassroomRefreshToken({ userId, orgId, mode }) {
  const uid = String(userId || "").trim();
  const oid = orgId ? String(orgId).trim() : "";
  const m = normalizeClassroomMode(mode);
  if (!isUuid(uid)) return { refreshToken: null, source: null };

  if (isUuid(oid)) {
    try {
      const rows = await supabaseRest("rpc/get_classroom_oauth_secret", {
        method: "POST",
        body: { p_user_id: uid, p_org_id: oid, p_mode: m },
      });
      const rt =
        typeof rows === "string"
          ? rows
          : Array.isArray(rows)
            ? rows[0]
            : rows;
      if (rt && typeof rt === "string" && rt.trim()) {
        return { refreshToken: rt.trim(), source: "vault" };
      }
    } catch {
      // fall through to legacy
    }
  }

  try {
    const cols =
      m === "student" ? "google_student_refresh_token" : "google_refresh_token";
    const rows = await supabaseRest(`profiles?id=eq.${uid}&select=${cols}`, {
      method: "GET",
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    const rt =
      m === "student" ? row?.google_student_refresh_token : row?.google_refresh_token;
    if (rt) return { refreshToken: String(rt), source: "profiles_legacy" };
  } catch {
    //
  }

  return { refreshToken: null, source: null };
}

/**
 * Clear vault + link for one org+mode. Does not touch other orgs or PyBot session.
 */
export async function clearClassroomCredentials({ userId, orgId, mode }) {
  const uid = String(userId || "").trim();
  const oid = String(orgId || "").trim();
  const m = normalizeClassroomMode(mode);
  if (!isUuid(uid) || !isUuid(oid)) return { ok: false, error: "missing_params" };

  let vaultUnavailable = false;
  try {
    await supabaseRest("rpc/delete_classroom_oauth_secret", {
      method: "POST",
      body: { p_user_id: uid, p_org_id: oid, p_mode: m },
    });
  } catch (err) {
    if (isMissingRelation(err) || err?.status === 404) vaultUnavailable = true;
    else return { ok: false, error: err.message || "vault_delete_failed" };
  }

  try {
    await supabaseRest(
      `organization_classroom_links?user_id=eq.${uid}&org_id=eq.${oid}&mode=eq.${m}`,
      { method: "DELETE", prefer: "return=minimal" },
    );
  } catch (err) {
    if (isMissingRelation(err) || err?.status === 404) vaultUnavailable = true;
    else return { ok: false, error: err.message || "link_delete_failed" };
  }

  return { ok: true, vaultUnavailable };
}
