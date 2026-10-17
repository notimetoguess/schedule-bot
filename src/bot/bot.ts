import { AuthStoreUnavailableError } from "../auth/auth-store.js";
import { messageInlineResult } from "./helpers/inline-results.js";
import { imageKeyboard, textKeyboard } from "./helpers/schedule-image.js";
import { semesterKeyboard } from "./keyboards/semester.keyboard.js";
import { Telegraf } from "telegraf";
import type { WebDkClient } from "../integrations/webdk.js";
import { WebDkError } from "../integrations/webdk.js";
import { toApiDateRange } from "../schedule/dates.js";
import { formatSchedule } from "../schedule/format.js";
import type { ScheduleView } from "../types.js";
import { registerCalendarActions, registerCalendarNoopAction } from "./actions/calendar.actions.js";
import { registerMenuActions } from "./actions/menu.actions.js";
import { registerLoginCommand } from "./commands/login.command.js";
import { registerLogoutCommand } from "./commands/logout.command.js";
import { registerCabinetCommand } from "./commands/cabinet.command.js";
import { registerStartCommand } from "./commands/start.command.js";
import { registerErrorHandler } from "./handlers/error.handler.js";
import { registerInlineQueryHandler } from "./handlers/inline-query.handler.js";
import { registerTextHandler } from "./handlers/text.handler.js";
import { registerAdminActions } from "./actions/admin.actions.js";
import { registerAdminMessageHandler } from "./handlers/admin-message.handler.js";
import { logScheduleFailure } from "./helpers/webdk-diagnostics.js";
import { rateLimitMessage } from "./helpers/replies.js";
import { clearTransient } from "./helpers/session.js";
import { createSessionMiddleware, createSessionStore, privateChatMiddleware } from "./middlewares/session.middleware.js";
import type { BotContext, BotDependencies } from "./types.js";
import { createNotificationDiscoveryMiddleware } from "../notifications/notification-middleware.js";

export type { BotDependencies } from "./types.js";

export function createBot(token: string, webDk: WebDkClient, dependencies: BotDependencies) {
  const bot = new Telegraf<BotContext>(token);
  const store = createSessionStore();

  bot.use(async (ctx, next) => {
    try { await next(); }
    catch (error) {
      if (!(error instanceof AuthStoreUnavailableError)) throw error;
      const message = "Сервіс авторизації тимчасово недоступний. Спробуйте пізніше.";
      if (ctx.inlineQuery) {
        await ctx.answerInlineQuery([messageInlineResult("auth-unavailable", "Сервіс недоступний", message)], {
          cache_time: 0, is_personal: true,
        });
      } else {
        await ctx.reply(message);
      }
    }
  });
  bot.use(createSessionMiddleware(store));
  if (dependencies.notifications) bot.use(createNotificationDiscoveryMiddleware(dependencies.notifications));
  bot.use(privateChatMiddleware);
  registerStartCommand(bot, dependencies);
  registerLoginCommand(bot, dependencies);
  registerLogoutCommand(bot, dependencies);
  registerCabinetCommand(bot, dependencies);
  registerCalendarNoopAction(bot);
  registerScheduleImageActions(bot, dependencies);
  registerScheduleTextActions(bot, dependencies);
  registerInlineScheduleMenuActions(bot, webDk, dependencies);
  registerMenuActions(bot, webDk, dependencies);
  registerAdminActions(bot, dependencies);
  registerCalendarActions(bot, webDk, dependencies);
  registerInlineQueryHandler(bot, dependencies);
  registerAdminMessageHandler(bot, dependencies);
  registerTextHandler(bot, dependencies);
  registerErrorHandler(bot);

  return { bot, close: () => store.close() };
}

