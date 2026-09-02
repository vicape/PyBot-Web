import { UI_THEMES } from "../../../platform/appearanceApi.js";

const THEME_ICONS = { system: "◐", light: "☀", dark: "☾" };

export default function PyBotClassTopbar({
  userName,
  userEmail,
  userPicture,
  search,
  onSearchChange,
  appearance,
  onThemeChange,
  onSignOut,
  onMenuOpen,
}) {
  return (
    <header className="pbc-topbar">
      <button
        type="button"
        className="pbc-topbar__menu-btn"
        onClick={onMenuOpen}
        aria-label="Abrir menú"
      >
        ☰
      </button>

      <div className="pbc-topbar__search">
        <span className="pbc-topbar__search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          placeholder="Buscar cursos…"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          aria-label="Buscar cursos"
        />
      </div>

      <div className="pbc-topbar__actions">
        <div className="pbc-theme-toggle" role="group" aria-label="Tema">
          {UI_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`pbc-theme-toggle__btn${appearance?.theme === t ? " pbc-theme-toggle__btn--active" : ""}`}
              onClick={() => onThemeChange?.({ theme: t })}
              title={t === "system" ? "Sistema" : t === "light" ? "Claro" : "Oscuro"}
              aria-label={t === "system" ? "Tema sistema" : t === "light" ? "Tema claro" : "Tema oscuro"}
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
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
