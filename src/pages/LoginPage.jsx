import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { baseLoginOAuthOptions } from "../platform/googleOAuth.js";
import {
  loadAppearanceFromStorage,
  saveAppearanceToStorage,
  resolveTheme,
  normalizeAppearance,
} from "../platform/appearanceApi.js";
import { t, getLang, setLang, SUPPORTED_LANGS, LANG_LABELS } from "../i18n.js";
import GoogleMark from "../components/GoogleMark.jsx";
import EntryProductVisual from "../components/entry/EntryProductVisual.jsx";
import { EntryFeatureIcon } from "../components/entry/EntryFeatureIcons.jsx";
import "../styles/dashboard-theme.css";
import "../styles/entry-gate.css";
import "../styles/pyclass-login-neon.css";

function IdeMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M9 8 5.5 13 9 18"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 8 20.5 13 17 18"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 7 11.5 19" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

const ANON_APPEARANCE_ID = "anon";

const FEATURES = [
  { key: "python", tone: "python", title: "entryFeatPythonTitle", desc: "entryFeatPythonDesc" },
  { key: "blocks", tone: "blocks", title: "entryFeatBlocksTitle", desc: "entryFeatBlocksDesc" },
  { key: "hardware", tone: "hardware", title: "entryFeatHardwareTitle", desc: "entryFeatHardwareDesc" },
  { key: "classes", tone: "classes", title: "entryFeatClassesTitle", desc: "entryFeatClassesDesc" },
  { key: "projects", tone: "projects", title: "entryFeatProjectsTitle", desc: "entryFeatProjectsDesc" },
];

const LANG_SHORT = {
  es: "ES",
  en: "EN",
  fr: "FR",
  pt: "PT",
  de: "DE",
};

