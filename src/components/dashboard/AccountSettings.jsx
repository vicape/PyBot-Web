import { useEffect, useState } from "react";
import { fetchProfile, updateProfileDisplayName } from "../../platform/profileApi.js";

export default function AccountSettings({ user, onProfileUpdated }) {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

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
        const meta = user.user_metadata || {};
        setDisplayName(
          profile?.display_name ||
            meta.full_name ||
            meta.name ||
            (user.email ? user.email.split("@")[0] : ""),
        );
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user]);

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
    return <p className="auth-card__muted">Cargando cuenta…</p>;
  }

  return (
    <section className="dash-panel">
      <h2 className="dash-panel__title">Configuración de cuenta</h2>
      <p className="auth-card__muted auth-card__muted--tight">
        Estos datos se guardan en tu perfil de la plataforma (Supabase).
      </p>

      {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
      {msg ? <p className="auth-card__notice">{msg}</p> : null}

      <form className="dash-form" onSubmit={save}>
        <label className="auth-org-label" htmlFor="profile-email">
          Correo (Google)
        </label>
        <input
          id="profile-email"
          className="auth-org-input auth-org-input--block"
          type="email"
          value={user?.email ?? ""}
          disabled
          readOnly
        />

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

        <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>
    </section>
  );
}
