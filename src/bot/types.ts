import type { Context } from "telegraf";
import type { AuthChallengeStore } from "../auth/auth-challenges.js";
import type { AuthStore } from "../auth/auth-store.js";
import type { SlidingWindowRateLimiter } from "../shared/rate-limiter.js";
import type { BotSession } from "../types.js";
import type { ScheduleService } from "../schedule/schedule-service.js";
import type { ScheduleImageRenderer } from "../schedule/schedule-image-renderer.js";
import type { ScheduleImageStore } from "../schedule/image-store.js";
import type { ScheduleTextStore } from "../schedule/text-store.js";
import type { NotificationService } from "../notifications/notification-service.js";
import type { AnnouncementStore } from "../announcements/announcement-store.js";

export interface BotContext extends Context {
  session: BotSession;
}

export interface BotDependencies {
  authStore: AuthStore;
  challenges: AuthChallengeStore;
  requestLimiter: SlidingWindowRateLimiter;
  webAppUrl: string;
  scheduleService?: ScheduleService;
  scheduleImageRenderer?: ScheduleImageRenderer;
  scheduleImageStore?: ScheduleImageStore;
  scheduleTextStore?: ScheduleTextStore;
  notifications?: NotificationService;
  announcements?: AnnouncementStore;
  adminEmails?: ReadonlySet<string>;
}
