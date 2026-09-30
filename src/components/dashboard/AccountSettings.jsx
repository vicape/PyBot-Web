/**
 * Platform usage mode (presentation/onboarding only). MODE exactly CLOUD;
 * TARGET exactly vicape/PyBot-Web; baseline exactly 2b696472d32a32c4cf4a0e0ecfa632eb10bc6aee.
 * Selecting Docente persists exactly profiles.preferred_role = 'teacher';
 * selecting Alumno persists exactly profiles.preferred_role = 'student'.
 * Reuses updatePreferredRole(userId, role) — never grants authorization.
 */
import { useEffect, useState } from "react";
import {
  fetchProfile,
  updatePreferredRole,
  updateProfileDisplayName,
} from "../../platform/profileApi.js";

function normalizePreferredRole(value) {
  return value === "teacher" || value === "student" ? value : null;
}

export default function AccountSettings({ user, onProfileUpdated, onPreferredRoleUpdated }) {
  const [displayName, setDisplayName] = useState("");
  const [preferredRole, setPreferredRole] = useState(null);
  const [savedPreferredRole, setSavedPreferredRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [roleMsg, setRoleMsg] = useState("");
  const [roleErr, setRoleErr] = useState("");

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
        const role = normalizePreferredRole(profile?.preferred_role);
        setPreferredRole(role);
        setSavedPreferredRole(role);
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

  // Save platform mode: profiles.preferred_role = 'teacher' | profiles.preferred_role = 'student'
  // via updatePreferredRole(userId, role). Preference only — never membership writes.
  const selectPreferredRole = async (role) => {
    if (!user?.id || roleSaving) return;
    if (role !== "teacher" && role !== "student") return;
    if (role === preferredRole) return;

    setPreferredRole(role);
    setRoleSaving(true);
    setRoleErr("");
    setRoleMsg("");
    // updatePreferredRole(userId, role) — persists profiles.preferred_role = role only
    const res = await updatePreferredRole(user.id, role);
    setRoleSaving(false);
    if (!res.ok) {
      setPreferredRole(savedPreferredRole);
      setRoleErr(
        typeof res.error === "string" && res.error
          ? res.error
          : "No se pudo guardar el modo de uso.",
      );
      return;
    }
    setSavedPreferredRole(role);
    setRoleMsg("Modo de uso actualizado.");
    onPreferredRoleUpdated?.(role);
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
            disabled={saving || roleSaving}
            placeholder="Tu nombre en el panel"
          />
        </div>

        <div className="account-field">
          <span className="auth-org-label" id="platform-mode-label">
            {"Modo de uso"}
          </span>
          <p className="account-field__hint" id="platform-mode-hint">
            {
              "Elegí cómo querés usar PyBot. Esto adapta tu experiencia, pero no cambia tus permisos en instituciones o cursos."
            }
          </p>
          <div
            className="account-mode-options"
            role="radiogroup"
            aria-labelledby="platform-mode-label"
            aria-describedby="platform-mode-hint"
          >
            <label className="account-mode-option">
              <input
                type="radio"
                name="platform-mode"
                value="student"
                checked={preferredRole === "student"}
                disabled={roleSaving || saving}
                onChange={() => void selectPreferredRole("student")}
              />
              <span>{"Alumno"}</span>
            </label>
            <label className="account-mode-option">
              <input
                type="radio"
                name="platform-mode"
                value="teacher"
                checked={preferredRole === "teacher"}
                disabled={roleSaving || saving}
                onChange={() => void selectPreferredRole("teacher")}
              />
              <span>{"Docente"}</span>
            </label>
          </div>
          {roleSaving ? (
            <p className="account-field__hint" aria-live="polite">
              Guardando modo de uso…
            </p>
          ) : null}
          {roleErr ? <p className="pbc-alert pbc-alert--error">{roleErr}</p> : null}
          {roleMsg ? <p className="pbc-alert pbc-alert--info">{roleMsg}</p> : null}
        </div>

        <button type="submit" className="auth-btn auth-btn--primary" disabled={saving || roleSaving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>
    </section>
  );
}
