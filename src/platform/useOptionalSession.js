import { useCallback, useEffect, useMemo, useState } from "react";
import { getGoogleProfile } from "../authSession.js";
import { signOutGoogleClient } from "../authGoogle.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

/** @param {import("@supabase/supabase-js").User | { _legacy: true, name?: string, email?: string, picture?: string } | null} user */
export function sessionUserDisplay(user) {
  if (!user) return null;
  if (user._legacy) {
    return {
      name: user.name || user.email?.split("@")[0] || "Usuario",
      email: user.email ?? null,
      picture: user.picture ?? null,
    };
  }
  const meta = user.user_metadata || {};
  return {
    name: meta.full_name || meta.name || user.email?.split("@")[0] || "Usuario",
    email: user.email ?? null,
    picture: meta.avatar_url || meta.picture || null,
  };
}

/**
 * Sesión opcional (IDE): no redirige si falta login.
 * @returns {{ user, loading, supabase, useCloud, signOut }}
 */
export function useOptionalSession() {
  const supabase = useMemo(() => getSupabase(), []);
  const useCloud = isSupabaseConfigured();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!useCloud);

  useEffect(() => {
    if (!useCloud || !supabase) {
      const legacy = getGoogleProfile();
      if (legacy) {
        setUser({
          _legacy: true,
          name: legacy.name,
          email: legacy.email,
          picture: legacy.picture,
        });
      }
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data?.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!cancelled) setUser(sess?.user ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [useCloud, supabase]);

  const signOut = useCallback(async () => {
    if (user?._legacy) {
      signOutGoogleClient();
      setUser(null);
      return;
    }
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("useOptionalSession.signOut:", error);
    }
  }, [user, supabase]);

  return { user, loading, supabase, useCloud, signOut };
}
