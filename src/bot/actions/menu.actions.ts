import { DateTime } from "luxon";
import type { Telegraf } from "telegraf";
import type { WebDkClient } from "../../integrations/webdk.js";
import { currentAcademicWeekRange, KYIV_ZONE, todayRange } from "../../schedule/dates.js";
import { ensureAuthorized } from "../helpers/auth.js";
import { fetchAndReply, showMenu } from "../helpers/replies.js";
import { clearTransient, withSessionLock } from "../helpers/session.js";
import { calendarKeyboard } from "../keyboards/calendar.keyboard.js";
import { menuKeyboard, schedulePeriodKeyboard } from "../keyboards/menu.keyboard.js";
import { isAdmin } from "../helpers/admin.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerMenuActions(
  bot: Telegraf<BotContext>,
  webDk: WebDkClient,
  dependencies: BotDependencies,
): void {
  bot.action(/^menu:view:(all|me)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    const view = ctx.match[1] as "all" | "me";
    try { await ctx.editMessageText(view === "me" ? "Оберіть період для мого розкладу:" : "Оберіть період для загального розкладу:", schedulePeriodKeyboard(view)); }
    catch (error) { if (!(error instanceof Error && /message is not modified/i.test(error.message))) throw error; }
  });

  bot.action("menu:back", async (ctx) => {
    await ctx.answerCbQuery();
    if (await ensureAuthorized(ctx, dependencies)) {
      try { await ctx.editMessageText("Оберіть тип розкладу:", menuKeyboard(await isAdmin(ctx, dependencies))); }
      catch (error) { if (!(error instanceof Error && /message is not modified/i.test(error.message))) throw error; }
    }
  });

  bot.action(/^menu:(all|me):(today|week|range)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    const view = ctx.match[1] as "all" | "me";
    const period = ctx.match[2]!;
    if (period === "today") {
      await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, todayRange(), view));
      return;
    }
    if (period === "week") {
      const range = currentAcademicWeekRange();
      if (!range) { await showMenu(ctx, dependencies, "Поточний навчальний тиждень завершено. Оберіть інший період."); return; }
      await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, range, view));
      return;
    }
    clearTransient(ctx.session);
    ctx.session.selectedScheduleView = view;
    ctx.session.stage = "choosing_start";
    const now = DateTime.now().setZone(KYIV_ZONE);
    const message = await ctx.reply("Оберіть «Дата з» для " + (view === "me" ? "мого" : "загального") + " розкладу:", calendarKeyboard("from", now.toFormat("yyyy-MM")));
    ctx.session.calendarMessageId = message.message_id;
  });

  bot.action(/^menu:semester:(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    const semesterId = Number(ctx.match[1]);
    const range = { from: ctx.match[2]!, to: ctx.match[3]! };
    await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, range, "me", semesterId));
  });

  // Keep callbacks already sent in old private-chat messages working as general schedule.
  bot.action("menu:today", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, todayRange(), "all"));
  });

  bot.action("menu:week", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    const range = currentAcademicWeekRange();
    if (!range) {
      await showMenu(ctx, dependencies, "Поточний навчальний тиждень завершено. Оберіть інший період.");
      return;
    }
    await withSessionLock(ctx, () => fetchAndReply(ctx, webDk, dependencies, range, "all"));
  });
  bot.action("menu:range", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAuthorized(ctx, dependencies))) return;
    clearTransient(ctx.session);
    ctx.session.selectedScheduleView = "all";
    ctx.session.stage = "choosing_start";
    const now = DateTime.now().setZone(KYIV_ZONE);
    const message = await ctx.reply("Оберіть «Дата з»:", calendarKeyboard("from", now.toFormat("yyyy-MM")));
    ctx.session.calendarMessageId = message.message_id;
  });
}
