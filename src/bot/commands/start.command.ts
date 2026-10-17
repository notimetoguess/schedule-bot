import type { Telegraf } from "telegraf";
import { showLogin, userKey } from "../helpers/auth.js";
import { showMenu } from "../helpers/replies.js";
import { clearTransient } from "../helpers/session.js";
import { ensureAdmin } from "../helpers/admin.js";
import { cabinetKeyboard } from "../keyboards/admin.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerStartCommand(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.start(async (ctx) => {
    clearTransient(ctx.session);
    if (ctx.startPayload === "cabinet") {
      if (await ensureAdmin(ctx, dependencies)) await ctx.reply("Твій кабінет:", cabinetKeyboard);
      return;
    }
    if (await dependencies.authStore.get(userKey(ctx))) {
      if (ctx.chat.type === "private") {
        await showMenu(ctx, dependencies, "Ви вже авторизовані. Оберіть дію:");
      } else {
        await ctx.reply("Ви вже авторизовані. Введіть @" + ctx.botInfo.username + " show all для загального розкладу або @" + ctx.botInfo.username + " show me для ваших предметів.");
      }
      return;
    }
    if (ctx.chat.type !== "private") {
      await ctx.reply("Для безпечної авторизації введіть @" + ctx.botInfo.username + " login і натисніть кнопку «Авторизуватися».");
      return;
    }
    await showLogin(ctx, dependencies, "Авторизуйтеся через захищену форму. Email і пароль не з’являться в чаті.");
  });
}
