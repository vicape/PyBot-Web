import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../supabaseClient.js";
import {
  clearClassroomTokenCache,
  primeClassroomAccessToken,
} from "../platform/classroomToken.js";
import { confirmClassroomPersistence } from "../platform/confirmClassroomPersistence.js";
import {
  clearClassroomOAuthFlow,
  clearPendingClassroomTurnIn,
  exchangeClassroomAuthorizationCode,
  getClassroomRedirectUri,
  loadClassroomOAuthFlow,
  validateClassroomOAuthFlow,
} from "../platform/googleOAuth.js";

function safeInternalNext(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.startsWith("/") && !t.startsWith("//") ? t : null;
}

function getCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error") || params.get("error_code"),
    errorDescription: params.get("error_description"),
  };
}

/**
 * Callback OAuth dedicado a Google Classroom (no login Supabase).
 * No altera la sesión PyBot; solo autoriza Classroom.
 */
export default function ClassroomAuthCallbackPage() {
  const navigate = useNavigate();
  const finished = useRef(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [returnHref, setReturnHref] = useState("/dashboard/classes?panel=classroom");

  useEffect(() => {
    const run = async () => {
      if (finished.current) return;

      const { code, state, error, errorDescription } = getCallbackParams();
      const stored = loadClassroomOAuthFlow();
      const storedNext = safeInternalNext(stored?.nextPath);
      const defaultReturn = storedNext || "/dashboard/classes?panel=classroom";
      setReturnHref(defaultReturn);

      // state/TTL antes de confiar en error o code de Google
      const validated = validateClassroomOAuthFlow(stored, state);
      if (!validated.ok) {
        finished.current = true;
        clearClassroomOAuthFlow();
        if (validated.code === "flow_expired") {
          setErrorMsg("La autorización de Google Classroom expiró. Volvé a conectar.");
        } else {
          setErrorMsg("No se pudo conectar Google Classroom");
        }
        return;
      }

      if (error) {
        finished.current = true;
        clearClassroomOAuthFlow();
        setErrorMsg(
          errorDescription
            ? decodeURIComponent(String(errorDescription).replace(/\+/g, " "))
            : "No se pudo conectar Google Classroom",
        );
        return;
      }

      const flow = validated.flow;
      const mode = flow.mode === "student" ? "student" : "teacher";
      const next = safeInternalNext(flow.nextPath) || defaultReturn;

      const sb = getSupabase();
      if (!sb) {
        finished.current = true;
        clearClassroomOAuthFlow();
        setErrorMsg("No se pudo conectar Google Classroom");
        return;
      }

      const { data: sessData } = await sb.auth.getSession();
      const session = sessData?.session;
      const user = session?.user;
      if (!user?.id || !session?.access_token) {
        finished.current = true;
        clearClassroomOAuthFlow();
        setErrorMsg(
          "Tu sesión de PyBotClass no está activa. Volvé a entrar y conectá Classroom de nuevo.",
        );
        return;
      }

      if (user.id !== flow.initiatingPybotUserId) {
        finished.current = true;
        try {
          clearClassroomTokenCache(user.id, mode);
        } catch {
          /* ignore */
        }
        clearPendingClassroomTurnIn();
        clearClassroomOAuthFlow();
        setErrorMsg(
          "La sesión de PyBotClass cambió durante la autorización. Volvé a conectar Google Classroom.",
        );
        return;
      }

      if (!code) {
        finished.current = true;
        clearClassroomOAuthFlow();
        setErrorMsg("No se pudo conectar Google Classroom");
        return;
      }

      const redirectUri = getClassroomRedirectUri();
      const exchanged = await exchangeClassroomAuthorizationCode({
        code,
        redirectUri,
        accessToken: session.access_token,
      });

      if (!exchanged.ok) {
        finished.current = true;
        clearClassroomTokenCache(user.id, mode);
        clearPendingClassroomTurnIn();
        clearClassroomOAuthFlow();
        setErrorMsg("No se pudo conectar Google Classroom");
        return;
      }

      const refreshToken = exchanged.refresh_token
        ? String(exchanged.refresh_token).trim()
        : "";
      const expiresIn = Number(exchanged.expires_in) || 3600;

      if (!refreshToken) {
        finished.current = true;
        clearClassroomTokenCache(user.id, mode);
        clearPendingClassroomTurnIn();
        clearClassroomOAuthFlow();
        setErrorMsg(
          "Google no devolvió la autorización necesaria para mantener Classroom conectado. Volvé a conectar Classroom.",
        );
        return;
      }

      const persist = await confirmClassroomPersistence({
        userId: user.id,
        mode,
        refreshToken,
        expiresIn,
      });

      if (!persist.ok) {
        finished.current = true;
        clearClassroomTokenCache(user.id, mode);
        clearPendingClassroomTurnIn();
        clearClassroomOAuthFlow();
        setErrorMsg(
          persist.message || "No se pudo conectar Google Classroom",
        );
        return;
      }

      if (exchanged.access_token) {
        primeClassroomAccessToken(user.id, mode, exchanged.access_token, expiresIn);
      }

      clearClassroomOAuthFlow();
      finished.current = true;
      navigate(next, { replace: true });
    };

    void run().catch(() => {
      if (finished.current) return;
      finished.current = true;
      clearClassroomOAuthFlow();
      setErrorMsg("No se pudo conectar Google Classroom");
    });
  }, [navigate]);

  if (errorMsg) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">No se pudo conectar Google Classroom</h1>
          <p className="auth-card__notice auth-card__notice--err">{errorMsg}</p>
          <div className="auth-card__actions">
            <a href={returnHref} className="auth-btn auth-btn--primary">
              Volver a PyBotClass
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card">
        <p className="auth-card__muted">Conectando Google Classroom…</p>
      </div>
    </main>
  );
}
