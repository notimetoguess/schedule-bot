import { createHash } from "node:crypto";
import type { Collection } from "mongodb";
import type { AnnouncementAttachment, AnnouncementSnapshot, NotificationChat, NotificationChatType, NotificationStore, PendingDelivery } from "./types.js";

export interface AnnouncementDocument {
  _id: string;
  status: "drafted" | "published";
  text: string;
  media?: AnnouncementAttachment;
  publishedAt?: Date;
  frozen?: AnnouncementSnapshot;
  invalid?: boolean;
}

interface ChatDocument {
  _id: string;
  chatId: string;
  type: NotificationChatType;
  active: boolean;
  createdAt: Date;
  nextAttemptAt?: Date;
  lastAttemptAt?: Date;
  firstAnnouncementId?: string;
}

interface DeliveryDocument {
  _id: string;
  announcementId: string;
  chatKey: string;
  state: "pending" | "sent" | "failed";
  payload: AnnouncementSnapshot;
  publishedAt: Date;
  createdAt: Date;
  nextAttemptAt: Date;
  attempts: number;
  messageId?: number;
  failure?: "unreachable" | "invalid_announcement";
}

export class MongoNotificationStore implements NotificationStore {
  private available = false;

  constructor(
    private readonly announcements: Collection<AnnouncementDocument>,
    private readonly chats: Collection<ChatDocument>,
    private readonly deliveries: Collection<DeliveryDocument>,
  ) {}

  async initialize(): Promise<void> {
    await this.announcements.createIndex({ status: 1, publishedAt: 1, _id: 1 }, { name: "announcement_publication_order", timeoutMS: 10_000 });
    await this.chats.createIndex({ chatId: 1 }, { unique: true, name: "notification_chat_id", timeoutMS: 10_000 });
    await this.chats.createIndex({ active: 1, createdAt: 1 }, { name: "notification_active_chats", timeoutMS: 10_000 });
    await this.deliveries.createIndex({ announcementId: 1, chatKey: 1 }, { unique: true, name: "notification_delivery_once", timeoutMS: 10_000 });
    await this.deliveries.createIndex({ state: 1, nextAttemptAt: 1, publishedAt: 1 }, { name: "notification_delivery_queue", timeoutMS: 10_000 });
    this.available = true;
  }

  isAvailable(): boolean { return this.available; }

  async registerChat(chat: NotificationChat, now = Date.now()): Promise<void> {
    if (!this.available) return;
    try {
      const existing = await this.chats.findOne({ chatId: chat.id }, { timeoutMS: 5_000 });
      if (existing) {
        const reactivated = !existing.active;
        await this.chats.updateOne({ _id: existing._id }, reactivated ? {
          $set: { type: chat.type, active: true, createdAt: new Date(now) },
          $unset: { firstAnnouncementId: "" },
        } : { $set: { type: chat.type, active: true } }, { timeoutMS: 5_000 });
        if (reactivated || !existing.firstAnnouncementId) await this.seedLatest(existing._id, new Date(reactivated ? now : existing.createdAt.getTime()), now);
      } else {
        await this.chats.updateOne(
          { _id: chat.id },
          { $set: { chatId: chat.id, type: chat.type, active: true }, $setOnInsert: { createdAt: new Date(now) } },
          { upsert: true, timeoutMS: 5_000 },
        );
        await this.seedLatest(chat.id, new Date(now), now);
      }
    } catch (error) { this.available = false; throw error; }
  }