function registerInlineScheduleMenuActions(bot: Telegraf<BotContext>, webDk: WebDkClient, dependencies: BotDependencies): void {
  bot.action(/^schedule-menu:(?:(all|me):)?(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const view = (ctx.match[1] ?? "all") as ScheduleView;
    const from = ctx.match[2]!;
    const to = ctx.match[3]!;
    const userId = String(ctx.from.id);
    await ctx.answerCbQuery("Завантажую розклад…");
    let auth: Awaited<ReturnType<BotDependencies["authStore"]["get"]>>;

    try {
      auth = await dependencies.authStore.get(userId);
      if (!auth) {
        await ctx.editMessageText("Сесія відсутня або завершилася. Введіть @" + ctx.botInfo.username + " login, щоб авторизуватися знову.");
        return;
      }
      const limit = dependencies.requestLimiter.consume(userId);
      if (!limit.allowed) {
        await ctx.editMessageText(rateLimitMessage(limit));
        return;
      }
      const range = toApiDateRange({ from, to });
      const result = dependencies.scheduleService
        ? await dependencies.scheduleService.get(userId, range.dateFrom, range.dateTo, view)
        : { lessons: await webDk.getSchedule(auth.accessToken, range.dateFrom, range.dateTo), cached: false, view: "all" as const, notice: view === "me" ? "Не вдалося перевірити ваші предмети. Показано загальний розклад." : undefined };
      if (result.needsSemesterSelection && result.semesterChoices) {
        await ctx.editMessageText("Оберіть ваш поточний семестр:", semesterKeyboard(result.semesterChoices, (id) => `schedule-semester:${id}:${from}:${to}`));
        return;
      }
      await renderInlineSchedule(ctx, result.lessons, userId, dependencies, result.view === "me" ? "Мій розклад" + (result.semesterName ? " · " + result.semesterName : "") : "Загальний розклад", result.notice);
    } catch (error) {
      if (auth) logScheduleFailure(error, userId, auth.expiresAt);
      if (error instanceof WebDkError && error.kind === "unauthorized") {
        if (auth) await dependencies.authStore.delete(userId, auth.accessToken);
        dependencies.scheduleService?.clear(userId);
        clearTransient(ctx.session);
        await ctx.editMessageText("Сесія ЛНТУ завершилася. Введіть @" + ctx.botInfo.username + " login, щоб авторизуватися знову.");
        return;
      }
      await ctx.editMessageText(error instanceof AuthStoreUnavailableError
        ? "Сервіс авторизації тимчасово недоступний. Спробуйте пізніше."
        : "Не вдалося завантажити розклад. Спробуйте ще раз пізніше.");
    }
  });

  bot.action(/^schedule-semester:(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const semesterId = Number(ctx.match[1]);
    const from = ctx.match[2]!;
    const to = ctx.match[3]!;
    const userId = String(ctx.from.id);
    await ctx.answerCbQuery("Формую ваш розклад…");
    let auth: Awaited<ReturnType<BotDependencies["authStore"]["get"]>>;
    try {
      auth = await dependencies.authStore.get(userId);
      if (!auth) { await ctx.editMessageText("Сесія відсутня або завершилася. Введіть @" + ctx.botInfo.username + " login, щоб авторизуватися знову."); return; }
      const limit = dependencies.requestLimiter.consume(userId);
      if (!limit.allowed) { await ctx.editMessageText(rateLimitMessage(limit)); return; }
      const range = toApiDateRange({ from, to });
      const result = await dependencies.scheduleService?.get(userId, range.dateFrom, range.dateTo, "me", semesterId);
      if (!result) { await ctx.editMessageText("Не вдалося перевірити ваші предмети. Спробуйте ще раз."); return; }
      await renderInlineSchedule(ctx, result.lessons, userId, dependencies, result.view === "me" ? "Мій розклад" + (result.semesterName ? " · " + result.semesterName : "") : "Загальний розклад", result.notice);
    } catch (error) {
      if (auth) logScheduleFailure(error, userId, auth.expiresAt);
      if (error instanceof WebDkError && error.kind === "unauthorized") {
        if (auth) await dependencies.authStore.delete(userId, auth.accessToken);
        dependencies.scheduleService?.clear(userId);
        clearTransient(ctx.session);
        await ctx.editMessageText("Сесія ЛНТУ завершилася. Введіть @" + ctx.botInfo.username + " login, щоб авторизуватися знову.");
        return;
      }
      await ctx.editMessageText("Не вдалося сформувати розклад. Спробуйте ще раз пізніше.");
    }
  });
}

async function renderInlineSchedule(ctx: BotContext, lessons: import("../types.js").ScheduleLesson[], userId: string, dependencies: BotDependencies, title: string, notice?: string): Promise<void> {
  if (lessons.length && dependencies.scheduleImageRenderer && dependencies.scheduleImageStore) {
    try {
      const pages = await dependencies.scheduleImageRenderer.render(lessons, title);
      const id = dependencies.scheduleImageStore.put(userId, pages, title);
      const url = new URL(`/schedule-images/${id}/0.jpg`, dependencies.webAppUrl).toString();
      const caption = [pages.length > 1 ? `${title} · 1/${pages.length}` : title, notice].filter(Boolean).join("\n");
      await ctx.editMessageMedia({ type: "photo", media: url, caption }, { reply_markup: imageKeyboard(id, 0, pages.length) });
      return;
    } catch { /* Text fallback keeps the result usable if rendering is unavailable. */ }
  }

  const schedulePages = lessons.length === 0 && title.startsWith("Мій розклад")
    ? ["За обраний період занять з ваших предметів немає."]
    : formatSchedule(lessons);
  const pages = schedulePages.map((page, index) => (index === 0 ? [title, notice].filter(Boolean).join("\n") + "\n\n" : "") + page);
  const store = dependencies.scheduleTextStore;
  if (!store || pages.length <= 1) {
    await ctx.editMessageText(pages[0]!, { link_preview_options: { is_disabled: true } });
    return;
  }
  const id = store.put(userId, pages);
  await ctx.editMessageText(pages[0]!, { link_preview_options: { is_disabled: true }, reply_markup: textKeyboard(id, 0, pages.length) });
}

function registerScheduleImageActions(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.action(/^schedule-image:([A-Za-z0-9_-]{20,}):(\d+)$/, async (ctx) => {
    const bundle = dependencies.scheduleImageStore?.get(ctx.match[1]!);
    const page = Number(ctx.match[2]);
    if (!bundle || bundle.ownerId !== String(ctx.from.id) || !bundle.pages[page]) { await ctx.answerCbQuery("Термін дії розкладу минув.", { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const url = new URL(`/schedule-images/${ctx.match[1]}/${page}.jpg`, dependencies.webAppUrl).toString();
    await ctx.editMessageMedia({ type: "photo", media: url, caption: `${bundle.title ?? "Розклад"} · ${page + 1}/${bundle.pages.length}` }, { reply_markup: imageKeyboard(ctx.match[1]!, page, bundle.pages.length) });
  });
}

function registerScheduleTextActions(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.action(/^schedule-text:([A-Za-z0-9_-]{20,}):(\d+)$/, async (ctx) => {
    const bundle = dependencies.scheduleTextStore?.get(ctx.match[1]!);
    const page = Number(ctx.match[2]);
    if (!bundle || bundle.ownerId !== String(ctx.from.id) || !bundle.pages[page]) { await ctx.answerCbQuery("Термін дії розкладу минув.", { show_alert: true }); return; }
    await ctx.answerCbQuery();
    await ctx.editMessageText(bundle.pages[page]!, {
      link_preview_options: { is_disabled: true }, reply_markup: textKeyboard(ctx.match[1]!, page, bundle.pages.length),
    });
  });
}
