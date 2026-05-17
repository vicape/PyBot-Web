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

    const timer = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setProfileError("La sesión tardó demasiado. Recargá la página.");
      }
    }, 8000);

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) {
        console.error("useRequireSession.getSession:", error);
      }
      const u = data?.session?.user ?? null;
      if (!u) {
        clearTimeout(timer);
        const next = loginNextPath ? `?next=${encodeURIComponent(loginNextPath)}` : "";
        navigate(`/login${next}`, { replace: true });
        return;
      }
      setUser(u);
      const prof = await ensureProfileForUser(u);
      if (cancelled) return;
      clearTimeout(timer);
      if (!prof.ok) {
        console.error("useRequireSession.ensureProfile:", prof.error);
        setProfileError(prof.error || "No se pudo sincronizar el perfil.");
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase, navigate, loginNextPath]);

  return { user, loading, profileError, supabase };
}
