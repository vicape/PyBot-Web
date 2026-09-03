import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CreateContentModal from "../components/pybotclass/content/CreateContentModal.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import MyContentEmptyIllustration from "../components/pybotclass/illustrations/MyContentEmptyIllustration.jsx";
import { CONTENT_STATUS_LABELS, listMyContents } from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function MyContentPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/content");
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");
    const [{ rows, error }, { profile }] = await Promise.all([
      listMyContents(),
      fetchProfile(user.id),
    ]);
    setSuperAdmin(isSuperAdmin(profile));
    if (error) setErr(error);
    setContents(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando Mi Contenido…</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <>
      <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
        {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-content-page">
          <header className="pbc-content-page__head">
            <div>
              <h1 className="pbc-hero-block__title">Mi Contenido</h1>
              <p className="pbc-hero-block__subtitle">
                Creá y organizá contenidos completos para reutilizarlos en tus cursos.
              </p>
            </div>
            <button type="button" className="pbc-btn pbc-btn--primary" onClick={() => setShowCreate(true)}>
              + Crear contenido
            </button>
          </header>

          {contents.length === 0 ? (
            <div className="pbc-empty-state pbc-empty-state--content">
              <span className="pbc-empty-state__illus" aria-hidden>
                <MyContentEmptyIllustration />
              </span>
              <h3 className="pbc-empty-state__title">Creá tu primer contenido</h3>
              <p className="pbc-empty-state__desc">
                Organizá teoría, ejemplos, ejercicios y tareas en un mismo lugar.
              </p>
              <div className="pbc-empty-state__actions">
                <button type="button" className="pbc-btn pbc-btn--primary" onClick={() => setShowCreate(true)}>
                  Crear contenido
                </button>
              </div>
            </div>
          ) : (
            <div className="pbc-content-grid">
              {contents.map((c) => (
                <Link key={c.id} to={`/dashboard/content/${c.id}`} className="pbc-content-card">
                  <div className="pbc-content-card__header">
                    <span className="pbc-content-card__icon" aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M5.5 7.5h13A1.5 1.5 0 0 1 20 9v10.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V9A1.5 1.5 0 0 1 5.5 7.5Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                        <path d="M8 12h8M8 15.5h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="pbc-badge pbc-badge--blue">
                      {CONTENT_STATUS_LABELS[c.status] || "Borrador"}
                    </span>
                  </div>
                  <h2 className="pbc-content-card__title">{c.title}</h2>
                  {c.description ? <p className="pbc-content-card__desc">{c.description}</p> : null}
                  <div className="pbc-content-card__meta">
                    <span>
                      {c.unit_count} unidad{c.unit_count === 1 ? "" : "es"}
                    </span>
                    <span>Modificado {formatDate(c.updated_at)}</span>
                  </div>
                  <span className="pbc-content-card__link">Abrir →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </PyBotClassLayout>

      <CreateContentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(content) => navigate(`/dashboard/content/${content.id}`)}
      />
    </>
  );
}
