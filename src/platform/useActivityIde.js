import { useEffect, useState } from "react";
import { loadActivityIdeSession } from "./activityIdeSession.js";

/**
 * Resuelve actividad + código inicial para el IDE (?actividad=uuid).
 * @param {{ activityId: string | null, user: object | null, supabase: import("@supabase/supabase-js").SupabaseClient | null, sessionLoading?: boolean }} opts
 */
export function useActivityIde({ activityId, user, supabase, sessionLoading = false, launchCode = "" }) {
  const [activity, setActivity] = useState(null);
  const [initialCode, setInitialCode] = useState(null);
  const [loading, setLoading] = useState(!!activityId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activityId || !supabase) {
      setActivity(null);
      setInitialCode(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (sessionLoading) {
      setLoading(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const userId = user && !user._legacy ? user.id : null;

    void loadActivityIdeSession(supabase, activityId, userId, launchCode).then((r) => {
      if (cancelled) return;
      setActivity(r.activity);
      setInitialCode(r.code);
      setError(r.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activityId, supabase, sessionLoading, launchCode, user?.id, user?._legacy]);

  return { activity, initialCode, loading, error };
}
