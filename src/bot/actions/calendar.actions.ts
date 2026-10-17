import type { Telegraf } from "telegraf";
import type { WebDkClient } from "../../integrations/webdk.js";
import { isIsoDate } from "../../schedule/dates.js";
import { userKey } from "../helpers/auth.js";
import { fetchAndReply, showMenu } from "../helpers/replies.js";
import { clearTransient, isCurrentCalendar, isTelegramNotModified, withSessionLock } from "../helpers/session.js";
import { calendarKeyboard, type CalendarPhase } from "../keyboards/calendar.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerCalendarActions(
  bot: Telegraf<BotContext>,
  webDk: WebDkClient,
  dependencies: BotDependencies,
): void {
  bot.action(/^cal:nav:(from|to):(\d{4}-\d{2})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const phase = ctx.match[1] as CalendarPhase;
    if (!isCurrentCalendar(ctx, phase)) return;
    try { await ctx.editMessageReplyMarkup(calendarKeyboard(phase, ctx.match[2]!).reply_markup); }
    catch (error) { if (!isTelegramNotModified(error)) throw error; }
  });

  bot.action(/^cal:pick:(from|to):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const phase = ctx.match[1] as CalendarPhase;
    const date = ctx.match[2]!;
    if (!isCurrentCalendar(ctx, phase) || !isIsoDate(date)) {
      await ctx.answerCbQuery("Цей календар вже неактивний.");
      return;
    }
    if (phase === "from") {
      await ctx.answerCbQuery();
      ctx.session.selectedStart = date;
      ctx.session.stage = "choosing_end";
      await ctx.editMessageText("Оберіть «Дата до»:", calendarKeyboard("to", date.slice(0, 7)));
      return;
    }
    const from = ctx.session.selectedStart;
    if (!from || date < from) {
      await ctx.answerCbQuery("«Дата до» не може бути раніше за «Дата з».", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const view = ctx.session.selectedScheduleView ?? "all";
    clearTransient(ctx.session);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); }
    catch (error) { if (!isTelegramNotModified(error)) throw error; }
    await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, { from, to: date }, view));
  });

  bot.action("cal:cancel", async (ctx) => {
    await ctx.answerCbQuery();
    if (!isCurrentCalendar(ctx)) return;
    clearTransient(ctx.session);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); }
    catch (error) { if (!isTelegramNotModified(error)) throw error; }
    if (await dependencies.authStore.get(userKey(ctx))) await showMenu(ctx, dependencies, "Вибір дат скасовано. Оберіть тип розкладу.");
  });
}

export function registerCalendarNoopAction(bot: Telegraf<BotContext>): void {
  bot.action("cal:noop", async (ctx) => { await ctx.answerCbQuery(); });
}
