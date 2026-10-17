export type NotificationChatType = "private" | "group";

export interface AnnouncementAttachment {
  type: "photo" | "video";
  url?: string;
  fileId?: string;
}

export interface AnnouncementSnapshot {
  text: string;
  media?: AnnouncementAttachment;
}

export interface NotificationChat {
  id: string;
  type: NotificationChatType;
}

export interface PendingDelivery {
  id: string;
  announcementId: string;
  chatKey: string;
  chatId: string;
  payload: AnnouncementSnapshot;
  attempts: number;
}

export interface NotificationStore {
  initialize(): Promise<void>;
  isAvailable(): boolean;
  registerChat(chat: NotificationChat, now?: number): Promise<void>;
  setChatActive(id: string, active: boolean, type: NotificationChatType, now?: number): Promise<void>;
  migrateChat(fromId: string, toId: string, now?: number): Promise<void>;
  reconcile(now?: number): Promise<void>;
  nextPending(now?: number): Promise<PendingDelivery | undefined>;
  markAttempt(delivery: PendingDelivery, now: number): Promise<void>;
  markSent(id: string, messageId: number): Promise<void>;
  retry(id: string, nextAttemptAt: number): Promise<void>;
  fail(id: string, failure: "unreachable" | "invalid_announcement"): Promise<void>;
  markAnnouncementInvalid(id: string): Promise<void>;
  markChatUnreachable(id: string): Promise<void>;
}

export interface NotificationSender {
  send(chatId: string, payload: AnnouncementSnapshot, signal: AbortSignal): Promise<{ messageId: number }>;
}
