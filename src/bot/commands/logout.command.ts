import type { Telegraf } from "telegraf";
import { userKey } from "../helpers/auth.js";
import { clearTransient } from "../helpers/session.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerLogoutCommand(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.command("logout", async (ctx) => {
    await dependencies.authStore.delete(userKey(ctx));
    dependencies.scheduleService?.clear(userKey(ctx));
    dependencies.scheduleImageStore?.clearOwner(userKey(ctx));
    dependencies.scheduleTextStore?.clearOwner(userKey(ctx));
    clearTransient(ctx.session);
    await ctx.reply("Ви вийшли з облікового запису. Надішліть /start, щоб авторизуватися знову.");
  });
}
