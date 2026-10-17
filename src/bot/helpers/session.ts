import type { BotSession } from "../../types.js";
import type { BotContext } from "../types.js";
import type { CalendarPhase } from "../keyboards/calendar.keyboard.js";

export function clearTransient(data: BotSession): void {
  data.stage = "idle";
  delete data.selectedStart;
  delete data.selectedScheduleView;
  delete data.calendarMessageId;
  delete data.announcementComposer;
}

export async function withSessionLock(ctx: BotContext, operation: () => Promise<void>): Promise<void> {
  if (ctx.session.busy) {
    await ctx.reply("Попередній запит ще виконується. Зачекайте, будь ласка.");
    return;
  }
  ctx.session.busy = true;
  try { await operation(); } finally { ctx.session.busy = false; }
}

export function isCurrentCalendar(ctx: BotContext, phase?: CalendarPhase): boolean {
  const message = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  const expected = phase === "from" ? "choosing_start" : phase === "to" ? "choosing_end" : undefined;
  return Boolean(message && message.message_id === ctx.session.calendarMessageId && (!expected || ctx.session.stage === expected));
}

export function isTelegramNotModified(error: unknown): boolean {
  return error instanceof Error && /message is not modified/i.test(error.message);
}
