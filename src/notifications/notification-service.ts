import type { AnnouncementSnapshot, NotificationSender, NotificationStore, PendingDelivery } from "./types.js";

const RECONCILE_INTERVAL_MS = 60_000;
const GLOBAL_SEND_INTERVAL_MS = 100;
const OPERATION_TIMEOUT_MS = 15_000;

interface ErrorInfo {
  code?: number | string;
  retryAfter?: number;
  description?: string;
}

export interface NotificationServiceOptions {
  store: NotificationStore;
  sender: NotificationSender;
  ensureDatabaseReady(): Promise<boolean>;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** Durable publication reconciliation and one serial, rate-limited sender. */
export class NotificationService {
  private readonly abort = new AbortController();
  private worker?: Promise<void>;
  private globalPauseUntil = 0;
  private readonly recentChatWrites = new Map<string, number>();
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly options: NotificationServiceOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? ((ms, signal) => new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = () => { if (timer) clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      timer = setTimeout(finish, ms);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    }));
    this.random = options.random ?? Math.random;
    this.logger = options.logger ?? console;
  }

  start(): void { this.worker ??= this.run(); }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.worker;
  }

  async registerChat(id: string, type: "private" | "group"): Promise<void> {
    if (this.abort.signal.aborted || !this.options.store.isAvailable()) return;
    const now = this.now();
    if (now - (this.recentChatWrites.get(id) ?? -Infinity) < RECONCILE_INTERVAL_MS) return;
    try {
      await this.options.store.registerChat({ id, type }, now);
      this.recentChatWrites.delete(id);
      this.recentChatWrites.set(id, now);
      while (this.recentChatWrites.size > 2_000) this.recentChatWrites.delete(this.recentChatWrites.keys().next().value!);
    }
    catch (error) { this.logFailure("chat_registration", error, { chatId: id }); }
  }

  async setChatActive(id: string, type: "private" | "group", active: boolean): Promise<void> {
    if (this.abort.signal.aborted || !this.options.store.isAvailable()) return;
    try { await this.options.store.setChatActive(id, active, type, this.now()); }
    catch (error) { this.logFailure("chat_membership", error, { chatId: id }); }
  }

  async migrateChat(fromId: string, toId: string): Promise<void> {
    if (this.abort.signal.aborted || !this.options.store.isAvailable()) return;
    try { await this.options.store.migrateChat(fromId, toId, this.now()); }
    catch (error) { this.logFailure("chat_migration", error, { chatId: fromId }); }
  }

  private async run(): Promise<void> {
    let nextReconcileAt = 0;
    let unavailableDelay = 1_000;
    while (!this.abort.signal.aborted) {
      let delay = 250;
      try {
        if (!this.options.store.isAvailable()) {
          if (await this.options.ensureDatabaseReady()) await this.options.store.initialize();
          else delay = 5_000;
          unavailableDelay = 1_000;
        }
        if (this.options.store.isAvailable()) {
          const now = this.now();
          if (now >= nextReconcileAt) {
            await this.options.store.reconcile(now);
            nextReconcileAt = now + RECONCILE_INTERVAL_MS;
          }
          if (this.now() < this.globalPauseUntil) {
            delay = Math.min(1_000, this.globalPauseUntil - this.now());
          } else {
            const pending = await this.options.store.nextPending(this.now());
            if (pending) {
              await this.deliver(pending);
              delay = GLOBAL_SEND_INTERVAL_MS;
            } else {
              delay = 750;
            }
          }
        }
      } catch (error) {
        delay = unavailableDelay;
        unavailableDelay = Math.min(60_000, unavailableDelay * 2);
        this.logFailure("worker", error);
      }
      if (!this.abort.signal.aborted) await this.wait(Math.max(1, delay), this.abort.signal);
    }
  }

  private async deliver(delivery: PendingDelivery): Promise<void> {
    const now = this.now();
    try {
      await this.options.store.markAttempt(delivery, now);
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(OPERATION_TIMEOUT_MS)]);
      const sent = await this.options.sender.send(delivery.chatId, delivery.payload, signal);
      await this.options.store.markSent(delivery.id, sent.messageId);
      this.logger.info("Announcement delivered", { announcementId: delivery.announcementId, chatId: delivery.chatId });
    } catch (error) {
      if (this.abort.signal.aborted) return;
      const info = errorInfo(error);
      if (info.retryAfter !== undefined || info.code === 429) {
        const retryAfter = Math.max(1, info.retryAfter ?? 1);
        this.globalPauseUntil = this.now() + retryAfter * 1_000;
        await this.options.store.retry(delivery.id, this.globalPauseUntil);
        this.logFailure("rate_limited", error, { announcementId: delivery.announcementId, chatId: delivery.chatId, retryAfter });
        return;
      }
      if (info.code === 403 || isUnreachableDescription(info.description)) {
        await this.options.store.markChatUnreachable(delivery.chatKey);
        this.logFailure("chat_unreachable", error, { announcementId: delivery.announcementId, chatId: delivery.chatId });
        return;
      }
      if (info.code === 400) {
        await this.options.store.markAnnouncementInvalid(delivery.announcementId);
        this.logFailure("invalid_announcement", error, { announcementId: delivery.announcementId, chatId: delivery.chatId });
        return;
      }

      const attempt = delivery.attempts + 1;
      const backoff = Math.min(3_600_000, 1_000 * 2 ** Math.min(attempt - 1, 11));
      const retryIn = Math.round(backoff * (1 + this.random() * 0.2));
      await this.options.store.retry(delivery.id, this.now() + retryIn);
      this.logFailure("send_retry", error, { announcementId: delivery.announcementId, chatId: delivery.chatId, attempt, retryIn });
    }
  }

  private logFailure(stage: string, error: unknown, extra: Record<string, unknown> = {}): void {
    // Never log driver or Telegram error strings: they may contain user-supplied URLs.
    const { code, retryAfter } = errorInfo(error);
    this.logger.warn("Notification operation deferred", {
      stage,
      ...(code !== undefined ? { code } : {}),
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ...extra,
    });
  }
}

export function notificationPayload(text: string, media?: { type: "photo" | "video"; url?: string; fileId?: string }): AnnouncementSnapshot {
  return { text, ...(media ? { media } : {}) };
}

function errorInfo(error: unknown): ErrorInfo {
  if (!error || typeof error !== "object") return {};
  const candidate = error as {
    code?: unknown;
    description?: unknown;
    parameters?: { retry_after?: unknown };
    response?: { error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } };
  };
  const code = candidate.code ?? candidate.response?.error_code;
  const description = candidate.description ?? candidate.response?.description;
  const retryAfter = candidate.parameters?.retry_after ?? candidate.response?.parameters?.retry_after;
  return {
    ...(typeof code === "number" || typeof code === "string" ? { code } : {}),
    ...(typeof description === "string" ? { description: description.slice(0, 300) } : {}),
    ...(typeof retryAfter === "number" ? { retryAfter } : {}),
  };
}

function isUnreachableDescription(description?: string): boolean {
  return Boolean(description && /bot was blocked|bot is not a member|chat not found|bot was kicked|have no rights to send/i.test(description));
}
