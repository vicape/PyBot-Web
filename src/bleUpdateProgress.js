/**
 * Formateo de progreso OTA del runtime BLE (UI / logs).
 * Puro y testeable: no toca DOM ni i18n.
 */

/**
 * Normaliza un porcentaje de avance a entero 0..100.
 * @param {unknown} pct
 * @returns {number}
 */
export function normalizeUpdatePct(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Texto de progreso OTA según fase.
 * @param {string|null|undefined} phase
 * @param {unknown} pct
 * @param {{
 *   transfer: string,
 *   verifying: string,
 *   applying: string,
 *   reconnecting: string,
 *   restarting: string,
 *   finished: string,
 *   updating: string,
 * }} labels cadenas con opcional `{pct}` en `transfer`
 * @returns {string}
 */
export function formatBleUpdateProgressText(phase, pct, labels) {
  const p = normalizeUpdatePct(pct);
  switch (phase) {
    case "begin":
    case "start":
      return labels.transfer.replace("{pct}", "0");
    case "transfer":
      return labels.transfer.replace("{pct}", String(p));
    case "verified":
      return labels.verifying;
    case "applying":
      return labels.applying;
    case "reconnecting":
      return labels.reconnecting;
    case "verifying-version":
      return labels.restarting;
    case "done":
      return labels.finished;
    default:
      return labels.updating;
  }
}