  async setChatActive(id: string, active: boolean, type: NotificationChatType, now = Date.now()): Promise<void> {
    if (!this.available) return;
    try {
      const existing = await this.chats.findOne({ chatId: id }, { timeoutMS: 5_000 });
      if (existing) {
        const reactivated = active && !existing.active;
        await this.chats.updateOne({ _id: existing._id }, reactivated ? {
          $set: { active, type, createdAt: new Date(now) },
          $unset: { firstAnnouncementId: "" },
        } : { $set: { active, type } }, { timeoutMS: 5_000 });
        if (reactivated) await this.seedLatest(existing._id, new Date(now), now);
      } else if (active) {
        await this.chats.updateOne({ _id: id }, {
          $set: { chatId: id, active: true, type }, $setOnInsert: { createdAt: new Date(now) },
        }, { upsert: true, timeoutMS: 5_000 });
        await this.seedLatest(id, new Date(now), now);
      }
    } catch (error) { this.available = false; throw error; }
  }

  async migrateChat(fromId: string, toId: string, now = Date.now()): Promise<void> {
    if (!this.available) return;
    try {
      const old = await this.chats.findOne({ chatId: fromId }, { timeoutMS: 5_000 });
      const current = await this.chats.findOne({ chatId: toId }, { timeoutMS: 5_000 });
      if (!old) {
        await this.registerChat({ id: toId, type: "group" }, now);
        return;
      }
      if (!current) {
        await this.chats.updateOne({ _id: old._id }, { $set: { chatId: toId, type: "group", active: true } }, { timeoutMS: 5_000 });
        return;
      }
      if (old._id === current._id) return;

      // Keep prior successful sends so migration cannot re-notify the same group.
      const prior = await this.deliveries.find({ chatKey: old._id }, { timeoutMS: 5_000 }).toArray();
      for (const delivery of prior) {
        const id = deliveryId(delivery.announcementId, current._id);
        await this.deliveries.updateOne({ _id: id }, { $setOnInsert: { ...delivery, _id: id, chatKey: current._id } }, { upsert: true, timeoutMS: 5_000 });
        if (delivery.state === "sent") {
          await this.deliveries.updateOne({ _id: id, state: { $ne: "sent" } }, {
            $set: { state: "sent", messageId: delivery.messageId },
          }, { timeoutMS: 5_000 });
        }
      }
      await this.deliveries.deleteMany({ chatKey: old._id }, { timeoutMS: 5_000 });
      const fields: Record<string, unknown> = { active: true, type: "group" };
      if (!current.firstAnnouncementId && old.firstAnnouncementId) fields.firstAnnouncementId = old.firstAnnouncementId;
      await this.chats.updateOne({ _id: current._id }, {
        $set: fields,
        $min: { createdAt: old.createdAt },
      }, { timeoutMS: 5_000 });
      await this.chats.deleteOne({ _id: old._id }, { timeoutMS: 5_000 });
    } catch (error) { this.available = false; throw error; }
  }

  async reconcile(now = Date.now()): Promise<void> {
    if (!this.available) return;
    try {
      const announcementCursor = this.announcements.find({ status: "published", invalid: { $ne: true } }, { timeoutMS: 5_000 })
        .sort({ publishedAt: 1, _id: 1 }).batchSize(100);
      for await (const raw of announcementCursor) {
        const frozen = await this.freeze(raw);
        if (!frozen || !raw.publishedAt) continue;
        const announcement = { ...raw, frozen };
        const chats = this.chats.find({ active: true }, { timeoutMS: 5_000 })
          .sort({ createdAt: 1, _id: 1 }).batchSize(100);
        for await (const chat of chats) {
          const joinedAt = chat.createdAt.getTime();
          const publishedAt = announcement.publishedAt!.getTime();
          // Publications before discovery advance the boundary as the ordered
          // cursor visits them, leaving only the newest one eligible for delivery.
          if (publishedAt <= joinedAt) {
            chat.firstAnnouncementId = announcement._id;
            await this.chats.updateOne({ _id: chat._id }, {
              $set: { firstAnnouncementId: announcement._id },
            }, { timeoutMS: 5_000 });
            continue;
          }
          if (!chat.firstAnnouncementId) {
            chat.firstAnnouncementId = announcement._id;
            await this.chats.updateOne({ _id: chat._id, firstAnnouncementId: { $exists: false } }, {
              $set: { firstAnnouncementId: announcement._id },
            }, { timeoutMS: 5_000 });
          }
          await this.enqueue(announcement._id, chat._id, frozen, announcement.publishedAt!, now);
        }
      }

      // The ordered scan leaves the newest publication that predates each chat
      // in firstAnnouncementId; enqueue only that one for onboarding.
      const onboardingChats = this.chats.find({ active: true, firstAnnouncementId: { $exists: true } }, { timeoutMS: 5_000 })
        .batchSize(100);
      for await (const chat of onboardingChats) {
        const announcement = await this.announcements.findOne(
          { _id: chat.firstAnnouncementId, status: "published", invalid: { $ne: true } },
          { timeoutMS: 5_000 },
        );
        if (!announcement) continue;
        const frozen = await this.freeze(announcement);
        if (frozen && announcement.publishedAt) await this.enqueue(announcement._id, chat._id, frozen, announcement.publishedAt, now);
      }

    } catch (error) { this.available = false; throw error; }
  }

