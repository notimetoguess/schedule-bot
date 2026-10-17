import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../bot/types.js";
import type { NotificationService } from "./notification-service.js";

export function createNotificationDiscoveryMiddleware(notifications: NotificationService): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    try {
      if (ctx.myChatMember) {
        const chat = ctx.myChatMember.chat;
        if (chat.type !== "channel") {
          const member = ctx.myChatMember.new_chat_member;
          const allowed = member.status === "creator" || member.status === "administrator" || member.status === "member"
            || (member.status === "restricted" && member.is_member && member.can_send_messages);
          const type = chat.type === "private" ? "private" : "group";
          await notifications.setChatActive(String(chat.id), type, allowed);
        }
      } else if (ctx.chat && ctx.chat.type !== "channel") {
        const chat = ctx.chat;
        const type = chat.type === "private" ? "private" : "group";
        const message = ctx.message;
        if (message && "migrate_to_chat_id" in message && message.migrate_to_chat_id !== undefined) {
          await notifications.migrateChat(String(chat.id), String(message.migrate_to_chat_id));
        } else {
          await notifications.registerChat(String(chat.id), type);
        }
      }
    } catch {
      // Announcements never block an ordinary bot command or schedule reply.
    }
    await next();
  };
}
