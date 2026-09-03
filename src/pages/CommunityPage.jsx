import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { listCommunityContents } from "../platform/contentShareApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

export default function CommunityPage() {
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/community");
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

  const load = useCallback(async (term) => {
    setLoading(true);
    setErr("");
    const { rows: list, error } = await listCommunityContents({ search: term });
    setLoading(false);
    if (error) {
      setErr(error);
      setRows([]);
      return;
    }
    setRows(list);
  }, []);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;
    void (async () => {
      const profile = await fetchProfile(user.id);
      setSuperAdmin(isSuperAdmin(profile));
      await load("");
    })();
  }, [user, load]);

  if (authLoading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando…</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} onSignOut={() => void signOut()}>
      {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

      <header className="pbc-hero-block" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 className="pbc-hero-block__title">Comunidad PyBot</h1>
          <p className="pbc-hero-block__lead">
            Contenidos que docentes compartieron para lectura. Solo el autor puede editarlos.
          </p>
        </div>
      </header>

      <form
        className="pbc-community-search"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 20 }}
      >
        <input
          className="pbc-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título…"
          aria-label="Buscar en comunidad"
        />
        <button type="submit" className="pbc-btn pbc-btn--primary">
          Buscar
        </button>
      </form>

      {loading ? (
        <p>Cargando contenidos…</p>
      ) : rows.length === 0 ? (
        <p className="pbc-modal--assign-lesson__subtitle">Todavía no hay contenidos en la comunidad.</p>
      ) : (
        <div className="pbc-content-grid">
          {rows.map((c) => (
            <article key={c.id} className="pbc-content-card">
              <div className="pbc-content-card__header">
                <span className="pbc-badge pbc-badge--blue">Comunidad</span>
              </div>
              <h2 className="pbc-content-card__title">{c.title}</h2>
              {c.description ? <p className="pbc-content-card__desc">{c.description}</p> : null}
              <div className="pbc-content-card__meta">
                <span>{c.owner_name}</span>
              </div>
              <Link to={`/dashboard/community/${c.id}`} className="pbc-content-card__link">
                Leer →
              </Link>
            </article>
          ))}
        </div>
      )}
    </PyBotClassLayout>
  );
}