  private async enqueue(announcementId: string, chatKey: string, payload: AnnouncementSnapshot, publishedAt: Date, now: number): Promise<void> {
    const key = deliveryId(announcementId, chatKey);
    await this.deliveries.updateOne({ _id: key }, {
      $setOnInsert: {
        _id: key, announcementId, chatKey,
        state: "pending", payload, publishedAt, createdAt: new Date(now),
        nextAttemptAt: new Date(now), attempts: 0,
      },
    }, { upsert: true, timeoutMS: 5_000 });
  }

  private async seedLatest(chatKey: string, discoveredAt: Date, now: number): Promise<void> {
    const latest = this.announcements.find({
      status: "published", invalid: { $ne: true }, publishedAt: { $lte: discoveredAt },
    }, { timeoutMS: 5_000 }).sort({ publishedAt: -1, _id: -1 }).batchSize(20);
    for await (const announcement of latest) {
      const frozen = await this.freeze(announcement);
      if (!frozen || !announcement.publishedAt) continue;
      await this.chats.updateOne({ _id: chatKey }, { $set: { firstAnnouncementId: announcement._id } }, { timeoutMS: 5_000 });
      await this.enqueue(announcement._id, chatKey, frozen, announcement.publishedAt, now);
      const key = deliveryId(announcement._id, chatKey);
      await this.deliveries.updateOne({ _id: key, state: "failed", failure: "unreachable" }, {
        $set: { state: "pending", nextAttemptAt: new Date(now) },
        $unset: { failure: "" },
      }, { timeoutMS: 5_000 });
      return;
    }
  }

  async nextPending(now = Date.now()): Promise<PendingDelivery | undefined> {
    if (!this.available) return undefined;
    try {
      const candidates = await this.deliveries.find({ state: "pending", nextAttemptAt: { $lte: new Date(now) } }, { timeoutMS: 5_000 })
        .sort({ publishedAt: 1, createdAt: 1, _id: 1 }).limit(40).toArray();
      for (const candidate of candidates) {
        const chat = await this.chats.findOne({ _id: candidate.chatKey }, { timeoutMS: 5_000 });
        if (!chat?.active) {
          await this.deliveries.updateOne({ _id: candidate._id }, { $set: { state: "failed", failure: "unreachable" } }, { timeoutMS: 5_000 });
          continue;
        }
        if (chat.nextAttemptAt && chat.nextAttemptAt.getTime() > now) continue;
        if (chat.lastAttemptAt && chat.lastAttemptAt.getTime() + 3_000 > now) continue;
        return {
          id: candidate._id, announcementId: candidate.announcementId,
          chatKey: candidate.chatKey, chatId: chat.chatId,
          payload: candidate.payload, attempts: candidate.attempts,
        };
      }
      return undefined;
    } catch (error) { this.available = false; throw error; }
  }

