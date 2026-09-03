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

function PencilIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 16.5V20h3.5L17.8 9.7l-3.5-3.5L4 16.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 5.3l3.5 3.5 1.8-1.8a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0l-1.8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocumentIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3.75h7.5L19 8.25V20a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 20V5A1.25 1.25 0 0 1 7 3.75Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.75V8.5H19" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12.5h6M9 16h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

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
    const { lesson, error } = await createLesson(unitId, { title });
    setBusy(false);
    if (error || !lesson) {
      setErr(error || "No se pudo crear la lección.");
      return;
    }
    navigate(`/dashboard/content/${contentId}/lessons/${lesson.id}`);
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
          <p className="pbc-content-editor__hint">
            Primero creá unidades y lecciones. Para cargar el material, abrí una lección con{" "}
            <strong>Escribir contenido</strong>.
          </p>
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

                {(lessonsByUnit[unit.id] ?? []).length === 0 ? (
                  <div className="pbc-unit-card__empty">
                    <p className="pbc-unit-card__empty-title">Todavía no hay lecciones</p>
                    <p className="pbc-unit-card__empty-text">
                      Creá una lección para escribir texto, agregar imágenes, videos y ejercicios.
                    </p>
                  </div>
                ) : (
                  <ul className="pbc-lesson-list">
                    {(lessonsByUnit[unit.id] ?? []).map((lesson, lessonIndex) => (
                      <li key={lesson.id} className="pbc-lesson-row">
                        <Link
                          to={`/dashboard/content/${contentId}/lessons/${lesson.id}`}
                          className="pbc-lesson-row__main"
                          aria-label={`Escribir contenido de la lección ${lesson.title}`}
                        >
                          <span className="pbc-lesson-row__icon" aria-hidden>
                            <DocumentIcon />
                          </span>
                          <span className="pbc-lesson-row__copy">
                            <span className="pbc-lesson-row__title">
                              Lección {lessonIndex + 1} — {lesson.title}
                            </span>
                            <span className="pbc-lesson-row__subtitle">
                              Tocá para escribir o editar el contenido
                            </span>
                          </span>
                          <span className="pbc-lesson-row__cta">
                            <PencilIcon size={15} />
                            Escribir contenido
                          </span>
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
                            Renombrar
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
                )}

                <button
                  type="button"
                  className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-unit-card__add-lesson"
                  onClick={() => void addLesson(unit.id)}
                  disabled={busy}
                >
                  <PencilIcon size={14} />
                  Nueva lección
                </button>
              </section>
            ))}
          </div>
        )}
      </div>
    </PyBotClassLayout>
  );
}
