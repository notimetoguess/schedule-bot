import { Markup, type Context } from "telegraf";
import type { BotContext, BotDependencies } from "../types.js";

export async function showLogin(ctx: BotContext, dependencies: BotDependencies, text: string): Promise<void> {
  const url = loginUrl(dependencies.webAppUrl, dependencies.challenges.issue(userKey(ctx)));
  await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp("🔐 Авторизуватися", url)]]));
}

export async function ensureAuthorized(ctx: BotContext, dependencies: BotDependencies): Promise<boolean> {
  if (await dependencies.authStore.get(userKey(ctx))) return true;
  await showLogin(ctx, dependencies, "Потрібно авторизуватися через захищену форму:");
  return false;
}

export function userKey(ctx: Context): string {
  if (!ctx.from) throw new Error("Telegram user is required");
  return String(ctx.from.id);
}

export function loginUrl(baseUrl: string, state: string): string {
  const url = new URL("/auth", baseUrl);
  url.searchParams.set("state", state);
  return url.toString();
}
