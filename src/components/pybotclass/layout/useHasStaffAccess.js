import { useEffect, useState } from "react";
import { isStaffRole } from "../../../orgRole.js";
import { fetchOrganizationsForUser } from "../../../platform/organizationApi.js";
import { getSupabase } from "../../../supabaseClient.js";

/**
 * Resuelve si el usuario tiene membresía owner/teacher en alguna institución.
 * Si `forced` es boolean, lo usa directo (sin query).
 */
export function useHasStaffAccess(user, forced = undefined) {
  const [hasStaffAccess, setHasStaffAccess] = useState(
    typeof forced === "boolean" ? forced : null,
  );

  useEffect(() => {
    if (typeof forced === "boolean") {
      setHasStaffAccess(forced);
      return;
    }
    if (!user?.id) {
      setHasStaffAccess(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const sb = getSupabase();
      if (!sb) {
        if (!cancelled) setHasStaffAccess(false);
        return;
      }
      const memberOrgs = await fetchOrganizationsForUser(sb, user.id);
      if (cancelled) return;
      setHasStaffAccess(memberOrgs.some((o) => isStaffRole(o.role)));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, forced]);

  return hasStaffAccess;
}
