import assert from "node:assert/strict";
import test from "node:test";
import type { Telegram } from "telegraf";
import { NotificationService } from "../src/notifications/notification-service.js";
import { TelegramNotificationSender } from "../src/notifications/telegram-notification-sender.js";
import type { NotificationStore, PendingDelivery } from "../src/notifications/types.js";

test("Telegram sender selects plain text, photo, and video endpoints with the right payloads", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown>; signal?: AbortSignal }> = [];
  const telegram = {
    async callApi(method: string, payload: Record<string, unknown>, options?: { signal?: AbortSignal }) {
      calls.push({ method, payload, signal: options?.signal });
      return { message_id: calls.length };
    },
  } as unknown as Telegram;
  const sender = new TelegramNotificationSender(telegram);
  const controller = new AbortController();

  assert.deepEqual(await sender.send("-1001", { text: "Text update" }, controller.signal), { messageId: 1 });
  await sender.send("-1001", { text: "Photo update", media: { type: "photo", url: "https://example.com/photo.jpg" } }, controller.signal);
  await sender.send("-1001", { text: "Video update", media: { type: "video", fileId: "telegram-file-id" } }, controller.signal);

  assert.deepEqual(calls.map(({ method, payload }) => [method, payload]), [
    ["sendMessage", { chat_id: "-1001", text: "Text update" }],
    ["sendPhoto", { chat_id: "-1001", photo: "https://example.com/photo.jpg", caption: "Photo update" }],
    ["sendVideo", { chat_id: "-1001", video: "telegram-file-id", caption: "Video update" }],
  ]);
  assert(calls.every((call) => call.signal === controller.signal));
});

test("notification worker persists retry timing and resumes delivery after rate limiting", async () => {
  let now = 10_000;
  let available = true;
  let attemptCount = 0;
  let retryAt = now;
  let resolveDelivered!: () => void;
  let service!: NotificationService;
  const delivered = new Promise<void>((resolve) => { resolveDelivered = resolve; });
  let pending: PendingDelivery | undefined = {
    id: "delivery-1", announcementId: "update-1", chatKey: "-1001", chatId: "-1001",
    payload: { text: "Published update" }, attempts: 0,
  };
  const store: NotificationStore = {
      async initialize() { available = true; },
      isAvailable: () => available,
      async registerChat() {},
      async setChatActive() {},
      async migrateChat() {},
      async reconcile() {},
      async nextPending(at) { return pending && (at ?? now) >= retryAt ? { ...pending, attempts: attemptCount } : undefined; },
      async markAttempt(_delivery, at) { attemptCount++; now = at; },
      async markSent() { pending = undefined; resolveDelivered(); },
      async retry(_id, at) { retryAt = at; },
      async fail() { pending = undefined; },
      async markAnnouncementInvalid() { pending = undefined; },
      async markChatUnreachable() { pending = undefined; },
  };
  service = new NotificationService({
      store,
      sender: {
        async send() {
          if (attemptCount === 1) {
            throw { code: 429, parameters: { retry_after: 2 } };
          }
          return { messageId: 55 };
        },
      },
      ensureDatabaseReady: async () => true,
      now: () => now,
      wait: async (ms, signal) => {
        now += ms;
        await new Promise<void>((resume) => {
          const finish = () => { clearImmediate(timer); signal.removeEventListener("abort", finish); resume(); };
          const timer = setImmediate(finish);
          const stop = () => finish();
          signal.addEventListener("abort", stop, { once: true });
        });
      },
      random: () => 0,
      logger: { info() {}, warn() {}, error() {} },
  });
  service.start();

  await delivered;
  await service.stop();
  assert.equal(attemptCount, 2);
  assert(now >= 12_000);
  assert.equal(pending, undefined);
});
