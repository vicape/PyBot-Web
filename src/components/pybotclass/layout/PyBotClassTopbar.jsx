import { useState } from "react";
import { Link } from "react-router-dom";
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
  contextualRoleLabel = null,
  contextualRoleCompact = null,
  accountHref = "/dashboard/classes?panel=account",
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
          {UI_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              className={`pbc-theme-toggle__btn${appearance?.theme === theme ? " pbc-theme-toggle__btn--active" : ""}`}
              onClick={() => onThemeChange?.({ theme })}
              title={theme === "system" ? t("pcThemeSystem") : theme === "light" ? t("pcThemeLight") : t("pcThemeDark")}
              aria-label={theme === "system" ? t("pcThemeSystemLabel") : theme === "light" ? t("pcThemeLightLabel") : t("pcThemeDarkLabel")}
            >
              {THEME_ICONS[theme]}
            </button>
          ))}
        </div>

        <div className="pbc-topbar__user">
          <Link
            to={accountHref}
            className="pbc-topbar__account-link"
            aria-label={t("pcAccount")}
            title={t("pcAccount")}
          >
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
          </Link>
          {contextualRoleLabel ? (
            <span
              className="pbc-topbar__role"
              title={contextualRoleLabel}
              aria-label={contextualRoleLabel}
            >
              <span className="pbc-topbar__role-full">{contextualRoleLabel}</span>
              {contextualRoleCompact ? (
                <span className="pbc-topbar__role-compact" aria-hidden="true">
                  {contextualRoleCompact}
                </span>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-topbar__logout" onClick={onSignOut}>
            {t("pcSignOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
