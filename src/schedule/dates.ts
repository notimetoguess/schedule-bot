import { DateTime } from "luxon";

export const KYIV_ZONE = "Europe/Kyiv";

export interface DateRange {
  from: string;
  to: string;
}

export function todayRange(now: DateTime = DateTime.now().setZone(KYIV_ZONE)): DateRange {
  const today = now.setZone(KYIV_ZONE).toISODate()!;
  return { from: today, to: today };
}

export function currentAcademicWeekRange(now: DateTime = DateTime.now().setZone(KYIV_ZONE)): DateRange | null {
  const today = now.setZone(KYIV_ZONE).startOf("day");
  if (today.weekday === 7) return null;
  return { from: today.toISODate()!, to: today.set({ weekday: 6 }).toISODate()! };
}

export function nextAcademicWeekRange(now: DateTime = DateTime.now().setZone(KYIV_ZONE)): DateRange {
  const nextMonday = now.setZone(KYIV_ZONE).startOf("week").plus({ weeks: 1 });
  return { from: nextMonday.toISODate()!, to: nextMonday.plus({ days: 5 }).toISODate()! };
}

export function toApiDateRange(range: DateRange): { dateFrom: string; dateTo: string } {
  const from = DateTime.fromISO(range.from, { zone: KYIV_ZONE }).startOf("day");
  const to = DateTime.fromISO(range.to, { zone: KYIV_ZONE }).endOf("day");
  if (!from.isValid || !to.isValid) throw new Error("Invalid date range");
  return { dateFrom: from.toISO()!, dateTo: to.toISO()! };
}

export function isIsoDate(value: string): boolean {
  const parsed = DateTime.fromISO(value, { zone: KYIV_ZONE });
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.isValid && parsed.toISODate() === value;
}

/** Extracts "HH:mm" from "HH:mm", "…THH:mm…", or "yyyy-MM-dd HH:mm:ss". */
export function extractClock(value: string): string | null {
  const match = value.match(/(?:^|[T\s])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/);
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : null;
}

/** Kyiv calendar date (yyyy-MM-dd) for ISO or SQL-style WebDk dates. */
export function webDkDateKey(value: string): string {
  const iso = DateTime.fromISO(value, { setZone: true });
  if (iso.isValid) return iso.setZone(KYIV_ZONE).toISODate()!;
  const sql = DateTime.fromSQL(value, { zone: KYIV_ZONE });
  return sql.isValid ? sql.toISODate()! : value.slice(0, 10);
}
