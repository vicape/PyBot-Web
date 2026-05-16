import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient.js";

function safeInternalNext(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.startsWith("/") && !t.startsWith("//") ? t : null;
}

/** Supabase OAuth redirige acá con tokens en URL; detectSessionInUrl los guarda antes del paint. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const sb = getSupabase();
    let stored = null;
    try {
      stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("pybot_oauth_next") : null;
      sessionStorage.removeItem("pybot_oauth_next");
    } catch {
      //
    }
    const fallback = "/dashboard";

    if (!sb) {
      navigate("/login", { replace: true });
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      const nextPath = safeInternalNext(stored);
      navigate(data.session ? nextPath ?? fallback : "/login", { replace: true });
    });
  }, [navigate]);

  return (
    <main className="auth-root">
      <p className="auth-card__muted">Finalizando inicio de sesión…</p>
    </main>
  );
}
