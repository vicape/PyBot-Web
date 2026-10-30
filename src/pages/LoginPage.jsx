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

import { EntryFeatureIcon } from "../components/entry/EntryFeatureIcons.jsx";
import "../styles/dashboard-theme.css";
import "../styles/entry-gate.css";
import "../styles/login-v2.css";
import "../styles/login-glass.css";

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
    <main
      className="auth-root entry-root dash-root entry-v2"
      lang={lang}
      data-pbc-theme={resolvedTheme}
      data-pbc-theme-pref={appearance.theme}
    >
      <div className="entry-v2__circuits" aria-hidden="true">
        <svg className="entry-v2__circuit-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="currentColor" strokeWidth="1.25">
            <path d="M-10 92H150V176H292" />
            <path d="M86-8V92H214" />
            <path d="M292 176V268H430" />
            <path d="M430 268H548V168" />
            <path d="M1168 36H1316V148H1470" />
            <path d="M1316 148V286" />
            <path d="M1470 286H1364V372" />
            <path d="M28 792H188V700H332" />
            <path d="M188 700V612H304" />
            <path d="M1088 868V772H1244V688H1460" />
            <path d="M980 848H1104V760" />
          </g>
          <g className="entry-v2__circuit-magenta" fill="none" strokeWidth="1.25">
            <path d="M548 168H668V96" />
            <path d="M332 700H456V784" />
            <path d="M1364 372H1248V456" />
            <path d="M760 880V804H880" />
          </g>
          <g className="entry-v2__circuit-nodes">
            <circle cx="292" cy="176" r="3.2" />
            <circle cx="430" cy="268" r="3.2" />
            <circle cx="1316" cy="148" r="3.2" />
            <circle cx="188" cy="700" r="3.2" />
            <circle cx="1244" cy="688" r="3" />
            <circle cx="668" cy="96" r="3" className="entry-v2__circuit-node-magenta" />
            <circle cx="456" cy="784" r="3" className="entry-v2__circuit-node-magenta" />
          </g>
        </svg>
      </div>
      <a className="entry-skip" href="#entry-main">
        {t("entrySkipToMain")}
      </a>
      <div className="entry-shell">
        <header className="entry-top">
          <a
            className="entry-top__brand"
            href="#entry-main"
            aria-label={t("entryBrand")}
          >
            <img
              src="/branding/pybot-logo-full.svg"
              alt={t("entryBrand")}
              className="entry-top__logo"
              width={168}
              height={66}
              decoding="async"
            />
          </a>
          <div className="entry-top__pyclass" aria-label="PyClass">
            <img
              src="/branding/pyclass-logo-secondary.svg"
              alt="PyClass"
              width={150}
              height={48}
              decoding="async"
            />
          </div>
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

        <section id="entry-main" className="glass-login" aria-label="PyClass login">
          <div className="glass-login__subjects">
            <div className="glass-login__tutor">
              <div className="glass-login__avatar" aria-hidden="true">✦</div>
              <p>¡Hola! ¿En qué materia trabajamos hoy?</p>
            </div>
            <div className="glass-login__course"><span aria-hidden="true">🐍</span><div><strong>Python Avanzado</strong><small>print("Hola, mundo") · funciones · proyectos</small></div></div>
            <div className="glass-login__course"><span aria-hidden="true">▣</span><div><strong>Robótica ESP32</strong><small>MicroPython | ESP32-WROOM-32U</small></div></div>
            <div className="glass-login__course"><span aria-hidden="true">▤</span><div><strong>Historia y otras materias</strong><small>Explorá contenidos y actividades</small></div></div>
            <p className="glass-login__demo-note">Vista previa de materias · Próximamente</p>
          </div>
          <div className="glass-login__auth">
            <img src="/branding/pyclass-logo-secondary.svg" alt="PyClass" className="glass-login__logo" />
            <h1 id="entry-title">Iniciar sesión</h1>
            <p className="glass-login__hint">Accedé con tu cuenta de Google</p>
            <div className="glass-login__field"><label htmlFor="glass-email">Email <span>· Próximamente</span></label><input id="glass-email" type="email" placeholder="ejemplo@correo.com" disabled autoComplete="off" /></div>
            <div className="glass-login__field glass-login__field--purple"><label htmlFor="glass-password">Contraseña <span>· Próximamente</span></label><input id="glass-password" type="password" placeholder="••••••••" disabled autoComplete="off" /></div>
            <button className="glass-login__enter" type="button" disabled title="Próximamente">Entrar · Próximamente</button>
            <div className="glass-login__links"><span>Olvidé mi contraseña</span><span>Crear cuenta</span></div>
            <div className="glass-login__google">
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
                  <button type="button" className="entry-google-btn" disabled>
                    <span className="entry-google-btn__icon">
                      <GoogleMark />
                    </span>
                    <span className="entry-google-btn__label">{t("entryGoogleDisabled")}</span>
                  </button>
                ) : null}


                {existing && !supabaseConfigured ? (
                  <Link to="/dashboard/classes" className="entry-link entry-link--primary">
                    {t("entryDashboardLink")}
                  </Link>
                ) : null}

            </div>
            <div className="glass-login__ide"></div>
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
                  <span className="entry-feature__icon" aria-hidden="true">
                    <EntryFeatureIcon id={feat.key} />
                  </span>
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
