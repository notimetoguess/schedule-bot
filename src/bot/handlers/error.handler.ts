import type { Telegraf } from "telegraf";
import { WebDkError } from "../../integrations/webdk.js";
import type { BotContext } from "../types.js";

export function registerErrorHandler(bot: Telegraf<BotContext>): void {
  bot.catch(async (error, ctx) => {
    console.error("Unhandled bot update error", error instanceof WebDkError ? error.kind : "internal");
    try { await ctx.reply("Сталася неочікувана помилка. Спробуйте ще раз."); } catch { console.error("Failed to send error message to user"); }
  });
}
