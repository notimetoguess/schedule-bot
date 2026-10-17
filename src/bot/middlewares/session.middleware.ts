import { session, type MiddlewareFn } from "telegraf";
import { TtlMemoryStore } from "../../stores/session-store.js";
import type { BotSession } from "../../types.js";
import type { BotContext } from "../types.js";

export function createSessionStore(): TtlMemoryStore<BotSession> {
  return new TtlMemoryStore<BotSession>();
}

export function createSessionMiddleware(store: TtlMemoryStore<BotSession>): MiddlewareFn<BotContext> {
  return session({
    store,
    defaultSession: freshSession,
    getSessionKey: (ctx) => ctx.from ? String(ctx.from.id) : undefined,
  });
}

export const privateChatMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.session) return;
  ctx.session.touchedAt = Date.now();
  const inlineCallback = Boolean(ctx.callbackQuery && "inline_message_id" in ctx.callbackQuery);
  if (ctx.chat?.type !== "private" && !ctx.inlineQuery && !ctx.chosenInlineResult && !inlineCallback) {
    const value = ctx.message && "text" in ctx.message ? ctx.message.text : "";
    if (!/^\/(start|login|logout|cabinet)(?:@\w+)?(?:\s|$)/i.test(value)) return;
  }
  await next();
};

function freshSession(): BotSession {
  return { stage: "idle", touchedAt: Date.now() };
}
