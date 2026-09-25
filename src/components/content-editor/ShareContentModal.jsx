import { useEffect, useState } from "react";
import { t } from "../../i18n.js";
import {
  CONTENT_VISIBILITY,
  COMMUNITY_METADATA_REQUIRED_HINT,
  listContentCourseAccess,
  listTeacherCoursesForShare,
  setContentSharing,
} from "../../platform/contentShareApi.js";

function visibilityLabel(key) {
  if (key === CONTENT_VISIBILITY.private) return t("pcPrivate");
  if (key === CONTENT_VISIBILITY.courses) return t("pcVisibilityCoursesShare");
  if (key === CONTENT_VISIBILITY.community) return t("pcVisibilityCommunityShare");
  return key;
}

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
      setErr(
        error === COMMUNITY_METADATA_REQUIRED_HINT || /Comunidad|Community|comunidad/i.test(String(error || ""))
          ? t("pcCommunityMetaRequired")
          : error || t("pcShareSaveFail"),
      );
      return;
    }
    onSaved?.(saved);
    onClose?.();
  };

  return (
    <div className="pbc-modal-backdrop pbc-modal-backdrop--create-content" role="presentation" onClick={onClose}>
      <form
        className="pbc-modal pbc-modal--create-content pbc-modal--assign-lesson"
        role="dialog"
        aria-labelledby="share-content-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="share-content-title" className="pbc-modal__title">
          {t("pcShare")}
        </h2>
        <p className="pbc-modal--create-content__subtitle">
          {t("pcShareLead").replace("{title}", content?.title || "")}
        </p>

        <fieldset className="pbc-modal__field pbc-assign-mode">
          <legend className="pbc-label">{t("pcVisibility")}</legend>
          {Object.keys(CONTENT_VISIBILITY).map((key) => (
            <label key={key} className="pbc-assign-mode__option">
              <input
                type="radio"
                name="share-vis"
                checked={visibility === key}
                onChange={() => setVisibility(key)}
                disabled={busy || loading}
              />
              {visibilityLabel(key)}
            </label>
          ))}
        </fieldset>

        {visibility === CONTENT_VISIBILITY.courses ? (
          <div className="pbc-modal__field">
            <span className="pbc-label">{t("pcCoursesReadAccess")}</span>
            <div className="pbc-assign-students pbc-assign-students--spaced">
              {courses.length === 0 ? (
                <p className="pbc-modal--create-content__subtitle">{t("pcNoTeacherCoursesShare")}</p>
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

        {err ? (
          <p className="pbc-alert pbc-alert--error" role="alert">
            {err}
          </p>
        ) : null}

        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose} disabled={busy}>
            {t("pcCancel")}
          </button>
          <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy || loading}>
            {busy ? t("pcSaving") : t("pcSave")}
          </button>
        </div>
      </form>
    </div>
  );
}
