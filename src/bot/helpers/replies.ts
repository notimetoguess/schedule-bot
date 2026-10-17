import { logScheduleFailure } from "./webdk-diagnostics.js";
import type { WebDkClient } from "../../integrations/webdk.js";
import { WebDkError } from "../../integrations/webdk.js";
import { toApiDateRange, type DateRange } from "../../schedule/dates.js";
import { formatSchedule } from "../../schedule/format.js";
import type { ScheduleView } from "../../types.js";
import type { RateLimitDecision } from "../../shared/rate-limiter.js";
import { menuKeyboard } from "../keyboards/menu.keyboard.js";
import { isAdmin } from "./admin.js";
import { semesterKeyboard } from "../keyboards/semester.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";
import { showLogin, userKey } from "./auth.js";
import { clearTransient } from "./session.js";

export async function fetchAndReply(
  ctx: BotContext,
  client: WebDkClient,
  dependencies: BotDependencies,
  range: DateRange,
  view: ScheduleView = "all",
  semesterId?: number,
): Promise<void> {
  const userId = userKey(ctx);
  const auth = await dependencies.authStore.get(userId);
  if (!auth) {
    await showLogin(ctx, dependencies, "Сесія відсутня або завершилася. Авторизуйтеся знову:");
    return;
  }
  const limit = dependencies.requestLimiter.consume(userId);
  if (!limit.allowed) {
    await ctx.reply(rateLimitMessage(limit), { disable_notification: true });
    return;
  }
  await ctx.reply("Завантажую розклад…");
  try {
    const apiRange = toApiDateRange(range);
    const result = dependencies.scheduleService
      ? await dependencies.scheduleService.get(userId, apiRange.dateFrom, apiRange.dateTo, view, semesterId)
      : { lessons: await client.getSchedule(auth.accessToken, apiRange.dateFrom, apiRange.dateTo), cached: false, view: "all" as const, notice: view === "me" ? "Не вдалося перевірити ваші предмети. Показано загальний розклад." : undefined };
    if (result.needsSemesterSelection && result.semesterChoices) {
      await ctx.reply("Оберіть ваш поточний семестр:", semesterKeyboard(result.semesterChoices, (id) => `menu:semester:${id}:${range.from}:${range.to}`));
      return;
    }
    const lessons = result.lessons;
    const title = result.view === "me" ? "Мій розклад" + (result.semesterName ? " · " + result.semesterName : "") : "Загальний розклад";
    if (result.notice) await ctx.reply(result.notice);
    if (lessons.length && dependencies.scheduleImageRenderer) {
      try {
        const images = await dependencies.scheduleImageRenderer.render(lessons, title);
        for (const image of images) await ctx.replyWithPhoto({ source: image });
      } catch {
        for (const message of scheduleMessages(lessons, result.view, title)) await ctx.reply(message, { link_preview_options: { is_disabled: true } });
      }
    } else for (const message of scheduleMessages(lessons, result.view, title)) await ctx.reply(message, { link_preview_options: { is_disabled: true } });
    await showMenu(ctx, dependencies, "Оберіть наступну дію:");
  } catch (error) {
    logScheduleFailure(error, userId, auth.expiresAt);
    if (error instanceof WebDkError && error.kind === "unauthorized") {
      await dependencies.authStore.delete(userId, auth.accessToken);
      dependencies.scheduleService?.clear(userId);
      clearTransient(ctx.session);
      await showLogin(ctx, dependencies, "Сесія ЛНТУ завершилася. Авторизуйтеся знову:");
      return;
    }
    await showMenu(ctx, dependencies, error instanceof WebDkError && error.kind === "malformed"
      ? "Сервіс ЛНТУ повернув дані в невідомому форматі. Спробуйте пізніше."
      : "Не вдалося завантажити розклад. Перевірте з’єднання та спробуйте ще раз.");
  }
}

export function rateLimitMessage(decision: RateLimitDecision): string {
  return "Забагато запитів. Спробуйте ще раз через " + Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) + " с.";
}

function scheduleMessages(lessons: import("../../types.js").ScheduleLesson[], view: ScheduleView, title: string): string[] {
  const messages = view === "me" && lessons.length === 0
    ? ["За обраний період занять з ваших предметів немає."]
    : formatSchedule(lessons);
  return messages.map((message) => title + "\n\n" + message);
}

export async function showMenu(ctx: BotContext, dependencies: BotDependencies, text: string): Promise<void> {
  await ctx.reply(text, menuKeyboard(await isAdmin(ctx, dependencies)));
}
