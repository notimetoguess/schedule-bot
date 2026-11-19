import assert from "node:assert/strict";
import test from "node:test";
import { WebDkClient, WebDkError } from "../src/integrations/webdk.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function jwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "1", exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("login sends JSON to auth/login and validates token response", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init: init! };
    return jsonResponse({ access_token: "secret-token", token_type: "bearer", expires_in: 1209599 });
  }) as typeof fetch;
  const client = new WebDkClient("3.00", fetcher);

  const result = await client.login("student@example.com", "p& ss");
  assert.deepEqual(result, { accessToken: "secret-token", tokenType: "bearer", expiresIn: 1209599 });
  assert.equal(request?.url, "https://web-dk.lntu.edu.ua/api/student/auth/login");
  assert.equal(request?.init.method, "POST");
  assert.equal(new Headers(request?.init.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    login: "student@example.com",
    password: "p& ss",
    version: "3.00",
  });
});

test("login supports JWT-only responses without token_type or expires_in", async () => {
  const futureExp = Math.floor(Date.now() / 1000) + 7200;
  const jwt = jwtWithExp(futureExp);
  const client = new WebDkClient("3.00", (async () => jsonResponse({ access_token: jwt })) as typeof fetch);
  const result = await client.login("student@example.com", "secret");
  assert.equal(result.accessToken, jwt);
  assert.equal(result.tokenType, "Bearer");
  assert(result.expiresIn > 7100 && result.expiresIn <= 7200);
});

test("schedule sends Bearer token and date body to schedule/get", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init: init! };
    return jsonResponse([{
      scheduleDate: "2026-09-08T00:00:00+03:00",
      studyTimeBegin: "2026-09-08T09:00:00+03:00",
      studyTimeEnd: "2026-09-08T10:20:00+03:00",
      disciplineName: "Програмування",
    }]);
  }) as typeof fetch;
  const client = new WebDkClient("3.00", fetcher, 15_000, "https://web-dk.lntu.edu.ua/api/student");
  const lessons = await client.getSchedule("abc", "from", "to");

  assert.equal(request?.url, "https://web-dk.lntu.edu.ua/api/student/schedule/get");
  assert.equal(new Headers(request?.init.headers).get("Authorization"), "Bearer abc");
  assert.deepEqual(JSON.parse(String(request?.init.body)), { dateFrom: "from", dateTo: "to" });
  assert.equal(lessons[0]?.disciplineName, "Програмування");
});

test("student subjects and profile hit v3 endpoints and handle array profile", async () => {
  const urls: string[] = [];
  const client = new WebDkClient("3.00", (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer abc");
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    if (String(url).endsWith("testResult/list")) {
      return jsonResponse([{ disciplineName: "Алгоритми", semesterId: 5, semesterName: "5 семестр" }]);
    }
    return jsonResponse([{ courseName: "3 курс", osvitaLevelName: "Бакалавр" }]);
  }) as typeof fetch);
  const subjects = await client.getStudentSubjects("abc");
  assert.equal(subjects[0]?.disciplineName, "Алгоритми");
  assert.deepEqual(await client.getStudentProfile("abc"), { courseName: "3 курс", educationLevelName: "Бакалавр" });
  assert.deepEqual(urls, [
    "https://web-dk.lntu.edu.ua/api/student/testResult/list",
    "https://web-dk.lntu.edu.ua/api/student/studentAnketa/studentAnketa2",
  ]);
});

