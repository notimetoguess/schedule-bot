import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { CredentialCrypto } from "../src/auth/credential-crypto.js";

test("remembered credentials are encrypted and bound to their Telegram user", () => {
  const crypto = new CredentialCrypto(randomBytes(32));
  const encrypted = crypto.encrypt("42", { email: "student@lntu.edu.ua", password: "secret" });
  assert.notEqual(encrypted.ciphertext, "secret");
  assert.deepEqual(crypto.decrypt("42", encrypted), { email: "student@lntu.edu.ua", password: "secret" });
  assert.throws(() => crypto.decrypt("43", encrypted));
});
