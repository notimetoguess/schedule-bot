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
