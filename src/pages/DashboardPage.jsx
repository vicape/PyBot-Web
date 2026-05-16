import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getGoogleProfile } from "../authSession.js";
import { signOutGoogleClient } from "../authGoogle.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { slugifyOrganizationName } from "../slugify.js";

function LegacyDashboard({ profile, onSignOut }) {
  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-card__title">Panel</h1>
        <p className="auth-card__lead">Sesión iniciada (solo en este navegador).</p>
        <div className="auth-profile">
          {profile.picture ? (
            <img src={profile.picture} alt="" className="auth-profile__avatar" width={56} height={56} />
          ) : null}
          <div className="auth-profile__text">
            <strong>{profile.name || "Usuario"}</strong>
            {profile.email ? <span className="auth-profile__email">{profile.email}</span> : null}
          </div>
        </div>
        <p className="auth-card__muted">
          Para colegios y datos en la nube, configurá Supabase (ver <code>.env.example</code>).
        </p>
        <div className="auth-card__actions auth-card__actions--row">
          <Link to="/" className="auth-btn auth-btn--ghost">
            Abrir IDE
          </Link>
          <button type="button" className="auth-btn auth-btn--primary" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const useCloud = isSupabaseConfigured();

  const [sessionUser, setSessionUser] = useState(null);
  const [loading, setLoading] = useState(!!useCloud);
  const [orgs, setOrgs] = useState([]);
  const [orgError, setOrgError] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);

  const legacyProfile = getGoogleProfile();

  const loadOrganizations = useCallback(async () => {
    if (!supabase || !sessionUser) return;
    setOrgError("");
    const uid = sessionUser.id;
    const { data, error } = await supabase
      .from("organizations")
      .select("id,name,slug,created_at, organization_members!inner(role)")
      .eq("organization_members.user_id", uid);

    if (error) {
      setOrgError(error.message);
      return;
    }
    setOrgs(data ?? []);
  }, [supabase, sessionUser]);

  useEffect(() => {
    if (!useCloud) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSessionUser(sess?.user ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [useCloud, supabase]);

  useEffect(() => {
    if (!useCloud || !sessionUser) return;
    loadOrganizations();
  }, [useCloud, sessionUser, loadOrganizations]);

  const signOutLegacy = () => {
    signOutGoogleClient();
    navigate("/login", { replace: true });
  };

  const signOutSupabase = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const createOrganization = async (e) => {
    e.preventDefault();
    if (!supabase || !sessionUser || savingOrg) return;
    const name = newOrgName.trim();
    if (!name) return;
    setSavingOrg(true);
    setOrgError("");

    let baseSlug = slugifyOrganizationName(name);
    let slug = baseSlug;

    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: row, error: insOrg } = await supabase
          .from("organizations")
          .insert({ name, slug, created_by: sessionUser.id })
          .select("id")
          .maybeSingle();

        if (insOrg?.code === "23505") {
          slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
          continue;
        }
        if (insOrg || !row?.id) {
          setOrgError(insOrg?.message || "No se pudo crear el colegio.");
          return;
        }

        const { error: insMem } = await supabase.from("organization_members").insert({
          org_id: row.id,
          user_id: sessionUser.id,
          role: "owner",
        });

        if (insMem) {
          await supabase.from("organizations").delete().eq("id", row.id);
          setOrgError(insMem.message);
          return;
        }

        setNewOrgName("");
        await loadOrganizations();
        return;
      }
      setOrgError("No hay slug disponible, probá otro nombre.");
    } finally {
      setSavingOrg(false);
    }
  };

  if (useCloud && loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando sesión…</p>
      </main>
    );
  }

  if (useCloud && !sessionUser) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Panel</h1>
          <p className="auth-card__lead">Iniciá sesión para ver tus colegios.</p>
          <div className="auth-card__actions">
            <Link to="/login" className="auth-btn auth-btn--ghost">
              Ir a login
            </Link>
            <Link to="/" className="auth-link">
              Abrir IDE
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (useCloud && sessionUser) {
    const meta = sessionUser.user_metadata || {};
    const email = sessionUser.email;
    const name =
      meta.full_name ||
      meta.name ||
      meta.display_name ||
      (email ? email.split("@")[0] : "Usuario");
    const picture = meta.avatar_url || meta.picture || null;

    return (
      <main className="auth-root">
        <div className="auth-card auth-card--wide">
          <h1 className="auth-card__title">Panel PyBot</h1>
          <p className="auth-card__lead">Sesión en la plataforma (Supabase).</p>
          <div className="auth-profile">
            {picture ? (
              <img src={picture} alt="" className="auth-profile__avatar" width={56} height={56} />
            ) : (
              <div className="auth-profile__avatar auth-profile__avatar--letter" aria-hidden>
                {(name || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="auth-profile__text">
              <strong>{name}</strong>
              {email ? <span className="auth-profile__email">{email}</span> : null}
            </div>
          </div>

          <section className="auth-section">
            <h2 className="auth-section__title">Tus colegios</h2>
            {orgError ? <p className="auth-card__notice auth-card__notice--err">{orgError}</p> : null}
            {orgs.length === 0 ? (
              <p className="auth-card__muted">Todavía no registraste ningún colegio.</p>
            ) : (
              <ul className="auth-org-list">
                {orgs.map((o) => (
                  <li key={o.id} className="auth-org-row auth-org-row--link">
                    <Link className="auth-org-row__link" to={`/dashboard/org/${o.id}`}>
                      <span className="auth-org-row__name">{o.name}</span>
                      <span className="auth-org-row__meta">
                        @{o.slug} · {(o.organization_members?.[0]?.role) || "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <form className="auth-org-form" onSubmit={createOrganization}>
              <label className="auth-org-label" htmlFor="new-org-name">
                Registrar colegio
              </label>
              <div className="auth-org-form__row">
                <input
                  id="new-org-name"
                  className="auth-org-input"
                  type="text"
                  placeholder='Ej. Escuela San Martín'
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  maxLength={120}
                  disabled={savingOrg}
                />
                <button type="submit" className="auth-btn auth-btn--primary" disabled={savingOrg}>
                  Crear
                </button>
              </div>
            </form>
            <p className="auth-card__muted">
              Próximo: invitar docentes/alumnos y enlazar Classroom. Migración SQL:{" "}
              <code>supabase/migrations/</code>.
            </p>
          </section>

          <div className="auth-card__actions auth-card__actions--row">
            <Link to="/" className="auth-btn auth-btn--ghost">
              Abrir IDE
            </Link>
            <button type="button" className="auth-btn auth-btn--primary" onClick={signOutSupabase}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!legacyProfile) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Panel</h1>
          <p className="auth-card__lead">No hay sesión iniciada en este navegador.</p>
          <div className="auth-card__actions">
            <Link to="/login" className="auth-btn auth-btn--ghost">
              Ir a login
            </Link>
            <Link to="/" className="auth-link">
              Abrir IDE
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <LegacyDashboard profile={legacyProfile} onSignOut={signOutLegacy} />;
}