function readEntryAppearance() {
  return (
    loadAppearanceFromStorage(ANON_APPEARANCE_ID) ??
    normalizeAppearance({ theme: "system" })
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();
  const supabaseConfigured = isSupabaseConfigured();
  const [lang, setLangState] = useState(() => getLang());
  const [oauthBusy, setOauthBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [demoNoticeKey, setDemoNoticeKey] = useState("");
  const [appearance, setAppearance] = useState(() => readEntryAppearance());
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    resolveTheme(readEntryAppearance().theme),
  );

  useEffect(() => {
    if (!supabaseConfigured) return;
    const sb = getSupabase();
    if (!sb) return;

    let cancelled = false;
    sb.auth.getSession().then(({ data }) => {
      if (cancelled || !data?.session?.user) return;
      const next = new URLSearchParams(window.location.search).get("next");
      const dest =
        typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard/classes";
      navigate(dest, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseConfigured, navigate]);

  useEffect(() => {
    const sync = () => setResolvedTheme(resolveTheme(appearance.theme));
    sync();
    if (appearance.theme !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [appearance.theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const onLangChange = (next) => {
    const saved = setLang(next);
    setLangState(saved);
  };

  const toggleTheme = () => {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    const next = normalizeAppearance({ ...appearance, theme: nextTheme });
    setAppearance(next);
    saveAppearanceToStorage(ANON_APPEARANCE_ID, next);
    setResolvedTheme(nextTheme);
  };

  const oauthSupabaseGoogle = async () => {
    const sb = getSupabase();
    if (!sb || oauthBusy) return;

    setOauthBusy(true);
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
        sessionStorage.setItem("pybot_oauth_next", next);
      } else {
        sessionStorage.removeItem("pybot_oauth_next");
      }
    } catch {
      //
    }

    const redirectTo = `${window.location.origin}/auth/callback`;
    try {
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: baseLoginOAuthOptions(redirectTo),
      });
    } catch {
      setOauthBusy(false);
    }
  };

  const showGIS = !supabaseConfigured && hasClientId;
  const showStub = !supabaseConfigured && !hasClientId;

  const googleLabel = supabaseConfigured ? t("entryGoogleContinue") : t("entryGoogleSignIn");

  const visualLabels = useMemo(
    () => ({
      ide: t("entryVisualIde"),
      python: t("entryVisualPython"),
      blocks: t("entryVisualBlocks"),
      hardware: t("entryVisualHardware"),
      codeLabel: t("entryVisualCodeLabel"),
    }),
    [lang],
  );

  const themeLabel =
    resolvedTheme === "dark" ? t("entryThemeLight") : t("entryThemeDark");

  return (
    <main className="auth-root entry-root dash-root pyclass-preview" lang={lang} data-pbc-theme="dark">
      <a className="entry-skip" href="#entry-main">{t("entrySkipToMain")}</a>
      <div className="pc-stage">
        <header className="pc-top">
          <Link to="/" className="pc-top-brand" aria-label="PyBot">
            <img src="/branding/pybot-logo-full.svg" alt="PyBot" />
          </Link>
          <div className="pc-top-tools">
            <label className="sr-only" htmlFor="pc-language">{t("entryLanguage")}</label>
            <select id="pc-language" value={lang} onChange={(e) => onLangChange(e.target.value)} aria-label={t("entryLanguage")}>
              {SUPPORTED_LANGS.map((code) => <option key={code} value={code}>{LANG_SHORT[code] || LANG_LABELS[code]}</option>)}
            </select>
          </div>
        </header>
        <section className="pc-layout" id="entry-main" aria-label="PyClass">
          <div className="pc-discovery">
            <div className="pc-assistant">
              <div className="pc-avatar" aria-hidden="true">
                <svg viewBox="0 0 80 80" role="presentation" focusable="false">
                  <defs>
                    <linearGradient id="pyclassPGrad" x1="18" y1="10" x2="68" y2="70" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#22d3ee" />
                      <stop offset="100%" stopColor="#f472b6" />
                    </linearGradient>
                    <filter id="pyclassPGlow" x="-45%" y="-45%" width="190%" height="190%">
                      <feGaussianBlur stdDeviation="2.1" />
                    </filter>
                  </defs>
                  <path d="M25 66V18C25 14 29 14 34 14H42C58 14 66 22 66 36C66 50 58 58 42 58H34" fill="none" stroke="url(#pyclassPGrad)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" filter="url(#pyclassPGlow)" opacity="0.95" />
                  <path d="M25 66V18C25 14 29 14 34 14H42C58 14 66 22 66 36C66 50 58 58 42 58H34" fill="none" stroke="url(#pyclassPGrad)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M47 29.5 48.15 34.15 53 35.4 48.15 36.65 47 41.3 45.85 36.65 41 35.4 45.85 34.15Z" fill="url(#pyclassPGrad)" filter="url(#pyclassPGlow)" />
                  <path d="M47 29.5 48.15 34.15 53 35.4 48.15 36.65 47 41.3 45.85 36.65 41 35.4 45.85 34.15Z" fill="url(#pyclassPGrad)" />
                </svg>
              </div>
              <div className="pc-speech">
                
                <p>{t("pcLoginGreeting")}</p>
              </div>
            </div>
            <div className="pc-courses" aria-label={t("pcLoginCoursesLabel")}>
              <div className="pc-course">
                <span className="pc-course-icon pc-course-icon--python" aria-hidden="true">Py</span>
                <span><strong>{t("pcLoginCoursePythonTitle")}</strong><small>{t("pcLoginCoursePythonMeta")}</small></span>
              </div>
              <div className="pc-course">
                <span className="pc-course-icon pc-course-icon--esp" aria-hidden="true">▣</span>
                <span><strong>{t("pcLoginCourseRobotTitle")}</strong><small>{t("pcLoginCourseRobotMeta")}</small></span>
              </div>
              <div className="pc-course">
                <span className="pc-course-icon pc-course-icon--history" aria-hidden="true">▤</span>
                <span><strong>{t("pcLoginCourseHistoryTitle")}</strong><small>{t("pcLoginCourseHistoryMeta")}</small></span>
              </div>
            </div>
            
          </div>
          <div className="pc-login">
            <div className="pc-login-brand">
              <img src="/branding/pyclass-logo-secondary.svg" alt="PyClass" />
            </div>
            <h1>{t("pcLoginHeading")}</h1>
            
            <form className="pc-demo-form" onSubmit={(e) => { e.preventDefault(); setDemoNoticeKey("pcLoginDemoEmail"); }}>
              <label htmlFor="pc-email">{t("pcLoginEmail")}</label>
              <input id="pc-email" type="email" placeholder={t("pcLoginEmailPlaceholder")} autoComplete="email" required />
              <label htmlFor="pc-password">{t("pcLoginPassword")}</label>
              <div className="pc-password-wrap">
                <input id="pc-password" type={showPassword ? "text" : "password"} placeholder={t("pcLoginPasswordPlaceholder")} autoComplete="current-password" required minLength={6} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t("pcLoginHidePassword") : t("pcLoginShowPassword")}>{showPassword ? t("pcLoginHide") : t("pcLoginShow")}</button>
              </div>
              <button className="pc-submit" type="submit">{t("pcLoginSubmit")}</button>
              <div className="pc-links">
                <button type="button" onClick={() => setDemoNoticeKey("pcLoginDemoForgot")}>{t("pcLoginForgot")}</button>
                <button type="button" onClick={() => setDemoNoticeKey("pcLoginDemoCreate")}>{t("pcLoginCreate")}</button>
              </div>
            </form>
            {demoNoticeKey && <p className="pc-demo-notice" role="status">{t(demoNoticeKey)}</p>}
            
            <div className="pc-google">
              {supabaseConfigured ? (
                <button type="button" className="pc-google-button" onClick={oauthSupabaseGoogle} disabled={oauthBusy} aria-busy={oauthBusy ? "true" : "false"}>
                  <GoogleMark /><span>{oauthBusy ? t("entryGoogleLoading") : t("pcLoginGoogleClassroom")}</span>
                </button>
              ) : showGIS ? (
                <div className="pc-google-gis"><GoogleLogin
                  onSuccess={(res) => { const cred = res.credential; if (cred && saveGoogleProfile(cred)) navigate("/dashboard/classes", { replace: true }); }}
                  onError={() => {}} theme="outline" size="large" text="continue_with" shape="rectangular" width={280}
                /></div>
              ) : (
                <button type="button" className="pc-google-button" disabled><GoogleMark /><span>{t("entryGoogleDisabled")}</span></button>
              )}
              {existing && !supabaseConfigured && <Link className="pc-existing" to="/dashboard/classes">{t("entryDashboardLink")}</Link>}
            </div>
            <p className="pc-demo-caption">{t("pcLoginPreviewCaption")}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
