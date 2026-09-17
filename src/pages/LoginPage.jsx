import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { baseLoginOAuthOptions } from "../platform/googleOAuth.js";
import { t, getLang, setLang, SUPPORTED_LANGS, LANG_LABELS } from "../i18n.js";
import GoogleMark from "../components/GoogleMark.jsx";
import "../styles/dashboard-theme.css";
import "../styles/entry-gate.css";

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

const CAPABILITIES = [
  { key: "entryCapPython", tone: "python" },
  { key: "entryCapBlocks", tone: "blocks" },
  { key: "entryCapHardware", tone: "hardware" },
  { key: "entryCapClasses", tone: "classes" },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();
  const supabaseConfigured = isSupabaseConfigured();
  const [lang, setLangState] = useState(() => getLang());
  const [oauthBusy, setOauthBusy] = useState(false);

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

  const onLangChange = (next) => {
    const saved = setLang(next);
    setLangState(saved);
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

  return (
    <main className="auth-root entry-root" lang={lang}>
      <div className="entry-shell">
        <header className="entry-top">
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
        </header>

        <section className="entry-card" aria-labelledby="entry-title">
          <div className="entry-brand">
            <div className="entry-brand__logo" aria-hidden="true">
              PB
            </div>
            <div className="entry-brand__text">
              <div className="entry-brand__name">{t("entryBrand")}</div>
              <div className="entry-brand__tagline">{t("entryTagline")}</div>
            </div>
          </div>

          <h1 id="entry-title" className="entry-title">
            {t("entryTitle")}
          </h1>
          <p className="entry-lead">{t("entryLead")}</p>
          <p className="entry-lead entry-lead--secondary">{leadText}</p>

          <ul className="entry-caps" aria-label={t("entryLead")}>
            {CAPABILITIES.map((cap) => (
              <li key={cap.key} className={`entry-cap entry-cap--${cap.tone}`}>
                {t(cap.key)}
              </li>
            ))}
          </ul>

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

            <Link to="/" className="entry-link">
              {t("entryIdeLink")}
            </Link>
          </div>

          {supabaseConfigured ? (
            <p className="entry-hint">{t("entryClassroomHint")}</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
