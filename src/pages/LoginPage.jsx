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
          <a className="entry-top__brand" href="#entry-main">
            <img
              src="/branding/pybot-logo-full.svg"
              alt={t("entryBrand")}
              className="entry-top__logo"
              width={168}
              height={66}
              decoding="async"
            />
          </a>
          <div className="entry-top__controls">
            <label className="entry-lang">
              <span className="sr-only">{t("entryLanguage")}</span>
              <select
                className="entry-lang__select"
                value={lang}
                onChange={(e) => onLangChange(e.target.value)}
                aria-label={t("entryLanguage")}
              >
                {SUPPORTED_LANGS.map((code) => (
                  <option key={code} value={code}>
                    {LANG_SHORT[code] || LANG_LABELS[code]}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M12 2v2.2M12 19.8V22M4.2 12H2M22 12h-2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M19 13.5A7.5 7.5 0 1 1 10.5 5 6 6 0 0 0 19 13.5Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </header>

        <section id="entry-main" className="entry-hero" aria-labelledby="entry-title">
          <div className="entry-hero__copy">
            <p className="entry-eyebrow">{t("entryTagline")}</p>

            <h1 id="entry-title" className="entry-title">
              <span className="entry-title__pair">
                <span className="entry-title__line">{t("entryTitleLine1")}</span>{" "}
                <span className="entry-title__line">{t("entryTitleLine2")}</span>
              </span>
              <span className="entry-title__line entry-title__line--accent">
                {t("entryTitleLine3")}
              </span>
            </h1>

            <p className="entry-lead">{t("entryLead")}</p>

            {existing && !supabaseConfigured ? (
              <p className="entry-notice" role="status">
                {t("entrySessionNotice")}
              </p>
            ) : null}

            <div className="entry-actions">
              <div className="entry-actions__primary">
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
                      width={320}
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
              </div>

              <Link to="/" className="entry-ide-btn">
                <span className="entry-ide-btn__icon" aria-hidden="true">
                  <IdeMark />
                </span>
                <span className="entry-ide-btn__label">{t("entryIdeLink")}</span>
              </Link>
            </div>
          </div>

          <div className="entry-hero__visual">
            <EntryProductVisual labels={visualLabels} />
          </div>
        </section>

        <section className="entry-features" aria-labelledby="entry-features-title">
          <h2 id="entry-features-title" className="entry-features__title">
            {t("entryFeaturesLabel")}
          </h2>
          <ul className="entry-features__rail">
            {FEATURES.map((feat) => {
              const isCore =
                feat.key === "python" || feat.key === "blocks" || feat.key === "hardware";
              return (
                <li
                  key={feat.key}
                  className={`entry-feature entry-feature--${feat.tone} ${
                    isCore ? "entry-feature--core" : "entry-feature--extended"
                  }`}
                >
                  <span className="entry-feature__accent" aria-hidden="true" />
                  <span className="entry-feature__name">{t(feat.title)}</span>
                  <span className="entry-feature__desc">{t(feat.desc)}</span>
                  {feat.key === "classes" && supabaseConfigured ? (
                    <span className="entry-feature__note">{t("entryClassroomHint")}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
