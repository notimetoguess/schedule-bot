import type { Telegraf } from "telegraf";
import { showLogin, userKey } from "../helpers/auth.js";
import { showMenu } from "../helpers/replies.js";
import { clearTransient } from "../helpers/session.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerLoginCommand(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.command("login", async (ctx) => {
    clearTransient(ctx.session);
    if (await dependencies.authStore.get(userKey(ctx))) {
      if (ctx.chat.type === "private") {
        await showMenu(ctx, dependencies, "Ви вже авторизовані. Оберіть дію:");
      } else {
        await ctx.reply("Ви вже авторизовані. Введіть @" + ctx.botInfo.username + " show all для загального розкладу або @" + ctx.botInfo.username + " show me для ваших предметів.");
      }
      return;
    }
    if (ctx.chat.type !== "private") {
      await ctx.reply("Введіть @" + ctx.botInfo.username + " login у полі повідомлення та натисніть кнопку «Авторизуватися» над результатами.");
      return;
    }
    await showLogin(ctx, dependencies, "Відкрийте захищену форму авторизації:");
  });
}
