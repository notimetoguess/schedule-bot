import { DateTime } from "luxon";
import { KYIV_ZONE } from "../../schedule/dates.js";

interface InlineRecipient {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function messageInlineResult(id: string, title: string, message: string, recipient?: InlineRecipient, thumbnailUrl?: string) {
  const addressed = recipient ? addressToUser(message, recipient) : undefined;
  return {
    type: "article" as const,
    id,
    title,
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    description: message.replace(/\n/g, " ").slice(0, 180),
    input_message_content: {
      message_text: addressed?.text ?? message,
      ...(addressed ? { entities: addressed.entities } : {}),
      link_preview_options: { is_disabled: true },
    },
  };
}

export function scheduleDate(value: string): string {
  const date = DateTime.fromISO(value, { setZone: true });
  return date.isValid ? date.setZone(KYIV_ZONE).toISODate()! : value.slice(0, 10);
}

function addressToUser(message: string, user: InlineRecipient) {
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
  const prefix = "👤 Розклад для ";
  return {
    text: prefix + displayName + "\n\n" + message,
    entities: [{ type: "text_link" as const, offset: prefix.length, length: displayName.length, url: "tg://user?id=" + user.id }],
  };
}
