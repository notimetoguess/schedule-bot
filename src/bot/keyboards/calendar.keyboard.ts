import { DateTime } from "luxon";
import { Markup } from "telegraf";
import { KYIV_ZONE } from "../../schedule/dates.js";

export type CalendarPhase = "from" | "to";

const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];

export function calendarKeyboard(phase: CalendarPhase, monthIso: string) {
  const month = DateTime.fromISO(`${monthIso}-01`, { zone: KYIV_ZONE }).startOf("month");
  if (!month.isValid) throw new Error("Invalid calendar month");

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  rows.push([Markup.button.callback(`${MONTHS[month.month - 1]} ${month.year}`, "cal:noop")]);
  rows.push(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((day) => Markup.button.callback(day, "cal:noop")));

  let row: ReturnType<typeof Markup.button.callback>[] = [];
  for (let i = 1; i < month.weekday; i += 1) row.push(Markup.button.callback(" ", "cal:noop"));
  for (let day = 1; day <= month.daysInMonth!; day += 1) {
    const date = month.set({ day });
    row.push(Markup.button.callback(String(day), `cal:pick:${phase}:${date.toISODate()}`));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  while (row.length > 0 && row.length < 7) row.push(Markup.button.callback(" ", "cal:noop"));
  if (row.length) rows.push(row);

  rows.push([
    Markup.button.callback("‹", `cal:nav:${phase}:${month.minus({ months: 1 }).toFormat("yyyy-MM")}`),
    Markup.button.callback("Скасувати", "cal:cancel"),
    Markup.button.callback("›", `cal:nav:${phase}:${month.plus({ months: 1 }).toFormat("yyyy-MM")}`),
  ]);
  return Markup.inlineKeyboard(rows);
}
