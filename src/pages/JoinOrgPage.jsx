import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { t } from "../i18n.js";
import JoinCourseForm from "../components/pybotclass/layout/JoinCourseForm.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { useJoinCourse } from "../components/pybotclass/layout/useJoinCourse.js";
import {
  applyAppearanceToElement,
  loadAppearanceFromStorage,
  normalizeAppearance,
} from "../platform/appearanceApi.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

import "../styles/dashboard-theme.css";
import "../styles/pybotclass-dashboard.css";

/** Shell mínimo pbc-* para flujo de invitación sin sesión (sin forzar login). */
function JoinGuestShell({ children }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const appearance =
      loadAppearanceFromStorage("anon") ?? normalizeAppearance({ theme: "system" });
    applyAppearanceToElement(el, appearance);

    if (appearance.theme !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearanceToElement(el, appearance);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="pbc-dashboard" ref={containerRef} data-pybot-theme="pbc">
      <div className="pbc-dashboard__main">
        <div className="pbc-dashboard__content">{children}</div>
      </div>
    </div>
  );
}

/**
 * Adaptador de ruta /join (y /join?code=): auth, shell y prefill.
 * Canje/UI canónicos: useJoinCourse + JoinCourseForm (+ redeemJoinInvite).
 */
export default function JoinOrgPage() {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const onNeedLogin = useCallback(
    (trimmed) => {
      const next = `/join?code=${encodeURIComponent(trimmed)}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: false });
    },
    [navigate],
  );

  const { code, setCode, busy, msg, err, submit } = useJoinCourse({
    supabase: isSupabaseConfigured() ? supabase : null,
    initialCode: searchParams.get("code") ?? "",
    requireSession: true,
    navigateReplace: true,
    successDelayMs: 900,
    onNeedLogin,
  });

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c);
  }, [searchParams, setCode]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setAuthReady(true);
      return undefined;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data?.session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const form = (
    <div className="pbc-join-page">
      <div className="pbc-modal" role="dialog" aria-labelledby="join-org-title">
        <JoinCourseForm
          code={code}
          onCodeChange={setCode}
          busy={busy}
          err={err}
          msg={msg}
          onSubmit={submit}
          showCancel={false}
          inputId="invite-code"
          titleId="join-org-title"
          autoFocus
        />
      </div>
      <div style={{ marginTop: "1rem" }}>
        <Link to="/dashboard/classes" className="pbc-btn pbc-btn--ghost">
          {t("pcMyCourses")}
        </Link>
      </div>
    </div>
  );

  if (!authReady) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando…</p>
      </main>
    );
  }

  if (user) {
    return (
      <PyBotClassLayout user={user} hideSearch onSignOut={() => void signOut()}>
        {form}
      </PyBotClassLayout>
    );
  }

  return <JoinGuestShell>{form}</JoinGuestShell>;
}
