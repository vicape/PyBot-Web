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
import "../styles/dashboard-theme.css";
import "../styles/entry-gate.css";

function IdeMark({ size = 22 }) {
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

  const leadText = supabaseConfigured
    ? t("entryLeadSupabase")
    : hasClientId
      ? t("entryLeadGis")
      : t("entryLeadStub");

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
    <main
      className="auth-root entry-root dash-root"
      lang={lang}
      data-pbc-theme={resolvedTheme}
      data-pbc-theme-pref={appearance.theme}
    >
      <div className="entry-shell">
        <header className="entry-top">
          <div className="entry-top__controls">
            <label className="entry-lang">
              <span className="entry-lang__label">{t("entryLanguage")}</span>
              <select
                className="entry-lang__select"
                value={lang}
                onChange={(e) => onLangChange(e.target.value)}
                aria-label={t("entryLanguage")}
              >
                {SUPPORTED_LANGS.map((code) => (
                  <option key={code} value={code}>
                    {LANG_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="entry-theme-btn"
              onClick={toggleTheme}
              aria-label={`${t("entryTheme")}: ${themeLabel}`}
              title={themeLabel}
            >
              <span className="entry-theme-btn__icon" aria-hidden="true">
                {resolvedTheme === "dark" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M12 2v2.2M12 19.8V22M4.2 12H2M22 12h-2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M19 13.5A7.5 7.5 0 1 1 10.5 5 6 6 0 0 0 19 13.5Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className="entry-theme-btn__text">{themeLabel}</span>
            </button>
          </div>
        </header>

        <section id="entry-main" className="entry-hero" aria-labelledby="entry-title">
          <div className="entry-hero__copy">
            <div className="entry-brand">
              <div className="entry-brand__mark">
                <img
                  src="/branding/pybot-logo-full.svg"
                  alt={t("entryBrand")}
                  className="entry-brand__logo"
                  width={220}
                  height={86}
                  decoding="async"
                />
              </div>
              <p className="entry-brand__tagline">{t("entryTagline")}</p>
            </div>

            <h1 id="entry-title" className="entry-title">
              <span className="entry-title__line">{t("entryTitleLine1")}</span>
              <span className="entry-title__line">{t("entryTitleLine2")}</span>
              <span className="entry-title__line entry-title__line--accent">
                {t("entryTitleLine3")}
              </span>
            </h1>

            <p className="entry-lead">{t("entryLead")}</p>
            <p className="entry-lead entry-lead--secondary">{leadText}</p>
            <p className="entry-journey">{t("entryJourney")}</p>

            {existing && !supabaseConfigured ? (
              <p className="entry-notice" role="status">
                {t("entrySessionNotice")}
              </p>
            ) : null}

            <div className="entry-actions">
              {supabaseConfigured ? (
                <button
                  type="button"
                  className="entry-google-btn"
                  onClick={oauthSupabaseGoogle}
                  disabled={oauthBusy}
                  aria-busy={oauthBusy ? "true" : "false"}
                >
                  <span className="entry-google-btn__icon">
                    <GoogleMark />
                  </span>
                  <span className="entry-google-btn__label">
                    {oauthBusy ? t("entryGoogleLoading") : googleLabel}
                  </span>
                </button>
              ) : null}

              {showGIS ? (
                <div className="entry-google-wrap auth-google-wrap">
                  <GoogleLogin
                    onSuccess={(res) => {
                      const cred = res.credential;
                      if (cred && saveGoogleProfile(cred)) {
                        navigate("/dashboard/classes", { replace: true });
                      }
                    }}
                    onError={() => {}}
                    theme="outline"
                    size="large"
                    text="continue_with"
                    shape="rectangular"
                    width={360}
                  />
                </div>
              ) : null}

              {showStub ? (
                <>
                  <p className="entry-stub-hint">{t("entryStubHint")}</p>
                  <button type="button" className="entry-google-btn" disabled>
                    <span className="entry-google-btn__icon">
                      <GoogleMark />
                    </span>
                    <span className="entry-google-btn__label">{t("entryGoogleDisabled")}</span>
                  </button>
                </>
              ) : null}

              {existing && !supabaseConfigured ? (
                <Link to="/dashboard/classes" className="entry-link entry-link--primary">
                  {t("entryDashboardLink")}
                </Link>
              ) : null}

              <Link to="/" className="entry-ide-btn">
                <span className="entry-ide-btn__icon" aria-hidden="true">
                  <IdeMark />
                </span>
                <span className="entry-ide-btn__label">{t("entryIdeLink")}</span>
              </Link>
            </div>

            <ul className="entry-trust" aria-label={t("entryLead")}>
              <li>{t("entryTrustGoogle")}</li>
              <li>{t("entryTrustGuest")}</li>
              <li>{t("entryTrustStack")}</li>
            </ul>

            {supabaseConfigured ? (
              <p className="entry-hint">{t("entryClassroomHint")}</p>
            ) : null}
          </div>

          <div className="entry-hero__visual">
            <EntryProductVisual labels={visualLabels} />
          </div>
        </section>

        <section className="entry-features" aria-labelledby="entry-features-title">
          <h2 id="entry-features-title" className="entry-features__title">
            {t("entryFeaturesLabel")}
          </h2>
          <ul className="entry-features__grid">
            {FEATURES.map((feat) => (
              <li key={feat.key} className={`entry-feature entry-feature--${feat.tone}`}>
                <span className="entry-feature__icon" aria-hidden="true">
                  {feat.key === "python" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M8 3h6a3 3 0 0 1 3 3v3H9a2 2 0 0 0-2 2v2H5V6a3 3 0 0 1 3-3Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      />
                      <path
                        d="M16 21H10a3 3 0 0 1-3-3v-3h8a2 2 0 0 0 2-2v-2h2v5a3 3 0 0 1-3 3Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      />
                    </svg>
                  ) : null}
                  {feat.key === "blocks" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="4" width="10" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
                      <rect x="11" y="10" width="10" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
                      <rect x="5" y="16" width="10" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
                    </svg>
                  ) : null}
                  {feat.key === "hardware" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M8 10h3M8 14h5M15 10h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  ) : null}
                  {feat.key === "classes" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4 19V7l8-3 8 3v12l-8 3-8-3Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                      <path d="M12 9v10" stroke="currentColor" strokeWidth="1.7" />
                    </svg>
                  ) : null}
                  {feat.key === "projects" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M5 16 12 5l7 11H5Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="14" r="1.4" fill="currentColor" />
                    </svg>
                  ) : null}
                </span>
                <div className="entry-feature__text">
                  <h3 className="entry-feature__name">{t(feat.title)}</h3>
                  <p className="entry-feature__desc">{t(feat.desc)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
