import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { InitDataError, validateTelegramInitData } from "../src/auth/telegram-init-data.js";

const token = "999:test-token";

function signedInitData(userId: number, authDate: number): string {
  const fields = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "query",
    signature: "telegram-third-party-signature",
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

test("valid Telegram initData returns the signed user", () => {
  assert.equal(validateTelegramInitData(signedInitData(42, 1_000), token, 300, 1_100).id, 42);
});

test("tampered and stale Telegram initData are rejected", () => {
  const tampered = new URLSearchParams(signedInitData(42, 1_000));
  tampered.set("user", JSON.stringify({ id: 43, first_name: "Test" }));
  assert.throws(() => validateTelegramInitData(tampered.toString(), token, 300, 1_100), InitDataError);
  assert.throws(() => validateTelegramInitData(signedInitData(42, 1_000), token, 300, 1_301), InitDataError);
});
