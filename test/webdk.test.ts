import assert from "node:assert/strict";
import test from "node:test";
import { WebDkClient, WebDkError } from "../src/integrations/webdk.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("login sends the required form and validates token response", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init: init! };
    return jsonResponse({ access_token: "secret-token", token_type: "bearer", expires_in: 1209599 });
  }) as typeof fetch;
  const client = new WebDkClient("2.18", fetcher);

  const result = await client.login("student@example.com", "p& ss");
  assert.deepEqual(result, { accessToken: "secret-token", tokenType: "bearer", expiresIn: 1209599 });
  assert.equal(request?.url, "https://web-dk.lntu.edu.ua/WebDk/token");
  assert.equal(request?.init.method, "POST");
  const body = new URLSearchParams(request?.init.body as URLSearchParams);
  assert.deepEqual(Object.fromEntries(body), {
    grant_type: "password",
    username: "student@example.com",
    password: "p& ss",
    version: "2.18",
  });
});

test("schedule sends Bearer token and date body", async () => {
  let request: RequestInit | undefined;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    request = init;
    return jsonResponse([{
      scheduleDate: "2026-09-08T00:00:00+03:00",
      studyTimeBegin: "2026-09-08T09:00:00+03:00",
      studyTimeEnd: "2026-09-08T10:20:00+03:00",
      disciplineName: "Програмування",
    }]);
  }) as typeof fetch;
  const client = new WebDkClient("2.18", fetcher);
  const lessons = await client.getSchedule("abc", "from", "to");

  assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer abc");
  assert.deepEqual(JSON.parse(String(request?.body)), { dateFrom: "from", dateTo: "to" });
  assert.equal(lessons[0]?.disciplineName, "Програмування");
});

test("student profile sends the authenticated empty-object request", async () => {
  let request: RequestInit | undefined;
  const client = new WebDkClient("2.18", (async (_url: string | URL | Request, init?: RequestInit) => {
    request = init;
    return jsonResponse({ courseName: "3 курс", osvitaLevelName: "Бакалавр" });
  }) as typeof fetch);
  assert.deepEqual(await client.getStudentProfile("abc"), { courseName: "3 курс", educationLevelName: "Бакалавр" });
  assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer abc");
  assert.deepEqual(JSON.parse(String(request?.body)), {});
});

test("login classifies bad credentials and version rejection", async () => {
  const credentials = new WebDkClient("2.18", (async () => jsonResponse({ error_description: "bad login" }, 400)) as typeof fetch);
  await assert.rejects(credentials.login("x@y.ua", "bad"), (error: unknown) => error instanceof WebDkError && error.kind === "credentials");

  const version = new WebDkClient("old", (async () => jsonResponse({ error_description: "Missing or invalid version parameter" }, 400)) as typeof fetch);
  await assert.rejects(version.login("x@y.ua", "bad"), (error: unknown) => error instanceof WebDkError && error.kind === "version");
});

test("schedule detects expiry and malformed lessons", async () => {
  const expired = new WebDkClient("2.18", (async () => jsonResponse({ errorCode: 20700 }, 400)) as typeof fetch);
  await assert.rejects(expired.getSchedule("x", "from", "to"), (error: unknown) => error instanceof WebDkError && error.kind === "unauthorized");

  const malformed = new WebDkClient("2.18", (async () => jsonResponse([{ disciplineName: "Missing dates" }])) as typeof fetch);
  await assert.rejects(malformed.getSchedule("x", "from", "to"), (error: unknown) => error instanceof WebDkError && error.kind === "malformed");
});

test("network failures are normalized", async () => {
  const client = new WebDkClient("2.18", (async () => { throw new Error("offline"); }) as typeof fetch);
  await assert.rejects(client.login("x@y.ua", "pass"), (error: unknown) => error instanceof WebDkError && error.kind === "network");
});
