import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { AuthChallengeStore } from "../src/auth/auth-challenges.js";
import { CredentialCrypto } from "../src/auth/credential-crypto.js";
import { AuthStoreUnavailableError, MemoryAuthStore, type AuthStore } from "../src/auth/auth-store.js";
import { createAuthServer } from "../src/http/auth-server.js";
import { SlidingWindowRateLimiter } from "../src/shared/rate-limiter.js";
import type { LoginResult } from "../src/types.js";
import { WebDkClient, WebDkError } from "../src/integrations/webdk.js";

const botToken = "999:test-token";
const publicUrl = "https://auth.example.com";
const credentialCrypto = new CredentialCrypto(Buffer.alloc(32, 1));

function signedInitData(userId: number): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "query",
    signature: "telegram-third-party-signature",
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

async function withServer(
  login: (email: string, password: string) => Promise<LoginResult>,
  run: (baseUrl: string, stores: { auth: AuthStore; challenges: AuthChallengeStore }) => Promise<void>,
  auth: AuthStore = new MemoryAuthStore(),
  checkReady?: () => Promise<boolean>,
) {
  const challenges = new AuthChallengeStore();
  const server = createAuthServer({
    botToken,
    checkReady,
    publicUrl,
    initDataMaxAgeSeconds: 300,
    authSessionMaxAgeSeconds: 604_800,
    authStore: auth,
    challenges,
    requestLimiter: new SlidingWindowRateLimiter(2, 30_000),
    webDk: { login } as WebDkClient,
    credentialCrypto,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try { await run("http://127.0.0.1:" + address.port, { auth, challenges }); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function post(baseUrl: string, body: Record<string, unknown>, origin = publicUrl): Promise<Response> {
  return fetch(baseUrl + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function postChallenge(baseUrl: string, initData: string, origin = publicUrl): Promise<Response> {
  return fetch(baseUrl + "/api/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ initData }),
  });
}

test("auth server serves protected assets and stores only the resulting token", async () => {
  let credentials: [string, string] | undefined;
  await withServer(async (email, password) => {
    credentials = [email, password];
    return { accessToken: "access-token", tokenType: "bearer", expiresIn: 3600 };
  }, async (baseUrl, stores) => {
    const health = await fetch(baseUrl + "/health");
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal(health.headers.get("cache-control"), "no-store");
    const page = await fetch(baseUrl + "/auth");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await page.text(), /autocomplete="current-password"/);
    assert.match(page.headers.get("content-security-policy") ?? "", /telegram\.org/);

    const stylesheet = await fetch(baseUrl + "/auth.css");
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css/);
    assert.match(await stylesheet.text(), /\.password-row/);
    assert.equal(stylesheet.headers.get("x-content-type-options"), "nosniff");

    const script = await fetch(baseUrl + "/auth.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
    const scriptBody = await script.text();
    assert.match(scriptBody, /returnCurrent\.addEventListener\('click'/);
    assert.match(scriptBody, /tg\.switchInlineQuery\('show'\)/);
    assert.match(scriptBody, /returnGroup\.addEventListener\('click'/);
    assert.match(scriptBody, /tg\.close\(\)/);
    assert.doesNotMatch(scriptBody, /\['groups', 'channels'\]/);
    assert.doesNotMatch(scriptBody, /setTimeout\(\(\) => tg\.switchInlineQuery/);

    const missingAsset = await fetch(baseUrl + "/auth.txt");
    assert.equal(missingAsset.status, 404);
    assert.deepEqual(await missingAsset.json(), { code: "NOT_FOUND" });

    for (const filename of ["today-calendar.png", "weekly-calendar.png", "marked-calendar.png"]) {
      const thumbnail = await fetch(baseUrl + "/assets/inline/" + filename + "?v=test-version");
      assert.equal(thumbnail.status, 200);
      assert.equal(thumbnail.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), await readFile(new URL("../src/assets/inline/" + filename, import.meta.url)));
    }
    for (const filename of ["show.jpg", "authorized.jpg", "logout.jpg", "need-authorize.jpg"]) {
      const thumbnail = await fetch(baseUrl + "/assets/inline/" + filename + "?v=test-version");
      assert.equal(thumbnail.status, 200);
      assert.equal(thumbnail.headers.get("content-type"), "image/jpeg");
      assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), await readFile(new URL("../src/assets/inline/" + filename, import.meta.url)));
    }
    assert.equal((await fetch(baseUrl + "/assets/inline/missing.png")).status, 404);

    const challengeResponse = await postChallenge(baseUrl, signedInitData(42));
    assert.equal(challengeResponse.status, 200);
    const { state } = await challengeResponse.json() as { state: string };
    assert.equal(state.length, 43);
    const response = await post(baseUrl, {
      state,
      initData: signedInitData(42),
      email: "student@example.com",
      password: "secret",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(credentials, ["student@example.com", "secret"]);
    assert.equal((await stores.auth.get("42"))?.accessToken, "access-token");
    const expiresAt = (await stores.auth.get("42"))?.expiresAt ?? 0;
    assert(expiresAt > Date.now() + 3_599_000);
    assert(expiresAt <= Date.now() + 3_600_000);
    assert.equal(await response.text(), '{"ok":true}');

    const replay = await post(baseUrl, {
      state,
      initData: signedInitData(42),
      email: "student@example.com",
      password: "secret",
    });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json() as { code: string }).code, "INVALID_SESSION");
  });
});

test("ordinary auth sessions are capped at the configured seven days", async () => {
  await withServer(async () => ({
    accessToken: "long-lived-access",
    tokenType: "bearer",
    expiresIn: 1_209_599,
  }), async (baseUrl, stores) => {
    const state = stores.challenges.issue("88");
    const before = Date.now();
    const response = await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "secret",
    });
    const after = Date.now();
    assert.equal(response.status, 200);
    const expiresAt = (await stores.auth.get("88"))?.expiresAt ?? 0;
    assert(expiresAt >= before + 604_800_000);
    assert(expiresAt <= after + 604_800_000);
    for (const hours of [2, 12]) assert(await stores.auth.get("88", before + hours * 3_600_000));
    assert(await stores.auth.get("88", expiresAt - 1));
    assert.equal(await stores.auth.get("88", expiresAt), undefined);
  });
});

test("remember-me sessions last 14 days when the initial WebDk token expires sooner", async () => {
  await withServer(async () => ({
    accessToken: "short-lived-access",
    tokenType: "bearer",
    expiresIn: 3600,
  }), async (baseUrl, stores) => {
    const state = stores.challenges.issue("89");
    const before = Date.now();
    const response = await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "secret",
      rememberMe: true,
    });
    const after = Date.now();
    assert.equal(response.status, 200);
    const session = await stores.auth.get("89");
    assert(session?.rememberedCredentials);
    assert.deepEqual(credentialCrypto.decrypt("89", session.rememberedCredentials), {
      email: "student@example.com",
      password: "secret",
    });
    assert(session.expiresAt >= before + 1_209_600_000);
    assert(session.expiresAt <= after + 1_209_600_000);
    assert(await stores.auth.get("89", session.expiresAt - 1));
    assert.equal(await stores.auth.get("89", session.expiresAt), undefined);
  });
});

