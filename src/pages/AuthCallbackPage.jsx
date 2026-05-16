import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient";

/** Supabase OAuth redirige acá con tokens en URL; detectSessionInUrl los guarda antes del paint. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      navigate("/login", { replace: true });
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      navigate(data.session ? "/dashboard" : "/login", { replace: true });
    });
  }, [navigate]);

  return (
    <main className="auth-root">
      <p className="auth-card__muted">Finalizando inicio de sesión…</p>
    </main>
  );
}
