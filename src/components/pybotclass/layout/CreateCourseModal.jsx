import { useEffect, useState } from "react";
import { COUNTRIES } from "../../../data/countries.js";
import {
  createOrganizationWithOwner,
  ensureOrgTeacherAccess,
  fetchOrganizationsForUser,
} from "../../../platform/organizationApi.js";
import { slugifyOrganizationName } from "../../../slugify.js";

export default function CreateCourseModal({ open, onClose, supabase, user, onCreated }) {
  const [step, setStep] = useState(1);
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
      setStep(1);
      setCreateOrg(false);
      setOrgName("");
      setCourseTitle("");
      setErr("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!supabase || !user || busy) return;
    setBusy(true);
    setErr("");

    let orgId = selectedOrgId;

    try {
      if (createOrg || !orgId) {
        const { orgId: newId, error } = await createOrganizationWithOwner({
          name: orgName,
          countryCode,
        });
        if (error || !newId) {
          setErr(error || "No se pudo crear la institución.");
          setBusy(false);
          return;
        }
        orgId = newId;
      } else {
        const access = await ensureOrgTeacherAccess(orgId);
        if (!access.ok) {
          setErr(access.error || "Sin permiso para crear curso en esa institución.");
          setBusy(false);
          return;
        }
      }

      const title = courseTitle.trim();
      if (!title) {
        setErr("Ingresá el nombre del curso.");
        setBusy(false);
        return;
      }

      const { error } = await supabase.from("courses").insert({
        org_id: orgId,
        title,
        slug: slugifyOrganizationName(title),
        created_by: user.id,
      });

      if (error) {
        setErr(error.message);
        setBusy(false);
        return;
      }

      onCreated?.();
      onClose?.();
    } catch (ex) {
      setErr(ex?.message || "Error inesperado.");
    }
    setBusy(false);
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
          Crear curso
        </h2>
        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

        <form onSubmit={submit}>
          {step === 1 ? (
            <>
              <p className="pbc-modal__step-label">Paso 1 — Institución</p>
              {orgs.length > 0 ? (
                <div className="pbc-modal__field">
                  <label className="pbc-label" htmlFor="org-select">
                    Elegir institución existente
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
                    <option value="">— Seleccionar —</option>
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
                {createOrg ? "Usar institución existente" : "+ Crear nueva institución"}
              </button>

              {createOrg || orgs.length === 0 ? (
                <>
                  <div className="pbc-modal__field">
                    <label className="pbc-label" htmlFor="org-name">
                      Nombre de la institución
                    </label>
                    <input
                      id="org-name"
                      className="pbc-input"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Ej. St. Andrew's Scots School"
                      required
                    />
                  </div>
                  <div className="pbc-modal__field">
                    <label className="pbc-label" htmlFor="org-country">
                      País
                    </label>
                    <select
                      id="org-country"
                      className="pbc-select"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      required
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

              <div className="pbc-modal__actions">
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="pbc-btn pbc-btn--primary"
                  onClick={() => {
                    if (createOrg || orgs.length === 0) {
                      if (!orgName.trim()) {
                        setErr("Ingresá el nombre de la institución.");
                        return;
                      }
                    } else if (!selectedOrgId) {
                      setErr("Elegí una institución.");
                      return;
                    }
                    setErr("");
                    setStep(2);
                  }}
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="pbc-modal__step-label">Paso 2 — Curso</p>
              <div className="pbc-modal__field">
                <label className="pbc-label" htmlFor="course-title">
                  Nombre del curso
                </label>
                <input
                  id="course-title"
                  className="pbc-input"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="Ej. Python 8A"
                  required
                  autoFocus
                />
              </div>
              <div className="pbc-modal__actions">
                <button type="button" className="pbc-btn pbc-btn--ghost" onClick={() => setStep(1)}>
                  Atrás
                </button>
                <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
                  {busy ? "Creando…" : "Crear curso"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