test("an active session makes authentication idempotent", async () => {
  const auth = new MemoryAuthStore();
  const expiresAt = Date.now() + 60_000;
  await auth.set("42", { accessToken: "existing-access", expiresAt });
  let loginCalls = 0;
  await withServer(async () => {
    loginCalls++;
    return { accessToken: "replacement-access", tokenType: "bearer", expiresIn: 3600 };
  }, async (baseUrl, stores) => {
    const state = stores.challenges.issue("42");
    const response = await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "unused",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(loginCalls, 0);
    assert.deepEqual(await auth.get("42"), { accessToken: "existing-access", expiresAt });
    assert.equal((await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "unused",
    })).status, 401);
  }, auth);
});

test("concurrent authentication requests mint only one WebDk token", async () => {
  const auth = new MemoryAuthStore();
  let loginCalls = 0;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let releaseLogin!: () => void;
  const gate = new Promise<void>((resolve) => { releaseLogin = resolve; });

  await withServer(async () => {
    loginCalls++;
    signalStarted();
    await gate;
    return { accessToken: "single-access", tokenType: "bearer", expiresIn: 3600 };
  }, async (baseUrl, stores) => {
    const firstState = stores.challenges.issue("42");
    const first = post(baseUrl, {
      state: firstState, initData: "", email: "student@example.com", password: "secret",
    });
    await started;

    const secondState = stores.challenges.issue("42");
    const second = post(baseUrl, {
      state: secondState, initData: "", email: "student@example.com", password: "secret",
    });
    releaseLogin();

    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
    assert.equal(loginCalls, 1);
    assert.equal((await auth.get("42"))?.accessToken, "single-access");
  }, auth);
});

