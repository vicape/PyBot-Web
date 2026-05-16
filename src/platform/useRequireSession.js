import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { ensureProfileForUser } from "./ensureProfile.js";

/**
 * Redirige a /login si no hay sesión Supabase.
 * @returns {{ user, loading, profileError }}
 */
export function useRequireSession(loginNextPath) {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false);
      navigate("/dashboard", { replace: true });
      return;
    }

    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const u = data.session?.user ?? null;
      if (!u) {
        const next = loginNextPath ? `?next=${encodeURIComponent(loginNextPath)}` : "";
        navigate(`/login${next}`, { replace: true });
        return;
      }
      setUser(u);
      const prof = await ensureProfileForUser(u);
      if (!prof.ok && !cancelled) {
        setProfileError(prof.error || "No se pudo sincronizar el perfil.");
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, navigate, loginNextPath]);

  return { user, loading, profileError, supabase };
}
