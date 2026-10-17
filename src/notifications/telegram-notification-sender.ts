import type { Telegram } from "telegraf";
import type { AnnouncementSnapshot, NotificationSender } from "./types.js";

export class TelegramNotificationSender implements NotificationSender {
  constructor(private readonly telegram: Telegram) {}

  async send(chatId: string, payload: AnnouncementSnapshot, signal: AbortSignal): Promise<{ messageId: number }> {
    const abortOptions = { signal: signal as unknown as import("abort-controller").AbortSignal };
    let response;
    if (payload.media?.type === "photo") {
      response = await this.telegram.callApi("sendPhoto", {
        chat_id: chatId, photo: payload.media.fileId ?? payload.media.url!, caption: payload.text,
      }, abortOptions);
    } else if (payload.media?.type === "video") {
      response = await this.telegram.callApi("sendVideo", {
        chat_id: chatId, video: payload.media.fileId ?? payload.media.url!, caption: payload.text,
      }, abortOptions);
    } else {
      response = await this.telegram.callApi("sendMessage", { chat_id: chatId, text: payload.text }, abortOptions);
    }
    return { messageId: response.message_id };
  }
}
