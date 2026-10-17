import { AuthChallengeStore } from "./auth/auth-challenges.js";
import { MongoClient } from "mongodb";
import { RecoveringAuthStore } from "./auth/mongo-recovery.js";
import { MongoAuthStore } from "./auth/mongo-auth-store.js";
import { MongoStudentProfileStore } from "./profile/mongo-student-profile-store.js";
import { createBot } from "./bot/bot.js";
import { loadConfig } from "./config.js";
import { createAuthServer } from "./http/auth-server.js";
import { WebDkClient } from "./integrations/webdk.js";
import { SlidingWindowRateLimiter } from "./shared/rate-limiter.js";
import { CredentialCrypto } from "./auth/credential-crypto.js";
import { ScheduleService } from "./schedule/schedule-service.js";
import { ScheduleImageRenderer } from "./schedule/schedule-image-renderer.js";
import { ScheduleImageStore } from "./schedule/image-store.js";
import { ScheduleTextStore } from "./schedule/text-store.js";
import { MongoNotificationStore } from "./notifications/notification-store.js";
import { NotificationService } from "./notifications/notification-service.js";
import { TelegramNotificationSender } from "./notifications/telegram-notification-sender.js";
import { MongoAnnouncementStore } from "./announcements/announcement-store.js";
import type { NotificationSender } from "./notifications/types.js";

const config = loadConfig();
const webDk = new WebDkClient(config.apiVersion);
const mongoClient = new MongoClient(config.mongoUri, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 10000,
});
const database = mongoClient.db(config.mongoDatabase);
const mongoStore = new MongoAuthStore(database.collection("auth_sessions"));
const profileStore = new MongoStudentProfileStore(database.collection("student_profiles"));
const notificationStore = new MongoNotificationStore(
  database.collection("announcements"),
  database.collection("notification_chats"),
  database.collection("announcement_deliveries"),
);
const announcements = new MongoAnnouncementStore(database.collection("announcements"));
const authStore = new RecoveringAuthStore({
  store: mongoStore,
  connect: () => mongoClient.connect(),
  initialize: () => mongoStore.initialize(),
  ping: () => database.command({ ping: 1 }, { timeoutMS: 5000 }),
  close: () => mongoClient.close(),
});
let notificationSender: NotificationSender | undefined;
const notifications = new NotificationService({
  store: notificationStore,
  sender: {
    send: (...args) => {
      if (!notificationSender) throw new Error("Telegram sender is not ready");
      return notificationSender.send(...args);
    },
  },
  ensureDatabaseReady: () => authStore.checkReady(),
});
const challenges = new AuthChallengeStore();
const requestLimiter = new SlidingWindowRateLimiter(2, 30_000);
const credentialCrypto = config.credentialsEncryptionKey ? new CredentialCrypto(config.credentialsEncryptionKey) : undefined;
const scheduleImageStore = new ScheduleImageStore();
const scheduleTextStore = new ScheduleTextStore();
const dependencies = {
  authStore,
  challenges,
  requestLimiter,
  webAppUrl: config.authWebAppUrl,
  scheduleService: new ScheduleService(authStore, webDk, credentialCrypto, profileStore),
  scheduleImageRenderer: new ScheduleImageRenderer(),
  scheduleImageStore,
  scheduleTextStore,
  notifications,
  announcements,
  adminEmails: config.adminEmails,
};
const { bot, close } = createBot(config.botToken, webDk, dependencies);
notificationSender = new TelegramNotificationSender(bot.telegram);
const authServer = createAuthServer({
  checkReady: () => authStore.checkReady(),
  botToken: config.botToken,
  publicUrl: config.authWebAppUrl,
  initDataMaxAgeSeconds: config.initDataMaxAgeSeconds,
  authSessionMaxAgeSeconds: config.authSessionMaxAgeSeconds,
  authStore,
  challenges,
  requestLimiter,
  webDk,
  credentialCrypto,
  scheduleImageStore,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try { bot.stop(signal); } catch { /* Polling may not have started. */ }
  await notifications.stop();
  close();
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  challenges.clear();
  requestLimiter.clear();
  await authStore.stop();
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

try {
  await new Promise<void>((resolve, reject) => {
    authServer.once("error", reject);
    authServer.listen(config.authPort, config.authHost, resolve);
  });
  console.log("Authentication server listening on " + config.authHost + ":" + config.authPort);
  authStore.start();
  notifications.start();
  await bot.telegram.setMyCommands([
    { command: "start", description: "Почати або відкрити меню" },
    { command: "login", description: "Відкрити безпечну авторизацію" },
    { command: "logout", description: "Вийти з облікового запису" },
    { command: "cabinet", description: "Відкрити кабінет адміністратора" },
  ]);

  await bot.launch({ allowedUpdates: ["message", "callback_query", "inline_query", "chosen_inline_result", "my_chat_member"] }, () => console.log("LNTU schedule bot started"));

} catch {
  console.error("Bot startup failed");
  await shutdown("startup failure");
  process.exitCode = 1;
}
