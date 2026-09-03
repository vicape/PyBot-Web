import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import {
  createContentUnit,
  createLesson,
  deleteContentUnit,
  deleteLesson,
  getContent,
  listContentUnits,
  listUnitLessons,
  moveContentUnit,
  moveLesson,
  updateContentUnit,
  updateLesson,
} from "../platform/contentApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

export default function ContentEditorPage() {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/content/${contentId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [content, setContent] = useState(null);
  const [units, setUnits] = useState([]);
  const [lessonsByUnit, setLessonsByUnit] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user || !contentId) return;
    setLoading(true);
    setErr("");

    const [{ content: c, error: cErr }, { rows: unitRows, error: uErr }, { profile }] = await Promise.all([
      getContent(contentId),
      listContentUnits(contentId),
      fetchProfile(user.id),
    ]);

    setSuperAdmin(isSuperAdmin(profile));

    if (cErr || !c) {
      setErr(cErr || "Contenido no encontrado.");
      setLoading(false);
      return;
    }
    if (uErr) setErr(uErr);

    const lessonMap = {};
    for (const unit of unitRows) {
      const { rows } = await listUnitLessons(unit.id);
      lessonMap[unit.id] = rows;
    }

    setContent(c);
    setUnits(unitRows);
    setLessonsByUnit(lessonMap);
    setLoading(false);
  }, [user, contentId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const promptText = (message, defaultValue = "") => {
    const v = window.prompt(message, defaultValue);
    return v === null ? null : v.trim();
  };

  const addUnit = async () => {
    const title = promptText("Título de la unidad");
    if (!title || busy) return;
    setBusy(true);
    const { unit, error } = await createContentUnit(contentId, { title });
    setBusy(false);
    if (error || !unit) {
      setErr(error || "No se pudo crear la unidad.");
      return;
    }
    void load();
  };

  const editUnitTitle = async (unit) => {
    const title = promptText("Título de la unidad", unit.title);
    if (!title || title === unit.title) return;
    setBusy(true);
    const { error } = await updateContentUnit(unit.id, { title });
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const removeUnit = async (unit) => {
    if (!window.confirm(`¿Eliminar la unidad «${unit.title}» y todas sus lecciones?`)) return;
    setBusy(true);
    const { error } = await deleteContentUnit(unit.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const addLesson = async (unitId) => {
    const title = promptText("Título de la lección");
    if (!title || busy) return;
    setBusy(true);
    const { error } = await createLesson(unitId, { title });
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const editLessonTitle = async (lesson) => {
    const title = promptText("Título de la lección", lesson.title);
    if (!title || title === lesson.title) return;
    setBusy(true);
    const { error } = await updateLesson(lesson.id, { title });
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const removeLesson = async (lesson) => {
    if (!window.confirm(`¿Eliminar la lección «${lesson.title}»?`)) return;
    setBusy(true);
    const { error } = await deleteLesson(lesson.id);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const moveUnit = async (unitId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveContentUnit(unitId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  const moveLessonItem = async (lessonId, direction) => {
    if (busy) return;
    setBusy(true);
    const { error } = await moveLesson(lessonId, direction);
    setBusy(false);
    if (error) setErr(error);
    else void load();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando editor…</p>
      </main>
    );
  }
  if (!user || !content) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
      {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

      <div className="pbc-content-editor">
        <nav className="pbc-content-breadcrumb">
          <Link to="/dashboard/content">Mi Contenido</Link>
          <span aria-hidden> / </span>
          <span>{content.title}</span>
        </nav>

        <header className="pbc-content-editor__head">
          <h1 className="pbc-hero-block__title">{content.title}</h1>
          {content.description ? <p className="pbc-hero-block__subtitle">{content.description}</p> : null}
        </header>

        <div className="pbc-content-editor__actions">
          <button type="button" className="pbc-btn pbc-btn--primary" onClick={addUnit} disabled={busy}>
            + Nueva unidad
          </button>
        </div>

        {units.length === 0 ? (
          <div className="pbc-content-editor__empty">
            <p>Todavía no hay unidades. Creá la primera para organizar tus lecciones.</p>
          </div>
        ) : (
          <div className="pbc-unit-list">
            {units.map((unit, unitIndex) => (
              <section key={unit.id} className="pbc-unit-card">
                <div className="pbc-unit-card__head">
                  <div className="pbc-unit-card__title-row">
                    <h2 className="pbc-unit-card__title">
                      Unidad {unitIndex + 1} — {unit.title}
                    </h2>
                    <div className="pbc-order-btns">
                      <button
                        type="button"
                        className="pbc-order-btn"
                        onClick={() => void moveUnit(unit.id, "up")}
                        disabled={busy || unitIndex === 0}
                        aria-label="Subir unidad"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="pbc-order-btn"
                        onClick={() => void moveUnit(unit.id, "down")}
                        disabled={busy || unitIndex === units.length - 1}
                        aria-label="Bajar unidad"
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <div className="pbc-unit-card__actions">
                    <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={() => void editUnitTitle(unit)}>
                      Editar
                    </button>
                    <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={() => void removeUnit(unit)}>
                      Eliminar
                    </button>
                  </div>
                </div>

                <ul className="pbc-lesson-list">
                  {(lessonsByUnit[unit.id] ?? []).map((lesson, lessonIndex) => (
                    <li key={lesson.id} className="pbc-lesson-row">
                      <Link to={`/dashboard/content/${contentId}/lessons/${lesson.id}`} className="pbc-lesson-row__link">
                        Lección {lessonIndex + 1} — {lesson.title}
                      </Link>
                      <div className="pbc-lesson-row__actions">
                        <div className="pbc-order-btns">
                          <button
                            type="button"
                            className="pbc-order-btn"
                            onClick={() => void moveLessonItem(lesson.id, "up")}
                            disabled={busy || lessonIndex === 0}
                            aria-label="Subir lección"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="pbc-order-btn"
                            onClick={() => void moveLessonItem(lesson.id, "down")}
                            disabled={
                              busy || lessonIndex === (lessonsByUnit[unit.id]?.length ?? 0) - 1
                            }
                            aria-label="Bajar lección"
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          type="button"
                          className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                          onClick={() => void editLessonTitle(lesson)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                          onClick={() => void removeLesson(lesson)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-unit-card__add-lesson"
                  onClick={() => void addLesson(unit.id)}
                  disabled={busy}
                >
                  + Nueva lección
                </button>
              </section>
            ))}
          </div>
        )}
      </div>
    </PyBotClassLayout>
  );
}
