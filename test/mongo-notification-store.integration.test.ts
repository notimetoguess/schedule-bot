import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoNotificationStore, type AnnouncementDocument } from "../src/notifications/notification-store.js";

const uri = process.env.MONGODB_TEST_URI;

test("MongoDB announcement ordering, onboarding boundary, restart-safe deduplication, and group migration", {
  skip: !uri, timeout: 60_000,
}, async () => {
  const name = "schedule_bot_test_" + randomUUID().replaceAll("-", "");
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5_000 });
  const restartedClient = new MongoClient(uri!, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    const database = client.db(name);
    const announcements = database.collection<AnnouncementDocument>("announcements");
    const store = new MongoNotificationStore(
      announcements,
      database.collection("notification_chats"),
      database.collection("announcement_deliveries"),
    );
    await store.initialize();
    await announcements.insertMany([
      { _id: "first", status: "published", text: "first", publishedAt: new Date(1_800_000_001_000) },
      { _id: "second", status: "published", text: "second", publishedAt: new Date(1_800_000_002_000) },
      { _id: "third", status: "published", text: "third", publishedAt: new Date(1_800_000_003_000) },
      { _id: "draft", status: "drafted", text: "draft", publishedAt: new Date(1_800_000_004_000) },
    ]);

    await store.registerChat({ id: "-1001", type: "group" }, 1_800_000_001_500);
    await store.registerChat({ id: "-1002", type: "group" }, 1_800_000_003_500);
    await store.reconcile(1_800_000_005_000);
    await store.reconcile(1_800_000_005_001);

    const deliveries = database.collection("announcement_deliveries");
    const rows = await deliveries.find({}, { projection: { _id: 0, announcementId: 1, chatKey: 1, state: 1 } }).toArray();
    assert.deepEqual(rows.map((row) => [row.announcementId, row.chatKey]).sort(), [
      ["first", "-1001"], ["second", "-1001"], ["third", "-1001"], ["third", "-1002"],
    ]);

    const oldGroupDelivery = await deliveries.findOne({ announcementId: "second", chatKey: "-1001" });
    assert(oldGroupDelivery);
    await store.markAttempt({
      id: String(oldGroupDelivery._id), announcementId: "second", chatKey: "-1001", chatId: "-1001",
      payload: oldGroupDelivery.payload, attempts: 0,
    }, 1_800_000_005_000);
    await store.markSent(String(oldGroupDelivery._id), 42);

    // If Telegram reports the new ID before the old migration service message,
    // merge the two registrations and keep the earlier delivery receipt.
    await store.registerChat({ id: "-1003", type: "group" }, 1_800_000_006_000);
    await store.setChatActive("-1002", false, "group", 1_800_000_006_000);
    await store.migrateChat("-1001", "-1003", 1_800_000_006_001);
    const mergedSent = await deliveries.findOne({ announcementId: "second", chatKey: "-1003" });
    assert.equal(mergedSent?.state, "sent");
    assert.equal(mergedSent?.messageId, 42);
    const activeChat = await database.collection("notification_chats").findOne({ chatId: "-1003" });
    assert.equal(activeChat?.active, true);

    await restartedClient.connect();
    const restartedDb = restartedClient.db(name);
    const restarted = new MongoNotificationStore(
      restartedDb.collection<AnnouncementDocument>("announcements"),
      restartedDb.collection("notification_chats"),
      restartedDb.collection("announcement_deliveries"),
    );
    await restarted.initialize();
    const pending = await restarted.nextPending(1_800_000_010_000);
    assert(pending);
    assert.equal(pending.chatId, "-1003");
    assert.notEqual(pending.announcementId, "second");
  } finally {
    await client.db(name).dropDatabase();
    await Promise.all([client.close(), restartedClient.close()]);
  }
});
