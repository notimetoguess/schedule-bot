import type { Telegraf } from "telegraf";
import { ensureAdmin } from "../helpers/admin.js";
import { cabinetKeyboard } from "../keyboards/admin.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";

export function registerCabinetCommand(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.command("cabinet", async (ctx) => {
    if (!(await ensureAdmin(ctx, dependencies))) return;
    await ctx.reply("Твій кабінет:", cabinetKeyboard);
  });
}
