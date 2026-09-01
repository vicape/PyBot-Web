import { useEffect, useState } from "react";
import { fetchProfile, updateProfileDisplayName } from "../../platform/profileApi.js";

export default function AccountSettings({ user, onProfileUpdated }) {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const meta = user?.user_metadata || {};
  const picture = meta.avatar_url || meta.picture || null;
  const email = user?.email ?? "";
  const initial =
    meta.full_name || meta.name || (email ? email.split("@")[0] : "") || "?";

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const timer = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setErr("No se pudo cargar el perfil. Revisá tu conexión.");
      }
    }, 6000);

    (async () => {
      setLoading(true);
      const { profile, error } = await fetchProfile(user.id);
      if (cancelled) return;
      clearTimeout(timer);
      if (error) {
        setErr(typeof error === "string" ? error : "Error al cargar el perfil.");
      } else {
        setDisplayName(
          profile?.display_name || meta.full_name || meta.name || (email ? email.split("@")[0] : ""),
        );
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, meta.full_name, meta.name, email]);

  const save = async (e) => {
    e.preventDefault();
    if (!user?.id || saving) return;
    setSaving(true);
    setErr("");
    setMsg("");
    const res = await updateProfileDisplayName(user.id, displayName);
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg("Perfil actualizado.");
    onProfileUpdated?.(displayName.trim());
  };

  if (loading) {
    return (
      <section className="dash-panel account-panel">
        <p className="auth-card__muted">Cargando cuenta…</p>
      </section>
    );
  }

  return (
    <section className="dash-panel account-panel">
      <div className="account-profile">
        {picture ? (
          <img src={picture} alt="" className="account-profile__avatar" width={64} height={64} />
        ) : (
          <div className="account-profile__avatar account-profile__avatar--letter" aria-hidden>
            {(displayName || initial).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="account-profile__text">
          <h2 className="account-profile__name">{displayName || initial}</h2>
          <p className="account-profile__email">{email}</p>
        </div>
      </div>

      <p className="account-panel__lead">
        Estos datos se guardan en tu perfil de la plataforma.
      </p>

      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      {msg ? <p className="pbc-alert pbc-alert--info">{msg}</p> : null}

      <form className="dash-form account-form" onSubmit={save}>
        <div className="account-field">
          <label className="auth-org-label" htmlFor="profile-email">
            Correo (Google)
          </label>
          <input
            id="profile-email"
            className="auth-org-input auth-org-input--block"
            type="email"
            value={email}
            disabled
            readOnly
          />
          <p className="account-field__hint">El correo viene de tu cuenta de Google y no se puede cambiar acá.</p>
        </div>

        <div className="account-field">
          <label className="auth-org-label" htmlFor="profile-name">
            Nombre visible
          </label>
          <input
            id="profile-name"
            className="auth-org-input auth-org-input--block"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            disabled={saving}
            placeholder="Tu nombre en el panel"
          />
        </div>

        <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>
    </section>
  );
}
