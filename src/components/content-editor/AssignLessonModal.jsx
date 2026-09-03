import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  assignLessonToCourse,
  listCourseStudents,
  listTeacherCoursesForAssign,
} from "../../platform/contentAssignApi.js";

export default function AssignLessonModal({
  open,
  onClose,
  lessonId,
  lessonTitle,
  contentTitle,
}) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [mode, setMode] = useState("all");
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [dueAt, setDueAt] = useState("");
  const [maxPoints, setMaxPoints] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!open) {
      setCourseId("");
      setMode("all");
      setStudents([]);
      setSelected(new Set());
      setDueAt("");
      setMaxPoints("");
      setTitle("");
      setBusy(false);
      setErr("");
      setDone(null);
      return;
    }
    setTitle(lessonTitle || "");
    setLoadingCourses(true);
    void (async () => {
      const { rows, error } = await listTeacherCoursesForAssign();
      setLoadingCourses(false);
      if (error) {
        setErr(error);
        setCourses([]);
        return;
      }
      setCourses(rows);
      if (rows.length === 1) setCourseId(rows[0].course_id);
      if (rows.length === 0) {
        setErr(
          "No encontramos cursos donde seas docente. Abrí Mis clases y verificá que tengas al menos un curso.",
        );
      }
    })();
  }, [open, lessonTitle]);

  useEffect(() => {
    if (!open || !courseId) {
      setStudents([]);
      setSelected(new Set());
      return;
    }
    setLoadingStudents(true);
    void (async () => {
      const { rows, error } = await listCourseStudents(courseId);
      setLoadingStudents(false);
      if (error) {
        setErr(error);
        setStudents([]);
        return;
      }
      setStudents(rows);
      setSelected(new Set());
    })();
  }, [open, courseId]);

  const selectedCount = selected.size;
  const canSubmit = useMemo(() => {
    if (!courseId || !title.trim() || busy) return false;
    if (mode === "selected" && selectedCount === 0) return false;
    return true;
  }, [busy, courseId, mode, selectedCount, title]);

  if (!open) return null;

  const toggleStudent = (userId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectAllStudents = () => {
    setSelected(new Set(students.map((s) => s.userId)));
  };

  const clearStudents = () => setSelected(new Set());

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    setDone(null);

    const { activity, error } = await assignLessonToCourse({
      lessonId,
      courseId,
      title: title.trim(),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      maxPoints,
      studentIds: mode === "selected" ? [...selected] : [],
    });

    setBusy(false);
    if (error || !activity) {
      setErr(error || "No se pudo asignar la lección.");
      return;
    }
    setDone(activity);
  };

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--assign-lesson"
        role="dialog"
        aria-labelledby="assign-lesson-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="assign-lesson-title" className="pbc-modal__title">
          Asignar lección
        </h2>
        <p className="pbc-modal--assign-lesson__subtitle">
          Creá una actividad en un curso con el contenido de{" "}
          <strong>{lessonTitle || "esta lección"}</strong>
          {contentTitle ? ` (${contentTitle})` : ""}.
        </p>

        {done ? (
          <div className="pbc-assign-done">
            <p className="pbc-assign-done__msg">
              Actividad creada: <strong>{done.title}</strong>
            </p>
            <div className="pbc-modal__actions">
              <Link className="pbc-btn pbc-btn--primary" to={`/actividad/${done.id}`}>
                Abrir actividad
              </Link>
              <Link
                className="pbc-btn pbc-btn--ghost"
                to={`/dashboard/classes/${done.course_id}`}
              >
                Ir al curso
              </Link>
              <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pbc-modal__field">
              <label className="pbc-label" htmlFor="assign-title">
                Título de la actividad
              </label>
              <input
                id="assign-title"
                className="pbc-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div className="pbc-modal__field">
              <label className="pbc-label" htmlFor="assign-course">
                Curso
              </label>
              <select
                id="assign-course"
                className="pbc-input"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                required
                disabled={busy || loadingCourses}
              >
                <option value="">
                  {loadingCourses ? "Cargando cursos…" : "Elegí un curso"}
                </option>
                {courses.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_title}
                    {c.org_name ? ` · ${c.org_name}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="pbc-modal__field pbc-assign-mode">
              <legend className="pbc-label">Destinatarios</legend>
              <label className="pbc-assign-mode__option">
                <input
                  type="radio"
                  name="assign-mode"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                  disabled={busy}
                />
                Todo el curso
              </label>
              <label className="pbc-assign-mode__option">
                <input
                  type="radio"
                  name="assign-mode"
                  checked={mode === "selected"}
                  onChange={() => setMode("selected")}
                  disabled={busy}
                />
                Alumnos seleccionados
              </label>
            </fieldset>

            {mode === "selected" ? (
              <div className="pbc-modal__field">
                <div className="pbc-assign-students__toolbar">
                  <span className="pbc-label">
                    Alumnos {loadingStudents ? "(cargando…)" : `(${selectedCount}/${students.length})`}
                  </span>
                  <div className="pbc-assign-students__actions">
                    <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={selectAllStudents} disabled={busy || !students.length}>
                      Todos
                    </button>
                    <button type="button" className="pbc-btn pbc-btn--ghost pbc-btn--sm" onClick={clearStudents} disabled={busy || selectedCount === 0}>
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="pbc-assign-students">
                  {students.length === 0 && !loadingStudents ? (
                    <p className="pbc-modal--assign-lesson__subtitle">No hay alumnos en este curso.</p>
                  ) : (
                    students.map((s) => (
                      <label key={s.userId} className="pbc-assign-students__row">
                        <input
                          type="checkbox"
                          checked={selected.has(s.userId)}
                          onChange={() => toggleStudent(s.userId)}
                          disabled={busy}
                        />
                        <span>
                          {s.displayName}
                          {s.email ? <small> · {s.email}</small> : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <div className="pbc-assign-meta">
              <div className="pbc-modal__field">
                <label className="pbc-label" htmlFor="assign-due">
                  Fecha de entrega
                </label>
                <input
                  id="assign-due"
                  type="datetime-local"
                  className="pbc-input"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="pbc-modal__field">
                <label className="pbc-label" htmlFor="assign-points">
                  Puntaje máximo
                </label>
                <input
                  id="assign-points"
                  type="number"
                  min="0"
                  step="0.5"
                  className="pbc-input"
                  value={maxPoints}
                  onChange={(e) => setMaxPoints(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

            <div className="pbc-modal__actions">
              <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="pbc-btn pbc-btn--primary" disabled={!canSubmit}>
                {busy ? "Asignando…" : "Asignar"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
