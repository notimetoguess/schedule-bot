import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { AuthStoreUnavailableError, MemoryAuthStore } from "../src/auth/auth-store.js";
import { RecoveringAuthStore } from "../src/auth/mongo-recovery.js";
import { databaseDiagnostic } from "../src/auth/mongo-diagnostics.js";

function fixture() {
  const state = { connectFailures: 0, indexFailures: 0, pingFails: false, connects: 0, closed: 0 };
  const delays: number[] = [];
  const logs: unknown[] = [];
  let resume: (() => void) | undefined;
  const store = new MemoryAuthStore();
  const recovery = new RecoveringAuthStore({
    store,
    async connect() { state.connects++; if (state.connectFailures-- > 0) throw Object.assign(new Error("secret-uri"), { code: "ECONNREFUSED" }); },
    async initialize() { if (state.indexFailures-- > 0) throw Object.assign(new Error("secret-index"), { code: 13 }); },
    async ping() { if (state.pingFails) throw Object.assign(new Error("secret-ping"), { code: "ETIMEDOUT" }); },
    async close() { state.closed++; },
    random: () => 0,
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    wait: (ms, signal) => new Promise<void>((resolve) => {
      delays.push(ms);
      const finish = () => { signal.removeEventListener("abort", finish); resolve(); };
      resume = finish;
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    }),
  });
  return { state, delays, logs, store, recovery, async tick() { resume?.(); await setImmediate(); } };
}

test("startup retries indefinitely with capped backoff, gates operations, then preserves sessions", async () => {
  const f = fixture();
  f.state.connectFailures = 9;
  await f.store.set("42", { accessToken: "persisted", expiresAt: Date.now() + 100000 });
  f.recovery.start(); f.recovery.start();
  await setImmediate();
  try {
    assert.equal(await f.recovery.checkReady(), false);
    await assert.rejects(f.recovery.get("42"), AuthStoreUnavailableError);
    await assert.rejects(f.recovery.set("42", { accessToken: "new", expiresAt: 999 }), AuthStoreUnavailableError);
    await assert.rejects(f.recovery.delete("42"), AuthStoreUnavailableError);
    for (let i = 0; i < 9; i++) await f.tick();
    assert.deepEqual(f.delays.slice(0, 9), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    assert.equal(f.state.connects, 10);
    assert.equal(await f.recovery.checkReady(), true);
    assert.equal((await f.recovery.get("42"))?.accessToken, "persisted");
    assert.doesNotMatch(JSON.stringify(f.logs), /secret|persisted/);
  } finally { await f.recovery.stop(); }
  assert.equal(f.state.closed, 1);
});

test("index failures are distinguished and runtime outage recovers without replacing sessions", async () => {
  const f = fixture(); f.state.indexFailures = 1;
  f.recovery.start(); await setImmediate();
  try {
    assert.match(JSON.stringify(f.logs), /"stage":"index"/);
    assert.match(JSON.stringify(f.logs), /permissions/);
    assert.equal(await f.recovery.checkReady(), false);
    await f.tick();
    await f.recovery.set("42", { accessToken: "saved", expiresAt: Date.now() + 100000 });
    f.state.pingFails = true;
    assert.equal(await f.recovery.checkReady(), false);
    await assert.rejects(f.recovery.delete("42"), AuthStoreUnavailableError);
    f.state.pingFails = false;
    await f.tick();
    assert.equal(await f.recovery.checkReady(), true);
    assert.equal((await f.recovery.get("42"))?.accessToken, "saved");
  } finally { await f.recovery.stop(); }
});

test("shutdown cancels retry sleep and never reconnects", async () => {
  const f = fixture(); f.state.connectFailures = 100;
  f.recovery.start(); await setImmediate();
  await f.recovery.stop(); await f.tick();
  assert.equal(f.state.connects, 1);
  assert.equal(await f.recovery.checkReady(), false);
});

test("user writes are never replayed by recovery", async () => {
  const f = fixture(); let writes = 0;
  f.store.set = async () => { writes++; throw new Error("secret-token"); };
  f.recovery.start(); await setImmediate();
  try {
    await assert.rejects(f.recovery.set("42", { accessToken: "secret-token", expiresAt: 100 }), AuthStoreUnavailableError);
    assert.equal(await f.recovery.checkReady(), false);
    await f.tick();
    assert.equal(await f.recovery.checkReady(), true);
    assert.equal(writes, 1);
  } finally { await f.recovery.stop(); }
});

test("diagnostics traverse topology causes but never include arbitrary strings", () => {
  const error = { name: "MongoServerSelectionError", message: "mongodb://password@host", reason: {
    servers: new Map([["private-host", { error: { cause: { code: "ENOTFOUND", message: "secret" } } }]]),
  } };
  assert.deepEqual(databaseDiagnostic(error), { category: "dns", codes: ["ENOTFOUND"] });
  assert.deepEqual(databaseDiagnostic({ name: "secret", code: "secret", cause: { code: 18 } }), { category: "authentication", codes: [18] });
});
