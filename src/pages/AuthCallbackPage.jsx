import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient.js";
import { ensureProfileForUser } from "../platform/ensureProfile.js";
import {
  clearClassroomTokenCache,
  primeClassroomAccessToken,
} from "../platform/classroomToken.js";
import {
  updatePreferredRole,
  saveGoogleTokens,
  saveStudentGoogleTokens,
  markClassroomLinked,
  markStudentClassroomLinked,
} from "../platform/profileApi.js";
import { consumeSignupRole } from "../platform/signupRole.js";
import {
  wasClassroomOAuthIntent,
  consumeClassroomOAuthMode,
  peekClassroomOAuthExpected,
  clearClassroomOAuthExpected,
  clearPendingClassroomTurnIn,
} from "../platform/googleOAuth.js";

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
      const expected = peekClassroomOAuthExpected();
      const classroomMode = isClassroomIntent ? consumeClassroomOAuthMode() : "teacher";

      try {
        await ensureProfileForUser(session.user, signupRole);
        if (signupRole) await updatePreferredRole(session.user.id, signupRole);

        if (isClassroomIntent) {
          const expectedId = expected.userId;
          const sessionEmail = String(session.user.email || "").toLowerCase();
          const expectedEmail = expected.email ? String(expected.email).toLowerCase() : null;

          const idMismatch = expectedId && expectedId !== session.user.id;
          const emailMismatch =
            !idMismatch && expectedEmail && sessionEmail && expectedEmail !== sessionEmail;

          if (idMismatch || emailMismatch) {
            clearClassroomTokenCache();
            clearPendingClassroomTurnIn();
            clearClassroomOAuthExpected();
            setErrorMsg(
              "Conectaste una cuenta Google diferente de la cuenta con la que ingresaste a PyBotClass.",
            );
            return;
          }

          const expiresIn = 3600;
          if (session.provider_token) {
            primeClassroomAccessToken(
              session.user.id,
              classroomMode,
              session.provider_token,
              expiresIn,
            );
          }

          if (classroomMode === "student") {
            if (session.provider_refresh_token) {
              await saveStudentGoogleTokens(session.user.id, {
                refreshToken: session.provider_refresh_token,
                expiresIn,
              });
              await markStudentClassroomLinked(session.user.id);
            }
          } else if (session.provider_refresh_token || session.provider_token) {
            clearClassroomTokenCache(session.user.id, "teacher");
            if (session.provider_token) {
              primeClassroomAccessToken(
                session.user.id,
                "teacher",
                session.provider_token,
                expiresIn,
              );
            }
            await saveGoogleTokens(session.user.id, {
              refreshToken: session.provider_refresh_token,
              expiresIn,
            });
            if (session.provider_refresh_token) {
              await markClassroomLinked(session.user.id);
            }
          }

          clearClassroomOAuthExpected();
        }
      } catch {
        // No bloquear la navegación si falla la sincronización del perfil
      }

      const explicit = safeInternalNext(storedNext);
      navigate(explicit ?? "/dashboard/classes", { replace: true });
    };

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (session) void go(session);
      }
    });

    sb.auth.getSession().then(({ data }) => {
      if (data.session) void go(data.session);
    });

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
