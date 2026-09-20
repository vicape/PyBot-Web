import { useState } from "react";
import { UI_THEMES } from "../../../platform/appearanceApi.js";
import { getLang, setLang, SUPPORTED_LANGS, LANG_LABELS, t } from "../../../i18n.js";

const THEME_ICONS = { system: "◐", light: "☀", dark: "☾" };

export default function PyBotClassTopbar({
  userName,
  userEmail,
  userPicture,
  search = "",
  onSearchChange,
  hideSearch = false,
  appearance,
  onThemeChange,
  onSignOut,
  onMenuOpen,
}) {
  const [lang, setLangState] = useState(() => getLang());
  const onLangChange = (next) => {
    const saved = setLang(next);
    setLangState(saved);
    window.location.reload();
  };

  return (
    <header className="pbc-topbar">
      <button
        type="button"
        className="pbc-topbar__menu-btn"
        onClick={onMenuOpen}
        aria-label={t("pcOpenMenu")}
      >
        ☰
      </button>

      {!hideSearch ? (
        <div className="pbc-topbar__search">
          <span className="pbc-topbar__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            placeholder={t("pcSearchCourses")}
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            aria-label={t("pcSearchCoursesLabel")}
          />
        </div>
      ) : (
        <div className="pbc-topbar__search" aria-hidden />
      )}

      <div className="pbc-topbar__actions">
        <label className="pbc-topbar__lang">
          <span className="sr-only">{t("pcLanguage")}</span>
          <select
            value={lang}
            onChange={(e) => onLangChange(e.target.value)}
            aria-label={t("pcLanguage")}
            title={t("pcLanguage")}
          >
            {SUPPORTED_LANGS.map((code) => (
              <option key={code} value={code}>{LANG_LABELS[code]}</option>
            ))}
          </select>
        </label>

        <div className="pbc-theme-toggle" role="group" aria-label={t("pcTheme")}>
          {UI_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`pbc-theme-toggle__btn${appearance?.theme === t ? " pbc-theme-toggle__btn--active" : ""}`}
              onClick={() => onThemeChange?.({ theme: t })}
              title={t === "system" ? t("pcThemeSystem") : t === "light" ? t("pcThemeLight") : t("pcThemeDark")}
              aria-label={t === "system" ? t("pcThemeSystemLabel") : t === "light" ? t("pcThemeLightLabel") : t("pcThemeDarkLabel")}
            >
              {THEME_ICONS[t]}
            </button>
          ))}
        </div>

        <div className="pbc-topbar__user">
          {userPicture ? (
            <img src={userPicture} alt="" className="pbc-topbar__avatar" width={36} height={36} />
          ) : (
            <div className="pbc-topbar__avatar pbc-topbar__avatar--letter" aria-hidden>
              {(userName || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="pbc-topbar__user-text">
            <strong>{userName}</strong>
            {userEmail ? <span>{userEmail}</span> : null}
          </div>
          <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={onSignOut}>
            {t("pcSignOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
