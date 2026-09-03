import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AssignedContentSnapshotViewer from "../components/content-editor/AssignedContentSnapshotViewer.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { getContent, listContentUnits, listUnitLessons, getLesson } from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

/**
 * Lectura sola de un contenido compartido (comunidad / cursos).
 * No crea copia ni permite edición.
 */
export default function SharedContentPage() {
  const { contentId } = useParams();
  const loginPath = `/dashboard/community/${contentId}`;
  const { user, loading: authLoading, supabase } = useRequireSession(loginPath);
  const [content, setContent] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [superAdmin, setSuperAdmin] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

  useEffect(() => {
    if (!user || !contentId || !isSupabaseConfigured()) return;
    void (async () => {
      setLoading(true);
      const profile = await fetchProfile(user.id);
      setSuperAdmin(isSuperAdmin(profile));
      const { content: c, error } = await getContent(contentId);
      if (error || !c) {
        setErr(error || "No se pudo abrir el contenido.");
        setLoading(false);
        return;
      }
      if (c.owner_id === user.id) {
        // Owner should edit in Mi Contenido
      }
      setContent(c);
      const { rows: units } = await listContentUnits(contentId);
      const unitSnaps = [];
      for (const u of units) {
        const { rows: lessons } = await listUnitLessons(u.id);
        const lessonSnaps = [];
        for (const l of lessons) {
          const { lesson } = await getLesson(l.id);
          lessonSnaps.push({
            id: l.id,
            title: l.title,
            description: l.description || "",
            position: l.position,
            document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
          });
        }
        unitSnaps.push({
          id: u.id,
          title: u.title,
          description: u.description || "",
          position: u.position,
          lessons: lessonSnaps,
        });
      }
      setSnapshot({
        schemaVersion: 1,
        sourceType: "content",
        sourceId: c.id,
        title: c.title,
        description: c.description || "",
        units: unitSnaps,
      });
      setLoading(false);
    })();
  }, [user, contentId]);

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando…</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      <div className="pbc-lesson-page">
        <nav className="pbc-content-breadcrumb" aria-label="Ubicación">
          <Link to="/dashboard/community">Comunidad</Link>
          <span aria-hidden> › </span>
          <span>{content?.title || "Contenido"}</span>
        </nav>
        <header className="pbc-lesson-hero" style={{ marginBottom: 24 }}>
          <div className="pbc-lesson-hero__copy">
            <h1 className="pbc-lesson-title-input" style={{ border: 0, padding: 0 }}>
              {content?.title}
            </h1>
            <p className="pbc-lesson-hero__subtitle">Solo lectura · no se crea una copia</p>
          </div>
        </header>
        <AssignedContentSnapshotViewer snapshot={snapshot} />
      </div>
    </PyBotClassLayout>
  );
}
