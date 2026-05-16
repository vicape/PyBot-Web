import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient.js";
import { ensureProfileForUser } from "../platform/ensureProfile.js";
import { updatePreferredRole } from "../platform/profileApi.js";
import { consumeSignupRole, SIGNUP_ROLES } from "../platform/signupRole.js";

function safeInternalNext(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.startsWith("/") && !t.startsWith("//") ? t : null;
}

function defaultPathForRole(role) {
  if (role === SIGNUP_ROLES.student) return "/join";
  return "/dashboard";
}

/** Supabase OAuth redirige acá; detectSessionInUrl + PKCE completan la sesión. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const finished = useRef(false);

  useEffect(() => {
    const sb = getSupabase();
    let storedNext = null;
    try {
      storedNext = sessionStorage.getItem("pybot_oauth_next");
      sessionStorage.removeItem("pybot_oauth_next");
    } catch {
      //
    }

    if (!sb) {
      navigate("/login", { replace: true });
      return;
    }

    const go = async (session) => {
      if (finished.current) return;
      if (!session?.user) return;

      finished.current = true;

      const signupRole = consumeSignupRole();
      await ensureProfileForUser(session.user, signupRole);
      if (signupRole) {
        await updatePreferredRole(session.user.id, signupRole);
      }

      const explicit = safeInternalNext(storedNext);
      navigate(explicit ?? defaultPathForRole(signupRole), { replace: true });
    };

    const fail = () => {
      if (finished.current) return;
      finished.current = true;
      navigate("/login", { replace: true });
    };

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (session) void go(session);
      }
    });

    sb.auth.getSession().then(({ data }) => {
      if (data.session) void go(data.session);
    });

    const timeout = window.setTimeout(() => {
      sb.auth.getSession().then(({ data }) => {
        if (data.session) void go(data.session);
        else fail();
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <main className="auth-root">
      <p className="auth-card__muted">Finalizando inicio de sesión…</p>
    </main>
  );
}
