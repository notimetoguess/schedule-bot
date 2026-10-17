import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AuthStoreUnavailableError } from "../../auth/auth-store.js";
import type { Telegraf } from "telegraf";
import { currentAcademicWeekRange, nextAcademicWeekRange, todayRange } from "../../schedule/dates.js";
import { loginUrl, userKey } from "../helpers/auth.js";
import { messageInlineResult } from "../helpers/inline-results.js";
import { clearTransient } from "../helpers/session.js";
import type { BotContext, BotDependencies } from "../types.js";

const INLINE_MENU_VERSION = "menu-v1";

export function registerInlineQueryHandler(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  const { authStore, challenges, webAppUrl } = dependencies;
  const showThumbnail = new URL("/assets/inline/show.jpg", webAppUrl).toString();
  const authorizedThumbnail = new URL("/assets/inline/authorized.jpg", webAppUrl).toString();
  const logoutThumbnail = versionedThumbnail("logout.jpg", webAppUrl);
  const needAuthorizeThumbnail = versionedThumbnail("need-authorize.jpg", webAppUrl);
  const todayThumbnail = new URL("/assets/inline/today-calendar.png", webAppUrl).toString();
  const weekThumbnail = new URL("/assets/inline/weekly-calendar.png", webAppUrl).toString();

  bot.on("chosen_inline_result", async (ctx) => {
    if (ctx.chosenInlineResult.result_id !== "logout" || ctx.chosenInlineResult.query.trim().toLowerCase() !== "logout") return;
    let message: string;
    try {
      await authStore.delete(userKey(ctx));
      dependencies.scheduleService?.clear(userKey(ctx));
      dependencies.scheduleImageStore?.clearOwner(userKey(ctx));
      dependencies.scheduleTextStore?.clearOwner(userKey(ctx));
      clearTransient(ctx.session);
      message = "Ви вийшли з облікового запису. Для авторизації введіть @" + ctx.botInfo.username + " login.";
    } catch (error) {
      if (!(error instanceof AuthStoreUnavailableError)) throw error;
      message = "Сервіс авторизації тимчасово недоступний. Вихід не виконано. Спробуйте пізніше.";
    }
    if (ctx.chosenInlineResult.inline_message_id) await ctx.editMessageText(message);
  });

  bot.on("inline_query", async (ctx) => {
    const userId = userKey(ctx);
    const inlineCommand = ctx.inlineQuery.query.trim().toLowerCase();
    if (inlineCommand === "logout") {
      await ctx.answerInlineQuery([{ ...messageInlineResult(
        "logout", "Вийти з облікового запису", "Запит на вихід з облікового запису надіслано. Очікуйте підтвердження.", undefined, logoutThumbnail,
      ), description: "Оберіть, щоб вийти з облікового запису.", reply_markup: { inline_keyboard: [[{ text: "Авторизуватися", switch_inline_query_current_chat: "login" }]] } }], { cache_time: 0, is_personal: true });
      return;
    }

    const query = inlineCommand.replace(/\s+/g, " ");
    if (query === "show") {
      await ctx.answerInlineQuery([messageInlineResult("show-help:" + INLINE_MENU_VERSION, "Оберіть розклад", "Щоб показати розклад, введіть @" + ctx.botInfo.username + " show all або @" + ctx.botInfo.username + " show me. Саме show лише показує цю підказку.", undefined, showThumbnail)], { cache_time: 0, is_personal: true });
      return;
    }
    const auth = await authStore.get(userId);
    if (inlineCommand === "login") {
      if (auth) {
        await ctx.answerInlineQuery([messageInlineResult("already-authorized", "Ви вже авторизовані", "Поточна сесія ЛНТУ активна. Введіть @" + ctx.botInfo.username + " show all або @" + ctx.botInfo.username + " show me.", undefined, authorizedThumbnail)], { cache_time: 0, is_personal: true });
        return;
      }
      await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true, button: { text: "🔐 Авторизуватися", web_app: { url: loginUrl(webAppUrl, challenges.issue(userId)) } } });
      return;
    }
    if (query !== "show all" && query !== "show me") {
      await ctx.answerInlineQuery([messageInlineResult("inline-command-instructions", "Як показати розклад", "Загальний: @" + ctx.botInfo.username + " show all.\nВаші предмети: @" + ctx.botInfo.username + " show me.\nДля авторизації введіть @" + ctx.botInfo.username + " login.\nДля виходу введіть @" + ctx.botInfo.username + " logout.", undefined, showThumbnail)], { cache_time: 0, is_personal: true });
      return;
    }
    if (!auth) {
      await ctx.answerInlineQuery([messageInlineResult("authorization-instructions", "Потрібна авторизація", "Для авторизації введіть @" + ctx.botInfo.username + " login", undefined, needAuthorizeThumbnail)], { cache_time: 0, is_personal: true });
      return;
    }

    // Inline answers have a tight platform deadline. Fetching and rendering begin only after selection.
    const today = todayRange();
    const week = currentAcademicWeekRange();
    const nextWeek = nextAcademicWeekRange();
    const view = query === "show me" ? "me" : "all";
    const viewLabel = view === "me" ? "Мій розклад" : "Загальний розклад";
    const results = [
      scheduleMenuResult(view, "today", viewLabel + " на сьогодні", today.from, today.to, todayThumbnail),
      week
        ? scheduleMenuResult(view, "week", viewLabel + " на поточний тиждень", week.from, week.to, weekThumbnail)
        : messageInlineResult("academic-week-ended:" + INLINE_MENU_VERSION, "Навчальний тиждень завершено", "Поточний навчальний тиждень завершено. Оберіть розклад на наступний тиждень.", undefined, weekThumbnail),
      scheduleMenuResult(view, "next-week", viewLabel + " на наступний тиждень", nextWeek.from, nextWeek.to, weekThumbnail),
    ];
    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  });
}

function scheduleMenuResult(view: "all" | "me", kind: string, title: string, from: string, to: string, thumbnailUrl: string) {
  return {
    ...messageInlineResult(`${view}:${kind}:${from}:${to}:${INLINE_MENU_VERSION}`, title, `Натисніть «Показати розклад», щоб завантажити ${title.toLowerCase()}.`, undefined, thumbnailUrl),
    description: "Оберіть, щоб надіслати меню розкладу.",
    reply_markup: { inline_keyboard: [[{ text: "Показати розклад", callback_data: `schedule-menu:${view}:${from}:${to}` }]] },
  };
}

function versionedThumbnail(filename: string, webAppUrl: string): string {
  const bytes = readFileSync(new URL("../../assets/inline/" + filename, import.meta.url));
  const url = new URL("/assets/inline/" + filename, webAppUrl);
  url.searchParams.set("v", createHash("sha256").update(bytes).digest("hex").slice(0, 12));
  return url.toString();
}
