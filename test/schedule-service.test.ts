import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { CredentialCrypto } from "../src/auth/credential-crypto.js";
import { MemoryAuthStore } from "../src/auth/auth-store.js";
import { WebDkError } from "../src/integrations/webdk.js";
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
