import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n.js";
import {
  assignContentSourceToCourse,
  listCourseStudents,
  listTeacherCoursesForAssign,
} from "../../platform/contentAssignApi.js";

const SOURCE_KEYS = {
  content: "pcSource_content",
  unit: "pcSource_unit",
  lesson: "pcSource_lesson",
  exercise: "pcSource_exercise",
  task: "pcSource_task",
};

/**
 * Modal de asignación con snapshot.
 * Props: sourceType, sourceId, defaultTitle, contextLabel, blockId?, blockProps?
 */
export default function AssignLessonModal({
  open,
  onClose,
  lessonId,
  lessonTitle,
  contentTitle,
  sourceType: sourceTypeProp,
  sourceId: sourceIdProp,
  defaultTitle,
  contextLabel,
  blockId,
  blockProps,
  defaultCourseId = null,
}) {
  const sourceType = sourceTypeProp || "lesson";
  const sourceId = sourceIdProp || lessonId;
  const initialTitle = defaultTitle || lessonTitle || "";

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
    setTitle(initialTitle);
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
      const preferred =
        defaultCourseId && rows.some((r) => r.course_id === defaultCourseId)
          ? defaultCourseId
          : rows.length === 1
            ? rows[0].course_id
            : "";
      if (preferred) setCourseId(preferred);
      if (rows.length === 0) {
        setErr(t("pcAssignNoTeacherCourses"));
      }
    })();
  }, [open, initialTitle, defaultCourseId]);

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

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    setDone(null);

    const { activity, error } = await assignContentSourceToCourse({
      sourceType,
      sourceId,
      courseId,
      title: title.trim(),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      maxPoints,
      studentIds: mode === "selected" ? [...selected] : [],
      blockId,
      blockProps,
    });

    setBusy(false);
    if (error || !activity) {
      setErr(error || t("pcAssignFail"));
      return;
    }
    setDone(activity);
  };

  const sourceKey = SOURCE_KEYS[sourceType];
  const label = (sourceKey ? t(sourceKey) : null) || contextLabel || t("pcSource_content");
  const heading = t("pcAssignHeading").replace("{label}", label);
  const labelWithTitle = contentTitle ? `${label} («${contentTitle}»)` : label;
  const lead = t("pcAssignSnapshotLead").replace("{label}", labelWithTitle);

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--create-content pbc-modal--assign-lesson"
        role="dialog"
        aria-labelledby="assign-lesson-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="assign-lesson-title" className="pbc-modal__title">
          {heading}
        </h2>
        <p className="pbc-modal--create-content__subtitle">{lead}</p>

        {done ? (
          <div className="pbc-assign-done">
            <p className="pbc-assign-done__msg">
              {t("pcAssignActivityCreated")} <strong>{done.title}</strong>
            </p>
            <div className="pbc-modal__actions">
              <Link className="pbc-btn pbc-btn--primary" to={`/actividad/${done.id}`}>
                {t("pcAssignOpenActivity")}
              </Link>
              <Link className="pbc-btn pbc-btn--ghost" to={`/dashboard/classes/${done.course_id}`}>
                {t("pcAssignGoToCourse")}
              </Link>
              <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
                {t("pcClose")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pbc-modal__field">
              <label className="pbc-label" htmlFor="assign-title">
                {t("pcAssignActivityTitle")}
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
                {t("pcCourses")}
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
                  {loadingCourses ? t("pcAssignLoadingCourses") : t("pcAssignPickCourse")}
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
              <legend className="pbc-label">{t("pcAssignRecipients")}</legend>
              <label className="pbc-assign-mode__option">
                <input
                  type="radio"
                  name="assign-mode"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                  disabled={busy}
                />
                {t("pcAssignWholeCourse")}
              </label>
              <label className="pbc-assign-mode__option">
                <input
                  type="radio"
                  name="assign-mode"
                  checked={mode === "selected"}
                  onChange={() => setMode("selected")}
                  disabled={busy}
                />
                {t("pcAssignSelectedStudents")}
              </label>
            </fieldset>

            {mode === "selected" ? (
              <div className="pbc-modal__field">
                <div className="pbc-assign-students__toolbar">
                  <span className="pbc-label">
                    {loadingStudents
                      ? t("pcAssignStudentsLoading")
                      : t("pcAssignStudentsCount")
                          .replace("{selected}", String(selectedCount))
                          .replace("{total}", String(students.length))}
                  </span>
                  <div className="pbc-assign-students__actions">
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={() => setSelected(new Set(students.map((s) => s.userId)))}
                      disabled={busy || !students.length}
                    >
                      {t("pcAssignAll")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={() => setSelected(new Set())}
                      disabled={busy || selectedCount === 0}
                    >
                      {t("pcAssignNone")}
                    </button>
                  </div>
                </div>
                <div className="pbc-assign-students">
                  {students.length === 0 && !loadingStudents ? (
                    <p className="pbc-modal--create-content__subtitle">{t("pcAssignNoStudents")}</p>
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
                  {t("pcDueDate")}
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
                  {t("pcMaxPoints")}
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

            {err ? (
              <p className="pbc-alert pbc-alert--error" role="alert">
                {err}
              </p>
            ) : null}

            <div className="pbc-modal__actions">
              <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
                {t("pcCancel")}
              </button>
              <button type="submit" className="pbc-btn pbc-btn--primary" disabled={!canSubmit}>
                {busy ? t("pcSaving") : t("pcAssign")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
