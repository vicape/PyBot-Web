import { useEffect, useMemo, useState } from "react";
import { fetchProfile } from "../../platform/profileApi.js";
import { isSuperAdmin } from "../../platformRole.js";
import { getSupabase, isSupabaseConfigured } from "../../supabaseClient.js";
import PyBotClassLayout from "../pybotclass/layout/PyBotClassLayout.jsx";

/**
 * Wrapper para páginas legacy (org/curso) y admin: mismo shell PyBotClass.
 */
export default function DashboardSubpageShell({ user, onSignOut, hideSearch = false, children }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase || !user?.id) return;
    let cancelled = false;
    (async () => {
      const { profile } = await fetchProfile(user.id);
      if (!cancelled) setShowAdmin(isSuperAdmin(profile));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user?.id]);

  return (
    <PyBotClassLayout user={user} showAdmin={showAdmin} hideSearch={hideSearch} onSignOut={onSignOut}>
      {children}
    </PyBotClassLayout>
  );
}
