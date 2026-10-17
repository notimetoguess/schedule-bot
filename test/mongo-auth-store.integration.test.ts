import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { MongoAuthStore, type AuthDocument } from "../src/auth/mongo-auth-store.js";

// Only an explicitly supplied test URI is used. Each run owns a fresh database.
const uri = process.env.MONGODB_TEST_URI;
test("MongoDB persistence, dates, expiry index, replacement, deletion and eventual TTL cleanup", {
  skip: !uri, timeout: 100_000,
}, async () => {
  const name = "schedule_bot_test_" + randomUUID().replaceAll("-", "");
  const first = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const second = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  try {
    await first.connect();
    const collection = first.db(name).collection<AuthDocument>("auth_sessions");
    const store = new MongoAuthStore(collection);
    await store.initialize();
    await store.initialize();
    const index = (await collection.indexes()).find((index) => index.name === "auth_session_expiry");
    assert.deepEqual(index?.key, { expiresAt: 1 });
    assert.equal(index?.expireAfterSeconds, 0);
    const expiresAt = Date.now() + 43_200_000;
    await store.set("42", { accessToken: "old", expiresAt });
    const document = await collection.findOne({ _id: "42" });
    assert(document?.createdAt instanceof Date);
    assert(document.expiresAt instanceof Date);
    await first.close();

    await second.connect();
    const restartedCollection = second.db(name).collection<AuthDocument>("auth_sessions");
    const restarted = new MongoAuthStore(restartedCollection);
    assert.deepEqual(await restarted.get("42"), { accessToken: "old", expiresAt });
    await restarted.set("42", { accessToken: "new", expiresAt });
    await restarted.delete("42", "old");
    assert.equal((await restarted.get("42"))?.accessToken, "new");
    assert.equal(await restartedCollection.countDocuments({ _id: "42" }), 1);
    await restarted.delete("42");
    assert.equal(await restarted.get("42"), undefined);

    await restarted.set("expired", { accessToken: "expired", expiresAt: Date.now() - 1 });
    assert.equal(await restarted.get("expired"), undefined);
    const deadline = Date.now() + 90_000;
    while (await restartedCollection.findOne({ _id: "expired" })) {
      assert(Date.now() < deadline, "TTL monitor did not delete the expired document within 90 seconds");
      await setTimeout(500);
    }
  } finally {
    // Only the randomly named database created by this test is removed.
    await second.connect();
    await second.db(name).dropDatabase();
    await Promise.all([first.close(), second.close()]);
  }
});
