import { createClient } from "@supabase/supabase-js";

let singleton = null;

/**
 * Cliente Supabase (browser). Retorna null si faltan env.
 * Auth usa PKCE; detectSessionInUrl procesa hash tras OAuth.
 */
export function getSupabase() {
  const url =
    typeof import.meta.env.VITE_SUPABASE_URL === "string"
      ? import.meta.env.VITE_SUPABASE_URL.trim()
      : "";
  const key =
    typeof import.meta.env.VITE_SUPABASE_ANON_KEY === "string"
      ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim()
      : "";
  if (!url || !key) return null;
  if (!singleton) {
    singleton = createClient(url, key, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return singleton;
}

export function isSupabaseConfigured() {
  return getSupabase() !== null;
}
