import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient.js";
import { ensureProfileForUser } from "../platform/ensureProfile.js";
import { updatePreferredRole, saveGoogleTokens } from "../platform/profileApi.js";
import { consumeSignupRole } from "../platform/signupRole.js";
import { wasClassroomOAuthIntent } from "../platform/googleOAuth.js";

function safeInternalNext(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.startsWith("/") && !t.startsWith("//") ? t : null;
}

/** Lee ?error y ?error_description de la URL actual. */
function getUrlError() {
  const params = new URLSearchParams(window.location.search);
  const err = params.get("error") || params.get("error_code");
  const desc = params.get("error_description");
  return err ? { code: err, description: desc } : null;
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const finished = useRef(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    // Si Supabase/Google devolvieron un error en la URL, mostrarlo inmediatamente
    const urlError = getUrlError();
    if (urlError) {
      setErrorMsg(
        urlError.description
          ? decodeURIComponent(urlError.description.replace(/\+/g, " "))
          : `Error: ${urlError.code}`,
      );
      return;
    }

    const sb = getSupabase();
    if (!sb) {
      // Las variables de entorno Supabase no están disponibles en este build
      setErrorMsg(
        "El proyecto Supabase no está configurado en este entorno. " +
          "Verificá las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel.",
      );
      return;
    }

    let storedNext = null;
    try {
      storedNext = sessionStorage.getItem("pybot_oauth_next");
      sessionStorage.removeItem("pybot_oauth_next");
    } catch {
      //
    }

    const go = async (session) => {
      if (finished.current) return;
      if (!session?.user) return;
      finished.current = true;

      const signupRole = consumeSignupRole();
      const isClassroomIntent = wasClassroomOAuthIntent();
      try {
        await ensureProfileForUser(session.user, signupRole);
        if (signupRole) await updatePreferredRole(session.user.id, signupRole);
        // Guardar refresh_token de Google para renovar el token de Classroom automáticamente
        if (isClassroomIntent && session.provider_refresh_token) {
          await saveGoogleTokens(session.user.id, {
            accessToken: session.provider_token,
            refreshToken: session.provider_refresh_token,
            expiresIn: 3600,
          });
        }
      } catch {
        // No bloquear la navegación si falla la sincronización del perfil
      }

      const explicit = safeInternalNext(storedNext);
      navigate(explicit ?? "/dashboard", { replace: true });
    };

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (session) void go(session);
      }
    });

    // getSession por si la sesión ya estaba lista antes de montar el componente
    sb.auth.getSession().then(({ data }) => {
      if (data.session) void go(data.session);
    });

    // Si después de 8s todavía no hay sesión, mostrar error en pantalla (NO redirigir)
    const timeout = window.setTimeout(async () => {
      if (finished.current) return;
      const { data } = await sb.auth.getSession();
      if (data.session) {
        void go(data.session);
      } else {
        finished.current = true;
        setErrorMsg(
          "No se pudo completar el inicio de sesión. " +
            "Verificá que el proveedor Google esté activo en Supabase y que la URL de redirección sea " +
            `${window.location.origin}/auth/callback`,
        );
      }
    }, 8000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate]);

  if (errorMsg) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Error al iniciar sesión</h1>
          <p className="auth-card__notice auth-card__notice--err">{errorMsg}</p>
          <div className="auth-card__actions">
            <a href="/login" className="auth-btn auth-btn--primary">
              Volver al login
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card">
        <p className="auth-card__muted">Finalizando inicio de sesión…</p>
      </div>
    </main>
  );
}
