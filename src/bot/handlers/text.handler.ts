import type { Telegraf } from "telegraf";
import { showLogin, userKey } from "../helpers/auth.js";
import { showMenu } from "../helpers/replies.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerTextHandler(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    if (ctx.chat.type === "private") {
      if (await dependencies.authStore.get(userKey(ctx))) {
        await showMenu(ctx, dependencies, "Скористайтеся кнопками меню:");
      } else {
        await showLogin(ctx, dependencies, "Для перегляду розкладу спочатку авторизуйтеся:");
      }
    }
  });
}
