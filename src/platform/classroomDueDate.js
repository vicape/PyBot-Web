/**
 * Conversión determinística PyBot due_at ↔ Google Classroom dueDate/dueTime (P10).
 * Google documenta dueTime en UTC. No usar getHours()/getTimezoneOffset del host de tests.
 */

/**
 * @param {string|null|undefined} iso
 * @returns {{ dueDate: {year:number,month:number,day:number}|null, dueTime: {hours:number,minutes:number}|null }}
 */
export function pybotDueAtToClassroomParts(iso) {
  if (!iso) return { dueDate: null, dueTime: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dueDate: null, dueTime: null };
  return {
    dueDate: {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    },
    dueTime: {
      hours: d.getUTCHours(),
      minutes: d.getUTCMinutes(),
    },
  };
}

/**
 * @param {{ year?: number, month?: number, day?: number }|null|undefined} dueDate
 * @param {{ hours?: number, minutes?: number, seconds?: number }|null|undefined} dueTime
 * @returns {string|null} ISO UTC
 */
export function classroomDuePartsToIso(dueDate, dueTime = null) {
  if (!dueDate?.year || !dueDate?.month || !dueDate?.day) return null;
  const y = Number(dueDate.year);
  const m = Number(dueDate.month);
  const day = Number(dueDate.day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;

  let hh = 23;
  let mm = 59;
  let ss = 0;
  if (dueTime && (dueTime.hours != null || dueTime.minutes != null)) {
    hh = Number(dueTime.hours ?? 0);
    mm = Number(dueTime.minutes ?? 0);
    ss = Number(dueTime.seconds ?? 0);
  }
  if (![hh, mm, ss].every((n) => Number.isFinite(n))) return null;

  const iso = new Date(Date.UTC(y, m - 1, day, hh, mm, ss)).toISOString();
  return iso;
}

/**
 * Round-trip smoke: iso → parts → iso (minuto resolution).
 * @param {string} iso
 */
export function roundTripClassroomDueAt(iso) {
  const { dueDate, dueTime } = pybotDueAtToClassroomParts(iso);
  return classroomDuePartsToIso(dueDate, dueTime);
}
