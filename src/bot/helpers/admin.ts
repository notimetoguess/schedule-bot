import type { BotContext, BotDependencies } from "../types.js";
import { showLogin, userKey } from "./auth.js";

export async function isAdmin(ctx: BotContext, dependencies: BotDependencies): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  const session = await dependencies.authStore.get(userKey(ctx));
  return Boolean(session?.authenticatedEmail && dependencies.adminEmails?.has(session.authenticatedEmail));
}

export async function ensureAdmin(ctx: BotContext, dependencies: BotDependencies): Promise<boolean> {
  if (ctx.chat?.type !== "private") { await ctx.answerCbQuery?.("Кабінет доступний лише в приватному чаті.", { show_alert: true }); return false; }
  const session = await dependencies.authStore.get(userKey(ctx));
  if (!session) { await showLogin(ctx, dependencies, "Для кабінету потрібно авторизуватися:"); return false; }
  if (!session.authenticatedEmail || !dependencies.adminEmails?.has(session.authenticatedEmail)) {
    await ctx.reply("У вас немає доступу до кабінету."); return false;
  }
  return true;
}
