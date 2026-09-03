import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ContentCard from "../components/pybotclass/content/ContentCard.jsx";
import CreateContentModal from "../components/pybotclass/content/CreateContentModal.jsx";
import DeleteContentModal from "../components/pybotclass/content/DeleteContentModal.jsx";
import EditContentModal from "../components/pybotclass/content/EditContentModal.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import MyContentEmptyIllustration from "../components/pybotclass/illustrations/MyContentEmptyIllustration.jsx";
import { listMyContents } from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

export default function MyContentPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/content");
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

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
                <ContentCard
                  key={c.id}
                  content={c}
                  onEdit={setEditing}
                  onDelete={setDeleting}
                />
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

      <EditContentModal
        open={!!editing}
        content={editing}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setContents((rows) =>
            rows.map((row) =>
              row.id === updated.id
                ? {
                    ...row,
                    title: updated.title,
                    description: updated.description,
                    status: updated.status,
                    updated_at: updated.updated_at,
                  }
                : row,
            ),
          );
        }}
      />

      <DeleteContentModal
        open={!!deleting}
        content={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setContents((rows) => rows.filter((row) => row.id !== id));
        }}
      />
    </>
  );
}