test("login classifies bad credentials and version rejection", async () => {
  const credentials = new WebDkClient("3.00", (async () => jsonResponse({ error_description: "bad login" }, 400)) as typeof fetch);
  await assert.rejects(credentials.login("x@y.ua", "bad"), (error: unknown) => error instanceof WebDkError && error.kind === "credentials");

  const version400 = new WebDkClient("old", (async () => jsonResponse({ error_description: "Missing or invalid version parameter" }, 400)) as typeof fetch);
  await assert.rejects(version400.login("x@y.ua", "bad"), (error: unknown) => error instanceof WebDkError && error.kind === "version");

  const version401 = new WebDkClient("2.18", (async () => jsonResponse({
    type: "versionMistmatch",
    status: 401,
    detail: "Знайдено відмінності у версіях програми на клієнті (2.18) і сервері (3.00).",
  }, 401)) as typeof fetch);
  await assert.rejects(version401.login("x@y.ua", "bad"), (error: unknown) => error instanceof WebDkError && error.kind === "version" && error.status === 401);

  const currentWebDk = new WebDkClient("3.00", (async () => jsonResponse({
    type: "20326",
    status: 500,
    detail: "Помилка при авторизації: Не вірний логін або пароль",
  }, 500)) as typeof fetch);
  await assert.rejects(currentWebDk.login("x@y.ua", "bad"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "credentials" && error.status === 500);

  const genuineOutage = new WebDkClient("3.00", (async () => jsonResponse({
    errorMessage: "Database unavailable",
  }, 500)) as typeof fetch);
  await assert.rejects(genuineOutage.login("x@y.ua", "bad"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "server");
});

test("schedule detects expiry (invalid_token, problem+json 401, empty 401, and 20700) and malformed lessons", async () => {
  const expiredLegacy = new WebDkClient("3.00", (async () => jsonResponse({ errorCode: 20700 }, 400)) as typeof fetch);
  await assert.rejects(expiredLegacy.getSchedule("x", "from", "to"), (error: unknown) => error instanceof WebDkError && error.kind === "unauthorized");

  const expiredJwt = new WebDkClient("3.00", (async () => jsonResponse({
    error: "invalid_token",
    error_description: "This request requires a valid JWT access token to be provided",
  }, 401)) as typeof fetch);
  await assert.rejects(expiredJwt.getSchedule("x", "from", "to"), (error: unknown) => error instanceof WebDkError && error.kind === "unauthorized");

  const problem401 = new WebDkClient("3.00", (async () => new Response(JSON.stringify({
    type: "https://httpstatuses.io/401",
    title: "Unauthorized",
    status: 401,
    detail: "Token expired",
  }), { status: 401, headers: { "Content-Type": "application/problem+json; charset=utf-8" } })) as typeof fetch);
  await assert.rejects(problem401.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError &&
    error.kind === "unauthorized" &&
    error.status === 401 &&
    error.upstreamType === "https://httpstatuses.io/401");

  const empty401 = new WebDkClient("3.00", (async () => new Response("", { status: 401 })) as typeof fetch);
  await assert.rejects(empty401.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "unauthorized" && error.status === 401);

  const versionMismatch401 = new WebDkClient("2.18", (async () => new Response(JSON.stringify({
    type: "versionMistmatch",
    status: 401,
    detail: "Version mismatch",
  }), { status: 401, headers: { "Content-Type": "application/problem+json; charset=utf-8" } })) as typeof fetch);
  await assert.rejects(versionMismatch401.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "version" && error.status === 401 && error.upstreamType === "versionMistmatch");

  const problem500 = new WebDkClient("3.00", (async () => new Response(JSON.stringify({
    type: "internal_error",
    title: "Internal Server Error",
    status: 500,
  }), { status: 500, headers: { "Content-Type": "application/problem+json; charset=utf-8" } })) as typeof fetch);
  await assert.rejects(problem500.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "server" && error.status === 500 && error.upstreamType === "internal_error");

  const subjects401 = new WebDkClient("3.00", (async () => new Response(JSON.stringify({
    title: "Unauthorized",
    status: 401,
  }), { status: 401, headers: { "Content-Type": "application/problem+json; charset=utf-8" } })) as typeof fetch);
  await assert.rejects(subjects401.getStudentSubjects("x"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "unauthorized" && error.upstreamType === "Unauthorized");
  await assert.rejects(subjects401.getStudentProfile("x"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "unauthorized" && error.upstreamType === "Unauthorized");

  const malformed = new WebDkClient("3.00", (async () => jsonResponse([{ disciplineName: "Missing dates" }])) as typeof fetch);
  await assert.rejects(malformed.getSchedule("x", "from", "to"), (error: unknown) => error instanceof WebDkError && error.kind === "malformed");
});

test("HTML 405 responses are classified as upstream server errors with safe metadata", async () => {
  const html405 = "<html><head><title>405 Not Allowed</title></head><body><h1>405 Not Allowed</h1></body></html>";
  const client = new WebDkClient("3.00", (async () => new Response(html405, {
    status: 405,
    headers: { "Content-Type": "text/html" },
  })) as typeof fetch);

  await assert.rejects(client.login("x@y.ua", "pass"), (error: unknown) =>
    error instanceof WebDkError &&
    error.kind === "server" &&
    error.status === 405 &&
    error.endpoint === "auth/login" &&
    error.contentType === "text/html");

  await assert.rejects(client.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError &&
    error.kind === "server" &&
    error.status === 405 &&
    error.endpoint === "schedule/get" &&
    error.contentType === "text/html");

  const okHtml = new WebDkClient("3.00", (async () => new Response(html405, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  })) as typeof fetch);
  await assert.rejects(okHtml.getSchedule("x", "from", "to"), (error: unknown) =>
    error instanceof WebDkError && error.kind === "malformed" && error.status === 200);
});

test("network failures are normalized", async () => {
  const client = new WebDkClient("3.00", (async () => { throw new Error("offline"); }) as typeof fetch);
  await assert.rejects(client.login("x@y.ua", "pass"), (error: unknown) => error instanceof WebDkError && error.kind === "network");
});