test("an expired session still performs a fresh WebDk login", async () => {
  const auth = new MemoryAuthStore();
  await auth.set("42", { accessToken: "expired-access", expiresAt: Date.now() - 1 });
  let loginCalls = 0;
  await withServer(async () => {
    loginCalls++;
    return { accessToken: "fresh-access", tokenType: "bearer", expiresIn: 3600 };
  }, async (baseUrl, stores) => {
    const response = await post(baseUrl, {
      state: stores.challenges.issue("42"),
      initData: "",
      email: "student@example.com",
      password: "secret",
    });
    assert.equal(response.status, 200);
    assert.equal(loginCalls, 1);
    assert.equal((await auth.get("42"))?.accessToken, "fresh-access");
  }, auth);
});

test("auth server rejects wrong origin, user mismatch, and bad credentials", async () => {
  await withServer(async () => {
    throw new WebDkError("credentials", "bad credentials", 400);
  }, async (baseUrl, stores) => {
    const state = stores.challenges.issue("42");
    const body = { state, initData: signedInitData(42), email: "student@example.com", password: "wrong" };
    assert.equal((await post(baseUrl, body, "https://evil.example")).status, 403);

    const mismatch = await post(baseUrl, { ...body, initData: signedInitData(43) });
    assert.equal(mismatch.status, 401);
    assert.equal((await mismatch.json() as { code: string }).code, "INVALID_SESSION");

    const invalid = await post(baseUrl, body);
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json() as { code: string }).code, "INVALID_CREDENTIALS");
    assert.equal((await stores.auth.get("42")), undefined);

    const secondInvalid = await post(baseUrl, body);
    assert.equal(secondInvalid.status, 401);

    const limited = await post(baseUrl, body);
    assert.equal(limited.status, 429);
    const limitedBody = await limited.json() as { code: string; retryAfterSeconds: number };
    assert.equal(limitedBody.code, "RATE_LIMITED");
    assert(limitedBody.retryAfterSeconds >= 1);
  });
});

test("bot-issued inline challenge works when Telegram client omits initData", async () => {
  await withServer(async () => ({
    accessToken: "inline-access",
    tokenType: "bearer",
    expiresIn: 3600,
  }), async (baseUrl, stores) => {
    const state = stores.challenges.issue("77");
    const response = await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "secret",
    });
    assert.equal(response.status, 200);
    assert.equal((await stores.auth.get("77"))?.accessToken, "inline-access");

    const replay = await post(baseUrl, {
      state,
      initData: "",
      email: "student@example.com",
      password: "secret",
    });
    assert.equal(replay.status, 401);
  });
});

test("failed session writes return a temporary error and leave the challenge retryable", async () => {
  const auth = new MemoryAuthStore();
  const save = auth.set.bind(auth);
  auth.set = async () => { throw new AuthStoreUnavailableError(); };
  await withServer(async () => ({ accessToken: "access", tokenType: "bearer", expiresIn: 3600 }), async (baseUrl, stores) => {
    const state = stores.challenges.issue("42");
    const body = { state, initData: "", email: "student@example.com", password: "secret" };
    const failed = await post(baseUrl, body);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { code: "AUTH_UNAVAILABLE" });
    assert.equal(await auth.get("42"), undefined);
    auth.set = save;
    assert.equal((await post(baseUrl, body)).status, 200);
    assert.equal((await auth.get("42"))?.accessToken, "access");
  }, auth);
});

test("login waits for the session write to finish", async () => {
  const auth = new MemoryAuthStore();
  const save = auth.set.bind(auth);
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  auth.set = async (userId, session) => { signalStarted(); await gate; await save(userId, session); };
  await withServer(async () => ({ accessToken: "access", tokenType: "bearer", expiresIn: 3600 }), async (baseUrl, stores) => {
    let responded = false;
    const pending = post(baseUrl, { state: stores.challenges.issue("42"), initData: "", email: "student@example.com", password: "secret" })
      .then((response) => { responded = true; return response; });
    await started;
    try {
      assert.equal(responded, false);
      assert.equal(await auth.get("42"), undefined);
    } finally { release(); }
    assert.equal((await pending).status, 200);
    assert.equal((await auth.get("42"))?.accessToken, "access");
  }, auth);
});


test("liveness remains healthy during database outage while readiness follows database checks", async () => {
  let ready = false;
  await withServer(async () => { throw new Error("unused"); }, async (baseUrl) => {
    assert.equal((await fetch(baseUrl + "/health")).status, 200);
    assert.equal((await fetch(baseUrl + "/ready")).status, 503);
    ready = true;
    assert.equal((await fetch(baseUrl + "/ready")).status, 200);
    ready = false;
    assert.equal((await fetch(baseUrl + "/ready")).status, 503);
    assert.equal((await fetch(baseUrl + "/health")).status, 200);
  }, new MemoryAuthStore(), async () => ready);
});
