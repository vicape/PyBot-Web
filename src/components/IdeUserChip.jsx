import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n.js";
import { sessionUserDisplay } from "../platform/useOptionalSession.js";

export default function IdeUserChip({ user, loading, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="ide-user-chip ide-user-chip--loading" aria-busy="true">
        <span className="ide-user-chip__skeleton" />
      </div>
    );
  }

  if (!user) {
    return (
      <Link to="/login" className="ide-user-chip ide-user-chip--login">
        {t("signIn")}
      </Link>
    );
  }

  const display = sessionUserDisplay(user);
  if (!display) return null;

  const onAvatarClick = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches) {
      setMenuOpen((v) => !v);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`ide-user-chip${menuOpen ? " ide-user-chip--open" : ""}`}
      title={display.email || display.name}
    >
      <button
        type="button"
        className="ide-user-chip__avatar-btn"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={display.name}
        onClick={onAvatarClick}
      >
        {display.picture ? (
          <img src={display.picture} alt="" className="ide-user-chip__avatar" width={32} height={32} />
        ) : (
          <div className="ide-user-chip__avatar ide-user-chip__avatar--letter" aria-hidden>
            {display.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </button>
      <div className="ide-user-chip__text">
        <strong className="ide-user-chip__name">{display.name}</strong>
        {display.email ? <span className="ide-user-chip__email">{display.email}</span> : null}
      </div>
      <Link to="/dashboard" className="ide-user-chip__panel">
        {t("dashboardLink")}
      </Link>
      <button type="button" className="ide-user-chip__signout" onClick={() => void onSignOut()}>
        {t("signOut")}
      </button>
      <div className="ide-user-chip__popover" role="menu" hidden={!menuOpen}>
        <div className="ide-user-chip__popover-name">{display.name}</div>
        <button
          type="button"
          className="ide-user-chip__popover-item"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            void onSignOut();
          }}
        >
          {t("signOut")}
        </button>
      </div>
    </div>
  );
}
