import { Link } from "react-router-dom";
import { t } from "../i18n.js";
import { sessionUserDisplay } from "../platform/useOptionalSession.js";

export default function IdeUserChip({ user, loading, onSignOut }) {
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

  return (
    <div className="ide-user-chip" title={display.email || display.name}>
      {display.picture ? (
        <img src={display.picture} alt="" className="ide-user-chip__avatar" width={32} height={32} />
      ) : (
        <div className="ide-user-chip__avatar ide-user-chip__avatar--letter" aria-hidden>
          {display.name.slice(0, 1).toUpperCase()}
        </div>
      )}
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
    </div>
  );
}
