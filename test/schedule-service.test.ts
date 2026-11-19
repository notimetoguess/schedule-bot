import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { CredentialCrypto } from "../src/auth/credential-crypto.js";
import { MemoryAuthStore } from "../src/auth/auth-store.js";
import { WebDkClient, WebDkError } from "../src/integrations/webdk.js";
import { ScheduleService } from "../src/schedule/schedule-service.js";

test("an early WebDk rejection renews a remembered session once and caches the schedule", async () => {
  const crypto = new CredentialCrypto(randomBytes(32));
  const store = new MemoryAuthStore();
  await store.set("42", { accessToken: "old", expiresAt: Date.now() + 60_000, rememberedCredentials: crypto.encrypt("42", { email: "a@lntu.edu.ua", password: "pw" }) });
  let logins = 0;
  let calls = 0;
  const webDk = {
    async getSchedule(token: string) {
      calls++;
      if (token === "old") throw new WebDkError("unauthorized", "expired", 400, 20700);
      return [];
    },
    async login(email: string, password: string) {
      logins++;
      assert.equal(email, "a@lntu.edu.ua"); assert.equal(password, "pw");
      return { accessToken: "new", tokenType: "bearer", expiresIn: 3600 };
    },
  };
  const service = new ScheduleService(store, webDk as never, crypto);
  assert.equal((await service.get("42", "from", "to")).cached, false);
  assert.equal((await service.get("42", "from", "to")).cached, true);
  assert.equal(logins, 1);
  assert.equal(calls, 2);
  assert.equal((await store.get("42"))?.accessToken, "new");
});

test("WebDkClient problem+json 401 triggers remembered session renewal in ScheduleService", async () => {
  const crypto = new CredentialCrypto(randomBytes(32));
  const store = new MemoryAuthStore();
  await store.set("42", { accessToken: "old", expiresAt: Date.now() + 60_000, rememberedCredentials: crypto.encrypt("42", { email: "a@lntu.edu.ua", password: "pw" }) });
  const client = new WebDkClient("3.00", (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("auth/login")) {
      return new Response(JSON.stringify({ access_token: "fresh-token", token_type: "bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const auth = new Headers(init?.headers).get("Authorization");
    if (auth === "Bearer old") {
      return new Response(JSON.stringify({ title: "Unauthorized", status: 401 }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json; charset=utf-8" },
      });
    }
    assert.equal(auth, "Bearer fresh-token");
    return new Response(JSON.stringify([{
      scheduleDate: "2026-11-19 00:00:00",
      studyTimeBegin: "1900-01-01 09:40:00",
      studyTimeEnd: "1900-01-01 10:40:00",
      disciplineName: "Крос-платформенне програмування",
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);

  const service = new ScheduleService(store, client, crypto);
  const result = await service.get("42", "2026-11-19T00:00:00+02:00", "2026-11-19T23:59:59+02:00");
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0]?.disciplineName, "Крос-платформенне програмування");
  assert.equal((await store.get("42"))?.accessToken, "fresh-token");
});
