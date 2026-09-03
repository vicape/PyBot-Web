import { useEffect, useState } from "react";
import {
  CONTENT_VISIBILITY,
  CONTENT_VISIBILITY_LABELS,
  listContentCourseAccess,
  listTeacherCoursesForShare,
  setContentSharing,
} from "../../platform/contentShareApi.js";

export default function ShareContentModal({ open, onClose, content, onSaved }) {
  const [visibility, setVisibility] = useState(CONTENT_VISIBILITY.private);
  const [courses, setCourses] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !content?.id) {
      setErr("");
      setBusy(false);
      return;
    }
    setVisibility(content.visibility || CONTENT_VISIBILITY.private);
    setLoading(true);
    void (async () => {
      const [{ rows: courseRows }, { rows: access }] = await Promise.all([
        listTeacherCoursesForShare(),
        listContentCourseAccess(content.id),
      ]);
      setCourses(courseRows || []);
      setSelected(new Set((access || []).map((a) => a.course_id)));
      setLoading(false);
    })();
  }, [open, content]);

  if (!open) return null;

  const toggleCourse = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    const { content: saved, error } = await setContentSharing({
      contentId: content.id,
      visibility,
      courseIds: [...selected],
    });
    setBusy(false);
    if (error || !saved) {
      setErr(error || "No se pudo guardar.");
      return;
    }
    onSaved?.(saved);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--assign-lesson"
        role="dialog"
        aria-labelledby="share-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="share-content-title" className="pbc-modal__title">
          Compartir
        </h2>
        <p className="pbc-modal--assign-lesson__subtitle">
          Definí quién puede <strong>leer</strong> «{content?.title}». Solo vos podés editarlo.
        </p>

        <fieldset className="pbc-modal__field pbc-assign-mode">
          <legend className="pbc-label">Visibilidad</legend>
          {Object.keys(CONTENT_VISIBILITY).map((key) => (
            <label key={key} className="pbc-assign-mode__option">
              <input
                type="radio"
                name="share-vis"
                checked={visibility === key}
                onChange={() => setVisibility(key)}
                disabled={busy || loading}
              />
              {CONTENT_VISIBILITY_LABELS[key]}
            </label>
          ))}
        </fieldset>

        {visibility === CONTENT_VISIBILITY.courses ? (
          <div className="pbc-modal__field">
            <span className="pbc-label">Cursos con acceso de lectura</span>
            <div className="pbc-assign-students" style={{ marginTop: 8 }}>
              {courses.length === 0 ? (
                <p className="pbc-modal--assign-lesson__subtitle">No hay cursos donde seas docente.</p>
              ) : (
                courses.map((c) => (
                  <label key={c.course_id} className="pbc-assign-students__row">
                    <input
                      type="checkbox"
                      checked={selected.has(c.course_id)}
                      onChange={() => toggleCourse(c.course_id)}
                      disabled={busy}
                    />
                    <span>
                      {c.course_title}
                      {c.org_name ? <small> · {c.org_name}</small> : null}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        ) : null}

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy || loading}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
