import { getLang, t } from "../../i18n.js";

const LOCALES = {
  es: "es-AR",
  en: "en-US",
  fr: "fr-FR",
  pt: "pt-BR",
  de: "de-DE",
};

const PROCESS_KEYS = {
  en_progreso: "pcStatusInProgress",
  entregado: "pcStatusSubmitted",
  revision_solicitada: "pcStatusReviewRequested",
  reentregado: "pcStatusResubmitted",
  evaluado: "pcStatusGraded",
  cerrado: "pcStatusClosed",
};

const FILTER_KEYS = {
  todas: "pcFilterAll",
  no_entregadas: "pcFilterNotSubmitted",
  por_corregir: "pcFilterToGrade",
  revision_solicitada: "pcFilterReviewRequested",
  reentregadas: "pcFilterResubmitted",
  evaluadas: "pcFilterGraded",
  cerradas: "pcFilterClosed",
};

export function processStatusLabel(status) {
  return PROCESS_KEYS[status] ? t(PROCESS_KEYS[status]) : status || "—";
}

export function timelinessLabel(status) {
  if (status === "a_tiempo") return t("pcOnTime");
  if (status === "tarde") return t("pcLate");
  return null;
}

export function submissionOverviewLabel(status) {
  switch (status) {
    case "no_entregadas":
    case "no_entrego":
      return t("pcOverviewNotSubmitted");
    case "por_corregir":
      return t("pcFilterToGrade");
    case "revision_solicitada":
      return t("pcFilterReviewRequested");
    case "reentregadas":
      return t("pcOverviewResubmitted");
    case "evaluadas":
    case "corregida":
      return t("pcOverviewGraded");
    case "cerradas":
      return t("pcOverviewClosed");
    default:
      return processStatusLabel(status);
  }
}

export function inboxFilterLabel(id) {
  return FILTER_KEYS[id] ? t(FILTER_KEYS[id]) : id;
}

export function localizeInboxFilters(filters) {
  return (filters || []).map((item) => ({ ...item, label: inboxFilterLabel(item.id) }));
}

export function formatDueDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(LOCALES[getLang()] || LOCALES.es, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return null;
  }
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(LOCALES[getLang()] || LOCALES.es, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
