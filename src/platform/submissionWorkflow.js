/**
 * Dimensiones académicas PyBotClass (independientes):
 * A) estado del proceso  B) puntualidad  C) ventana de entrega
 */

export const PROCESS_STATUS = {
  IN_PROGRESS: "en_progreso",
  SUBMITTED: "entregado",
  REVIEW_REQUESTED: "revision_solicitada",
  RESUBMITTED: "reentregado",
  GRADED: "evaluado",
  CLOSED: "cerrado",
};

export const TIMELINESS = {
  ON_TIME: "a_tiempo",
  LATE: "tarde",
  UNKNOWN: "sin_dato",
};

export const WINDOW = {
  OPEN: "abierta",
  CLOSED: "cerrada",
};

/**
 * Deriva el estado de proceso visible a partir del status DB + versión.
 * DB: draft | submitted | returned | graded | closed
 * Reentregado = submitted con version >= 2 (tras ciclo previo).
 */
export function deriveProcessStatus({ status, version, hasSubmission } = {}) {
  if (!hasSubmission && !status) return PROCESS_STATUS.IN_PROGRESS;
  switch (status) {
    case "draft":
      return PROCESS_STATUS.IN_PROGRESS;
    case "returned":
      return PROCESS_STATUS.REVIEW_REQUESTED;
    case "graded":
      return PROCESS_STATUS.GRADED;
    case "closed":
      return PROCESS_STATUS.CLOSED;
    case "submitted": {
      const v = Number(version) || 1;
      return v >= 2 ? PROCESS_STATUS.RESUBMITTED : PROCESS_STATUS.SUBMITTED;
    }
    default:
      return hasSubmission ? PROCESS_STATUS.SUBMITTED : PROCESS_STATUS.IN_PROGRESS;
  }
}

export function processStatusLabelEs(processStatus) {
  switch (processStatus) {
    case PROCESS_STATUS.IN_PROGRESS:
      return "En progreso";
    case PROCESS_STATUS.SUBMITTED:
      return "Entregado";
    case PROCESS_STATUS.REVIEW_REQUESTED:
      return "Revisión solicitada";
    case PROCESS_STATUS.RESUBMITTED:
      return "Reentregado";
    case PROCESS_STATUS.GRADED:
      return "Evaluado";
    case PROCESS_STATUS.CLOSED:
      return "Cerrado";
    default:
      return processStatus || "—";
  }
}

/** Mensaje de acción siguiente para el alumno. */
export function studentNextActionMessage(processStatus) {
  switch (processStatus) {
    case PROCESS_STATUS.IN_PROGRESS:
      return "Completá tu trabajo y presentá la actividad.";
    case PROCESS_STATUS.SUBMITTED:
    case PROCESS_STATUS.RESUBMITTED:
      return "Esperando revisión del docente.";
    case PROCESS_STATUS.REVIEW_REQUESTED:
      return "Tu docente solicitó cambios. Modificá tu trabajo y presentá nuevamente.";
    case PROCESS_STATUS.GRADED:
      return "Tu trabajo fue evaluado. Revisá la nota y el feedback.";
    case PROCESS_STATUS.CLOSED:
      return "Evaluación final cerrada.";
    default:
      return "";
  }
}

export function deriveTimeliness({ submittedAt, dueAt } = {}) {
  if (!submittedAt || !dueAt) return TIMELINESS.UNKNOWN;
  const sub = Date.parse(submittedAt);
  const due = Date.parse(dueAt);
  if (!Number.isFinite(sub) || !Number.isFinite(due)) return TIMELINESS.UNKNOWN;
  return sub > due ? TIMELINESS.LATE : TIMELINESS.ON_TIME;
}

export function timelinessLabelEs(t) {
  switch (t) {
    case TIMELINESS.ON_TIME:
      return "A tiempo";
    case TIMELINESS.LATE:
      return "Tarde";
    default:
      return null;
  }
}

/**
 * Ventana de recepción.
 * Si no hay closeAt: abierta (entregas tardías permitidas tras due_at).
 * reopenActive anula el cierre global / closed para ese alumno.
 */
export function deriveSubmissionWindow({ closeAt, now = Date.now(), reopenActive = false } = {}) {
  if (reopenActive) return WINDOW.OPEN;
  if (!closeAt) return WINDOW.OPEN;
  const close = Date.parse(closeAt);
  if (!Number.isFinite(close)) return WINDOW.OPEN;
  return now > close ? WINDOW.CLOSED : WINDOW.OPEN;
}

export function windowLabelEs(w) {
  return w === WINDOW.CLOSED ? "Cerrada" : "Abierta";
}

/**
 * ¿Puede el alumno presentar una nueva versión formal?
 */
export function canStudentSubmit({
  processStatus,
  windowStatus,
  reopenActive = false,
} = {}) {
  if (processStatus === PROCESS_STATUS.CLOSED && !reopenActive) return false;
  if (windowStatus === WINDOW.CLOSED && !reopenActive) return false;
  if (processStatus === PROCESS_STATUS.GRADED && !reopenActive) return false;
  // Entregado / Reentregado: puede seguir editando progress, pero re-presentar
  // solo tiene sentido tras revisión o si aún no cerró el ciclo (permitimos
  // nueva versión solo desde en_progreso o revisión_solicitada, o reopen).
  if (
    processStatus === PROCESS_STATUS.SUBMITTED ||
    processStatus === PROCESS_STATUS.RESUBMITTED
  ) {
    return false;
  }
  return (
    processStatus === PROCESS_STATUS.IN_PROGRESS ||
    processStatus === PROCESS_STATUS.REVIEW_REQUESTED ||
    reopenActive
  );
}

/** Filtros de bandeja docente (proceso, no puntualidad). */
export const INBOX_FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "no_entregadas", label: "No entregadas" },
  { id: "por_corregir", label: "Por corregir" },
  { id: "revision_solicitada", label: "Revisión solicitada" },
  { id: "reentregadas", label: "Reentregadas" },
  { id: "evaluadas", label: "Evaluadas" },
  { id: "cerradas", label: "Cerradas" },
];

export function deriveInboxFilterId(row) {
  if (!row?.submission_id) return "no_entregadas";
  const process = deriveProcessStatus({
    status: row.submission_status,
    version: row.submission_version,
    hasSubmission: true,
  });
  switch (process) {
    case PROCESS_STATUS.SUBMITTED:
      return "por_corregir";
    case PROCESS_STATUS.REVIEW_REQUESTED:
      return "revision_solicitada";
    case PROCESS_STATUS.RESUBMITTED:
      return "reentregadas";
    case PROCESS_STATUS.GRADED:
      return "evaluadas";
    case PROCESS_STATUS.CLOSED:
      return "cerradas";
    default:
      return "no_entregadas";
  }
}

/** Suma de puntajes de rúbrica; null si vacío. */
export function sumRubricPoints(scores) {
  if (!Array.isArray(scores) || scores.length === 0) return null;
  let total = 0;
  for (const s of scores) {
    const n = Number(s?.points);
    if (!Number.isFinite(n)) return null;
    total += n;
  }
  return total;
}

export function rubricMaxSum(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  let total = 0;
  for (const c of criteria) {
    const n = Number(c?.max_points ?? c?.maxPoints);
    if (!Number.isFinite(n)) return null;
    total += n;
  }
  return total;
}

export function rubricMatchesActivityMax(criteria, maxPoints) {
  const sum = rubricMaxSum(criteria);
  const max = Number(maxPoints);
  if (sum == null || !Number.isFinite(max)) return false;
  return Math.abs(sum - max) < 0.0001;
}
