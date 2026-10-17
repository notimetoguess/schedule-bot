import assert from "node:assert/strict";
import test from "node:test";
import type { Collection } from "mongodb";
import { AuthStoreUnavailableError, MemoryAuthStore } from "../src/auth/auth-store.js";
import { MongoAuthStore, type AuthDocument } from "../src/auth/mongo-auth-store.js";

const silentLogger = { info() {}, warn() {}, error() {} };

test("memory store uses fixed expiry and conditionally deletes rejected tokens", async () => {
  const store = new MemoryAuthStore();
  await store.set("42", { accessToken: "old", expiresAt: 2000 });
  assert.equal((await store.get("42", 1999))?.accessToken, "old");
  assert.equal(await store.get("42", 2000), undefined);
  await store.set("42", { accessToken: "new", expiresAt: 3000 });
  await store.delete("42", "old");
  assert.equal((await store.get("42", 2001))?.accessToken, "new");
  await store.delete("42");
  assert.equal(await store.get("42", 2001), undefined);
});

test("MongoDB lookup rejects expiry at the boundary without relying on TTL deletion", async () => {
  const document: AuthDocument = { _id: "42", accessToken: "access", createdAt: new Date(1000), expiresAt: new Date(2000) };
  const collection = { async findOne() { return document; } } as unknown as Collection<AuthDocument>;
  const store = new MongoAuthStore(collection, silentLogger);
  assert.equal((await store.get("42", 1999))?.accessToken, "access");
  assert.equal(await store.get("42", 2000), undefined);
  assert.equal(await store.get("42", 2001), undefined);
  assert.equal(document.expiresAt.getTime(), 2000);
});

test("database errors are sanitized and never returned as missing sessions", async () => {
  const logs: unknown[] = [];
  const fail = async () => { throw new Error("mongodb://password@host secret-token"); };
  const collection = { findOne: fail, replaceOne: fail, deleteOne: fail, createIndex: fail } as unknown as Collection<AuthDocument>;
  const store = new MongoAuthStore(collection, { ...silentLogger, error(...args: unknown[]) { logs.push(args); } });
  for (const operation of [() => store.get("42"), () => store.set("42", { accessToken: "secret-token", expiresAt: 2000 }), () => store.delete("42"), () => store.initialize()]) {
    await assert.rejects(operation, (error: unknown) => {
      assert(error instanceof AuthStoreUnavailableError);
      assert.doesNotMatch(String(error), /password|secret-token/);
      return true;
    });
  }
  assert.equal(logs.length, 4);
  assert.doesNotMatch(JSON.stringify(logs), /password|secret-token/);
});

test("expiry is checked after a database read completes", async (t) => {
  const document: AuthDocument = { _id: "42", accessToken: "access", createdAt: new Date(1000), expiresAt: new Date(2000) };
  t.mock.method(Date, "now", () => 1999);
  const collection = { async findOne() {
    t.mock.method(Date, "now", () => 2000);
    return document;
  } } as unknown as Collection<AuthDocument>;
  assert.equal(await new MongoAuthStore(collection, silentLogger).get("42"), undefined);
});
