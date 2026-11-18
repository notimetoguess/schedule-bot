import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const mongoUri = "mongodb://localhost:27017";

test("config loads auth server defaults", () => {
  const config = loadConfig({
    BOT_TOKEN: "token",
    AUTH_WEBAPP_URL: "https://auth.example.com/",
    MONGODB_URI: mongoUri,
  });
  assert.equal(config.authWebAppUrl, "https://auth.example.com");
  assert.equal(config.apiVersion, "3.00");
  assert.equal(config.webDkBaseUrl, "https://web-dk.lntu.edu.ua/api/student/");
  assert.equal(config.authHost, "127.0.0.1");
  assert.equal(config.authPort, 3000);
  assert.equal(config.initDataMaxAgeSeconds, 300);
  assert.equal(config.authSessionMaxAgeSeconds, 604_800);
  assert.equal(config.mongoUri, mongoUri);
  assert.equal(config.mongoDatabase, "schedule_bot");
});

test("config rejects a public non-HTTPS Mini App URL", () => {
  assert.throws(
    () => loadConfig({
      BOT_TOKEN: "token",
      AUTH_WEBAPP_URL: "http://auth.example.com",
      MONGODB_URI: mongoUri,
    }),
    /must use HTTPS/,
  );
});

test("config requires a valid MongoDB URI", () => {
  assert.throws(
    () => loadConfig({ BOT_TOKEN: "token", AUTH_WEBAPP_URL: "https://auth.example.com" }),
    /MONGODB_URI is required/,
  );
  assert.throws(
    () => loadConfig({
      BOT_TOKEN: "token",
      AUTH_WEBAPP_URL: "https://auth.example.com",
      MONGODB_URI: "https://invalid.example",
    }),
    /MONGODB_URI must use/,
  );
});

const deploymentEnv = { BOT_TOKEN: "token", AUTH_WEBAPP_URL: "https://auth.example.com", MONGODB_URI: mongoUri };

test("ADMIN_EMAILS accepts a JSON array and normalizes exact identities", () => {
  const config = loadConfig({
    ...deploymentEnv,
    ADMIN_EMAILS: '[" shyyan.d0806.122.24@lntu.edu.ua ", "SECOND@LNTU.EDU.UA", "second@lntu.edu.ua"]',
  });
  assert.deepEqual([...config.adminEmails], ["shyyan.d0806.122.24@lntu.edu.ua", "second@lntu.edu.ua"]);
  assert.equal(loadConfig({ ...deploymentEnv, ADMIN_EMAILS: "[]" }).adminEmails.size, 0);
});

test("ADMIN_EMAILS rejects non-array values and invalid email entries", () => {
  for (const value of ['"student@lntu.edu.ua"', "student@lntu.edu.ua", "{}", "null", "[42]", '[""]', '["not-an-email"]']) {
    assert.throws(() => loadConfig({ ...deploymentEnv, ADMIN_EMAILS: value }), /ADMIN_EMAILS must be a JSON array of email addresses/);
  }
});

test("legacy deployment encryption key still enables remembered login after MongoDB migration", () => {
  const legacyKey = Buffer.alloc(32, 1);
  const config = loadConfig({ ...deploymentEnv, AUTH_SESSION_ENCRYPTION_KEY: legacyKey.toString("base64") });
  assert.deepEqual(config.credentialsEncryptionKey, legacyKey);
});

test("explicit credentials key takes precedence over the legacy key", () => {
  const key = Buffer.alloc(32, 2);
  const config = loadConfig({
    ...deploymentEnv,
    AUTH_CREDENTIALS_ENCRYPTION_KEY: key.toString("base64"),
    AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  });
  assert.deepEqual(config.credentialsEncryptionKey, key);
});

test("invalid legacy encryption keys fail with the actual setting name", () => {
  assert.throws(() => loadConfig({ ...deploymentEnv, AUTH_SESSION_ENCRYPTION_KEY: "invalid" }), /AUTH_SESSION_ENCRYPTION_KEY must decode to 32 bytes/);
});

test("platform PORT takes precedence over local AUTH_PORT and binds externally", () => {
  const config = loadConfig({ ...deploymentEnv, PORT: "8080", AUTH_PORT: "3000" });
  assert.equal(config.authPort, 8080);
  assert.equal(config.authHost, "0.0.0.0");
});

test("explicit host is respected and blank platform port uses local settings", () => {
  const config = loadConfig({ ...deploymentEnv, PORT: " ", AUTH_PORT: "4000", AUTH_HOST: "0.0.0.0" });
  assert.equal(config.authPort, 4000);
  assert.equal(config.authHost, "0.0.0.0");
  assert.equal(loadConfig({ ...deploymentEnv, PORT: "8080", AUTH_HOST: "127.0.0.1" }).authHost, "127.0.0.1");
});

test("invalid platform ports fail instead of silently listening on a different port", () => {
  for (const PORT of ["0", "65536", "invalid", "1.5"]) {
    assert.throws(() => loadConfig({ ...deploymentEnv, PORT }), /PORT must be a positive integer/);
  }
});

test("duration overrides allow a week while ports remain bounded", () => {
  assert.equal(loadConfig({ ...deploymentEnv, AUTH_SESSION_MAX_AGE_SECONDS: "604800" }).authSessionMaxAgeSeconds, 604800);
  assert.equal(loadConfig({ ...deploymentEnv, AUTH_SESSION_MAX_AGE_SECONDS: "3600" }).authSessionMaxAgeSeconds, 3600);
  for (const value of ["0", "-1", "1.5", "Infinity", "invalid", "9007199254740991"]) {
    assert.throws(() => loadConfig({ ...deploymentEnv, AUTH_SESSION_MAX_AGE_SECONDS: value }), /AUTH_SESSION_MAX_AGE_SECONDS/);
  }
  assert.throws(() => loadConfig({ ...deploymentEnv, AUTH_PORT: "604800" }), /AUTH_PORT/);
});

test("BASE_URL normalizes trailing slashes and rejects non-HTTP protocols", () => {
  assert.equal(
    loadConfig({ ...deploymentEnv, BASE_URL: "https://web-dk.lntu.edu.ua/api/student" }).webDkBaseUrl,
    "https://web-dk.lntu.edu.ua/api/student/",
  );
  assert.throws(
    () => loadConfig({ ...deploymentEnv, BASE_URL: "ftp://web-dk.lntu.edu.ua/api/student" }),
    /BASE_URL must use http/,
  );
});
