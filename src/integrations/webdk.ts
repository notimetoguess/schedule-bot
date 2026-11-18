import type { LoginResult, ScheduleLesson, StudentSubject, WebDkStudentProfile } from "../types.js";

export const DEFAULT_WEBDK_BASE_URL = "https://web-dk.lntu.edu.ua/api/student/";

export function normalizeWebDkBaseUrl(rawUrl: string | undefined): string {
  const value = rawUrl?.trim() || DEFAULT_WEBDK_BASE_URL;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BASE_URL must use http:// or https://");
  }
  return value.replace(/\/+$/, "") + "/";
}

export type WebDkErrorKind = "credentials" | "unauthorized" | "version" | "network" | "server" | "malformed";

export class WebDkError extends Error {
  constructor(
    public readonly kind: WebDkErrorKind,
    message: string,
    public readonly status?: number,
    public readonly upstreamCode?: number,
    public readonly endpoint?: string,
    public readonly contentType?: string | null,
  ) {
    super(message);
    this.name = "WebDkError";
  }
}

type FetchLike = typeof fetch;

export class WebDkClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiVersion: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 15_000,
    baseUrl: string = normalizeWebDkBaseUrl(process.env.BASE_URL),
  ) {
    this.baseUrl = normalizeWebDkBaseUrl(baseUrl);
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const endpoint = "auth/login";
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        login: username,
        password,
        version: this.apiVersion,
      }),
    });
    const contentType = response.headers.get("content-type");
    const payload = await readPayload(response, endpoint);

    if (!response.ok) {
      const errorType = getString(payload, "type");
      const description = getString(payload, "detail") || getString(payload, "error_description") ||
        getString(payload, "errorDetails") || getString(payload, "message") ||
        getString(payload, "errorMessage") || getString(payload, "title") || "Authorization failed";
      if (errorType === "versionMistmatch" || ((response.status === 400 || response.status === 401) && /version|версіях/i.test(description))) {
        throw new WebDkError("version", description, response.status, undefined, endpoint, contentType);
      }
      // WebDk currently returns HTTP 500 for an incorrect login/password.
      if (/не\s*вірний\s+логін\s+або\s+пароль/iu.test(description)) {
        throw new WebDkError("credentials", "Incorrect login or password", response.status, undefined, endpoint, contentType);
      }
      if (response.status === 400 || response.status === 401) {
        throw new WebDkError("credentials", description, response.status, undefined, endpoint, contentType);
      }
      throw new WebDkError("server", description, response.status, undefined, endpoint, contentType);
    }

    const accessToken = getString(payload, "access_token");
    const tokenType = getString(payload, "token_type") || "Bearer";
    const explicitExpiresIn = getNumber(payload, "expires_in");
    if (!accessToken || (explicitExpiresIn !== undefined && explicitExpiresIn <= 0)) {
      throw new WebDkError("malformed", "Malformed token response", response.status, undefined, endpoint, contentType);
    }
    const expiresIn = explicitExpiresIn ?? parseJwtExpiresInSeconds(accessToken) ?? Number.MAX_SAFE_INTEGER;
    return { accessToken, tokenType, expiresIn };
  }

  async getSchedule(accessToken: string, dateFrom: string, dateTo: string): Promise<ScheduleLesson[]> {
    const endpoint = "schedule/get";
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json;q=0.9,*/*;q=0.8",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ dateFrom, dateTo }),
    });
    const contentType = response.headers.get("content-type");
    const payload = await readPayload(response, endpoint);

    if (!response.ok) throwWebDkResponseError(response, payload, contentType, endpoint, "Schedule request failed");
    if (!Array.isArray(payload)) {
      throw new WebDkError("malformed", "Schedule response is not an array", response.status, undefined, endpoint, contentType);
    }
    return payload.map(validateLesson);
  }

  async getStudentSubjects(accessToken: string): Promise<StudentSubject[]> {
    const endpoint = "testResult/list";
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json;q=0.9,*/*;q=0.8",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    const contentType = response.headers.get("content-type");
    const payload = await readPayload(response, endpoint);

    if (!response.ok) throwWebDkResponseError(response, payload, contentType, endpoint, "Student-subject request failed");
    if (!Array.isArray(payload)) {
      throw new WebDkError("malformed", "Student-subject response is not an array", response.status, undefined, endpoint, contentType);
    }
    return payload.map(validateStudentSubject);
  }

  async getStudentProfile(accessToken: string): Promise<WebDkStudentProfile> {
    const endpoint = "studentAnketa/studentAnketa2";
    const response = await this.request(endpoint, {
      method: "POST",
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    const contentType = response.headers.get("content-type");
    const payload = await readPayload(response, endpoint);

    if (!response.ok) throwWebDkResponseError(response, payload, contentType, endpoint, "Student-profile request failed");
    const item = Array.isArray(payload) ? payload[0] : payload;
    const data = record(item);
    if (!data || typeof data.courseName !== "string") {
      throw new WebDkError("malformed", "Student profile has no course", response.status, undefined, endpoint, contentType);
    }
    return { courseName: data.courseName, educationLevelName: optionalString(data, "osvitaLevelName") };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof WebDkError) throw error;
      throw new WebDkError("network", error instanceof Error ? error.message : "Network request failed", undefined, undefined, path);
    }
  }
}

