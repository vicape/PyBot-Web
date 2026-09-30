import { t } from "../../../i18n.js";
import { useEffect, useState } from "react";
import { COUNTRIES } from "../../../data/countries.js";
import {
  createInstitutionalCourse,
  createPersonalCourse,
} from "../../../platform/courseCreateApi.js";
import {
  createOrganizationWithOwner,
  ensureOrgTeacherAccess,
  fetchOrganizationsForUser,
} from "../../../platform/organizationApi.js";

/**
 * Create course modal — personal course is the default path (no institution required).
 * Optional institutional attachment remains available when the person already has orgs.
 */
export default function CreateCourseModal({ open, onClose, supabase, user, onCreated }) {
  const [mode, setMode] = useState("personal"); // personal | institution
  const [orgs, setOrgs] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [createOrg, setCreateOrg] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [countryCode, setCountryCode] = useState("AR");
  const [courseTitle, setCourseTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !supabase || !user) return;
    void (async () => {
      const rows = await fetchOrganizationsForUser(supabase, user.id);
      setOrgs(rows);
      if (rows.length === 1) setSelectedOrgId(rows[0].id);
    })();
  }, [open, supabase, user]);

  useEffect(() => {
    if (!open) {
      setMode("personal");
      setCreateOrg(false);
      setOrgName("");
      setCourseTitle("");
      setErr("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submitPersonal = async () => {
    const title = courseTitle.trim();
    if (!title) {
      setErr(t("pcEnterCourseName"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { courseId, error } = await createPersonalCourse({ title });
      if (error || !courseId) {
        setErr(error || t("pcUnexpectedError"));
        setBusy(false);
        return;
      }
      onCreated?.();
      onClose?.();
    } catch (ex) {
      setErr(ex?.message || t("pcUnexpectedError"));
    }
    setBusy(false);
  };

  const submitInstitutional = async () => {
    let orgId = selectedOrgId;
    setBusy(true);
    setErr("");

    try {
      if (createOrg || !orgId) {
        const { orgId: newId, error } = await createOrganizationWithOwner({
          name: orgName,
          countryCode,
        });
        if (error || !newId) {
          setErr(error || t("pcCreateOrgFail"));
          setBusy(false);
          return;
        }
        orgId = newId;
      } else {
        const access = await ensureOrgTeacherAccess(orgId);
        if (!access.ok) {
          setErr(access.error || t("pcNoCourseCreatePermission"));
          setBusy(false);
          return;
        }
      }

      const title = courseTitle.trim();
      if (!title) {
        setErr(t("pcEnterCourseName"));
        setBusy(false);
        return;
      }

      const { courseId, error } = await createInstitutionalCourse({
        orgId,
        title,
        userId: user.id,
      });

      if (error || !courseId) {
        setErr(error || t("pcUnexpectedError"));
        setBusy(false);
        return;
      }

      onCreated?.();
      onClose?.();
    } catch (ex) {
      setErr(ex?.message || t("pcUnexpectedError"));
    }
    setBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!supabase || !user || busy) return;
    if (mode === "personal") {
      await submitPersonal();
      return;
    }
    await submitInstitutional();
  };

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pbc-modal"
        role="dialog"
        aria-labelledby="create-course-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-course-title" className="pbc-modal__title">
          {t("pcCreateCourse")}
        </h2>
        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <form onSubmit={submit}>
          <div className="pbc-filter-tabs" role="tablist" aria-label={t("pcCreateCourse")} style={{ marginBottom: 12 }}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "personal"}
              className={`pbc-filter-tab${mode === "personal" ? " pbc-filter-tab--active" : ""}`}
              onClick={() => {
                setMode("personal");
                setErr("");
              }}
            >
              {t("pcPersonalCourse")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "institution"}
              className={`pbc-filter-tab${mode === "institution" ? " pbc-filter-tab--active" : ""}`}
              onClick={() => {
                setMode("institution");
                setErr("");
              }}
            >
              {t("pcInstitutionalCourse")}
            </button>
          </div>

          {mode === "personal" ? (
            <>
              <p className="pbc-modal__step-label">{t("pcPersonalCourseHint")}</p>
              <div className="pbc-modal__field">
                <label className="pbc-label" htmlFor="course-title-personal">
                  {t("pcCourseName")}
                </label>
                <input
                  id="course-title-personal"
                  className="pbc-input"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder={t("pcCoursePlaceholder")}
                  required
                  autoFocus
                />
              </div>
              <div className="pbc-modal__actions">
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
                  {t("pcCancel")}
                </button>
                <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
                  {busy ? t("pcCreating") : t("pcCreateCourse")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="pbc-modal__step-label">{t("pcStep1Institution")}</p>
              {orgs.length > 0 ? (
                <div className="pbc-modal__field">
                  <label className="pbc-label" htmlFor="org-select">
                    {t("pcChooseExistingInstitution")}
                  </label>
                  <select
                    id="org-select"
                    className="pbc-select"
                    value={createOrg ? "" : selectedOrgId}
                    onChange={(e) => {
                      setCreateOrg(false);
                      setSelectedOrgId(e.target.value);
                    }}
                    disabled={createOrg}
                  >
                    <option value="">— {t("pcSelect")} —</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <button
                type="button"
                className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                onClick={() => setCreateOrg((v) => !v)}
              >
                {createOrg ? t("pcUseExistingInstitution") : t("pcCreateNewInstitution")}
              </button>

              {createOrg || orgs.length === 0 ? (
                <>
                  <div className="pbc-modal__field">
                    <label className="pbc-label" htmlFor="org-name">
                      {t("pcInstitutionName")}
                    </label>
                    <input
                      id="org-name"
                      className="pbc-input"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder={t("pcOrgPlaceholder")}
                      required={mode === "institution"}
                    />
                  </div>
                  <div className="pbc-modal__field">
                    <label className="pbc-label" htmlFor="org-country">
                      {t("pcCountry")}
                    </label>
                    <select
                      id="org-country"
                      className="pbc-select"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      required={mode === "institution"}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}

              <div className="pbc-modal__field">
                <label className="pbc-label" htmlFor="course-title-org">
                  {t("pcCourseName")}
                </label>
                <input
                  id="course-title-org"
                  className="pbc-input"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder={t("pcCoursePlaceholder")}
                  required
                />
              </div>

              <div className="pbc-modal__actions">
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
                  {t("pcCancel")}
                </button>
                <button
                  type="submit"
                  className="pbc-btn pbc-btn--primary"
                  disabled={busy}
                  onClick={(e) => {
                    if (createOrg || orgs.length === 0) {
                      if (!orgName.trim()) {
                        e.preventDefault();
                        setErr(t("pcEnterInstitutionName"));
                      }
                    } else if (!selectedOrgId) {
                      e.preventDefault();
                      setErr(t("pcChooseInstitution"));
                    }
                  }}
                >
                  {busy ? t("pcCreating") : t("pcCreateCourse")}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