  async markAttempt(delivery: PendingDelivery, now: number): Promise<void> {
    await this.guard(async () => {
      await this.deliveries.updateOne({ _id: delivery.id, state: "pending" }, { $inc: { attempts: 1 } }, { timeoutMS: 5_000 });
      await this.chats.updateOne({ _id: delivery.chatKey }, { $set: { lastAttemptAt: new Date(now) } }, { timeoutMS: 5_000 });
    });
  }

  async markSent(id: string, messageId: number): Promise<void> {
    await this.guard(async () => { await this.deliveries.updateOne({ _id: id, state: "pending" }, { $set: { state: "sent", messageId } }, { timeoutMS: 5_000 }); });
  }

  async retry(id: string, nextAttemptAt: number): Promise<void> {
    await this.guard(async () => { await this.deliveries.updateOne({ _id: id, state: "pending" }, { $set: { nextAttemptAt: new Date(nextAttemptAt) } }, { timeoutMS: 5_000 }); });
  }

  async fail(id: string, failure: "unreachable" | "invalid_announcement"): Promise<void> {
    await this.guard(async () => { await this.deliveries.updateOne({ _id: id, state: "pending" }, { $set: { state: "failed", failure } }, { timeoutMS: 5_000 }); });
  }

  async markAnnouncementInvalid(id: string): Promise<void> {
    await this.guard(async () => {
      await this.announcements.updateOne({ _id: id }, { $set: { invalid: true } }, { timeoutMS: 5_000 });
      await this.deliveries.updateMany({ announcementId: id, state: "pending" }, { $set: { state: "failed", failure: "invalid_announcement" } }, { timeoutMS: 5_000 });
    });
  }

  async markChatUnreachable(id: string): Promise<void> {
    await this.guard(async () => {
      await this.chats.updateOne({ _id: id }, { $set: { active: false } }, { timeoutMS: 5_000 });
      await this.deliveries.updateMany({ chatKey: id, state: "pending" }, { $set: { state: "failed", failure: "unreachable" } }, { timeoutMS: 5_000 });
    });
  }

  private async freeze(document: AnnouncementDocument): Promise<AnnouncementSnapshot | undefined> {
    if (document.frozen) return document.frozen;
    if (!validAnnouncement(document)) {
      await this.announcements.updateOne({ _id: document._id }, { $set: { invalid: true } }, { timeoutMS: 5_000 });
      console.warn("Announcement rejected", { announcementId: document._id, reason: "invalid_content" });
      return undefined;
    }
    // There is one publishing worker per bot process. Snapshot content once so
    // later edits cannot silently alter retries or future recipients.
    const frozen: AnnouncementSnapshot = {
      text: document.text,
      ...(document.media ? { media: document.media } : {}),
    };
    await this.announcements.updateOne({ _id: document._id, status: "published", frozen: { $exists: false } }, { $set: { frozen } }, { timeoutMS: 5_000 });
    const saved = await this.announcements.findOne({ _id: document._id }, { timeoutMS: 5_000 });
    return saved?.status === "published" && saved.invalid !== true && saved.frozen ? saved.frozen : undefined;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.available) throw new Error("Notification database is unavailable");
    try { return await operation(); }
    catch (error) { this.available = false; throw error; }
  }
}

function validAnnouncement(document: AnnouncementDocument): boolean {
  if (typeof document._id !== "string" || !document._id.trim() || typeof document.text !== "string" || !document.text.trim()) return false;
  if (!(document.publishedAt instanceof Date) || !Number.isFinite(document.publishedAt.getTime())) return false;
  if (document.media === undefined) return document.text.length <= 4096;
  if (document.text.length > 1024 || !["photo", "video"].includes(document.media.type)) return false;
  const { url, fileId } = document.media;
  if (Boolean(url) === Boolean(fileId)) return false;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    } catch { return false; }
  }
  return typeof (url || fileId) === "string" && (url || fileId)!.length <= 2048;
}

function deliveryId(announcementId: string, chatId: string): string {
  return createHash("sha256").update(announcementId + "\0" + chatId).digest("hex");
}