function throwWebDkResponseError(
  response: Response,
  payload: unknown,
  contentType: string | null,
  endpoint: string,
  fallback: string,
): never {
  const code = getNumber(payload, "errorCode");
  const error = getString(payload, "error");
  const message = getString(payload, "message");
  // Match the explicit rejection signals used by WebDk's clients (v3 invalid_token and legacy 20700/denied).
  if (
    code === 20700 ||
    (response.status === 401 && (error === "invalid_token" || message === "Authorization has been denied for this request."))
  ) {
    throw new WebDkError("unauthorized", "Session expired", response.status, code, endpoint, contentType);
  }
  const detail = getString(payload, "detail") || message || getString(payload, "error_description") || fallback;
  throw new WebDkError("server", detail, response.status, code, endpoint, contentType);
}

async function readPayload(response: Response, endpoint: string): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new WebDkError("server", `Upstream HTTP ${response.status} empty response`, response.status, undefined, endpoint, contentType);
    }
    throw new WebDkError("malformed", "Response body is empty", response.status, undefined, endpoint, contentType);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new WebDkError("server", `Upstream HTTP ${response.status} non-JSON response`, response.status, undefined, endpoint, contentType);
    }
    throw new WebDkError("malformed", "Response is not valid JSON", response.status, undefined, endpoint, contentType);
  }
}

function parseJwtExpiresInSeconds(token: string, nowMs = Date.now()): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    const exp = getNumber(payload, "exp");
    if (!exp) return undefined;
    const remaining = Math.floor(exp - nowMs / 1000);
    return remaining > 0 ? remaining : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, key: string): string | undefined {
  const item = record(value)?.[key];
  return typeof item === "string" ? item : undefined;
}

function getNumber(value: unknown, key: string): number | undefined {
  const item = record(value)?.[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function validateLesson(value: unknown, index: number): ScheduleLesson {
  const data = record(value);
  if (!data || typeof data.scheduleDate !== "string" || typeof data.studyTimeBegin !== "string" ||
      typeof data.studyTimeEnd !== "string" || typeof data.disciplineName !== "string") {
    throw new WebDkError("malformed", `Malformed lesson at index ${index}`);
  }
  return {
    scheduleDate: data.scheduleDate,
    studyTimeBegin: data.studyTimeBegin,
    studyTimeEnd: data.studyTimeEnd,
    disciplineName: data.disciplineName,
    studyTimeName: optionalString(data, "studyTimeName"),
    studyTypeName: optionalString(data, "studyTypeName"),
    cabinetNumber: optionalString(data, "cabinetNumber"),
    empFullName: optionalString(data, "empFullName"),
    contingentName: optionalString(data, "contingentName"),
    chairName: optionalString(data, "chairName"),
    contentNotes: optionalString(data, "contentNotes"),
    cntOneDay: typeof data.cntOneDay === "number" ? data.cntOneDay : undefined,
  };
}

function validateStudentSubject(value: unknown, index: number): StudentSubject {
  const data = record(value);
  if (!data || typeof data.disciplineName !== "string" || typeof data.semesterName !== "string" ||
      !(typeof data.semesterId === "number" || (typeof data.semesterId === "string" && /^\d+$/.test(data.semesterId)))) {
    throw new WebDkError("malformed", `Malformed student subject at index ${index}`);
  }
  return { disciplineName: data.disciplineName, semesterId: Number(data.semesterId), semesterName: data.semesterName };
}
