import type { LoginResult, ScheduleLesson, StudentSubject, WebDkStudentProfile } from "../types.js";

const BASE_URL = process.env.BASE_URL || "https://web-dk.lntu.edu.ua/WebDk/";

export type WebDkErrorKind = "credentials" | "unauthorized" | "version" | "network" | "server" | "malformed";

export class WebDkError extends Error {
  constructor(public readonly kind: WebDkErrorKind, message: string, public readonly status?: number, public readonly upstreamCode?: number) {
    super(message);
    this.name = "WebDkError";
  }
}

type FetchLike = typeof fetch;

export class WebDkClient {
  constructor(
    private readonly apiVersion: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const body = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      version: this.apiVersion,
    });

    const response = await this.request("token", {
      method: "POST",
      headers: {
        Accept: "application/json, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body,
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const description = getString(payload, "error_description") || getString(payload, "message") || "Authorization failed";
      if (response.status === 400 && /version/i.test(description)) throw new WebDkError("version", description, response.status);
      if (response.status === 400 || response.status === 401) throw new WebDkError("credentials", description, response.status);
      throw new WebDkError("server", description, response.status);
    }

    const accessToken = getString(payload, "access_token");
    const tokenType = getString(payload, "token_type");
    const expiresIn = getNumber(payload, "expires_in");
    if (!accessToken || !tokenType || !expiresIn || expiresIn <= 0) {
      throw new WebDkError("malformed", "Malformed token response", response.status);
    }
    return { accessToken, tokenType, expiresIn };
  }

  async getSchedule(accessToken: string, dateFrom: string, dateTo: string): Promise<ScheduleLesson[]> {
    const response = await this.request("api/schedule/get", {
      method: "POST",
      headers: {
        Accept: "application/json;q=0.9,*/*;q=0.8",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ dateFrom, dateTo }),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const code = getNumber(payload, "errorCode");
      // Match the explicit rejection signals used by WebDk's own client.
      if (code === 20700 || (response.status === 401 && getString(payload, "message") === "Authorization has been denied for this request.")) {
        throw new WebDkError("unauthorized", "Session expired", response.status, code);
      }
      throw new WebDkError("server", getString(payload, "message") || "Schedule request failed", response.status, code);
    }
    if (!Array.isArray(payload)) throw new WebDkError("malformed", "Schedule response is not an array", response.status);
    return payload.map(validateLesson);
  }

  async getStudentSubjects(accessToken: string): Promise<StudentSubject[]> {
    const response = await this.request("api/testResult/list", {
      method: "POST",
      headers: {
        Accept: "application/json;q=0.9,*/*;q=0.8",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const code = getNumber(payload, "errorCode");
      if (code === 20700 || (response.status === 401 && getString(payload, "message") === "Authorization has been denied for this request.")) {
        throw new WebDkError("unauthorized", "Session expired", response.status, code);
      }
      throw new WebDkError("server", getString(payload, "message") || "Student-subject request failed", response.status, code);
    }
    if (!Array.isArray(payload)) throw new WebDkError("malformed", "Student-subject response is not an array", response.status);
    return payload.map(validateStudentSubject);
  }

  async getStudentProfile(accessToken: string): Promise<WebDkStudentProfile> {
    const response = await this.request("api/studentAnketa/studentAnketa", {
      method: "POST",
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    const payload = await readJson(response);
    if (!response.ok) throwWebDkResponseError(response, payload, "Student-profile request failed");
    const data = record(payload);
    if (!data || typeof data.courseName !== "string") throw new WebDkError("malformed", "Student profile has no course", response.status);
    return { courseName: data.courseName, educationLevelName: optionalString(data, "osvitaLevelName") };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof WebDkError) throw error;
      throw new WebDkError("network", error instanceof Error ? error.message : "Network request failed");
    }
  }
}

function throwWebDkResponseError(response: Response, payload: unknown, fallback: string): never {
  const code = getNumber(payload, "errorCode");
  if (code === 20700 || (response.status === 401 && getString(payload, "message") === "Authorization has been denied for this request.")) {
    throw new WebDkError("unauthorized", "Session expired", response.status, code);
  }
  throw new WebDkError("server", getString(payload, "message") || fallback, response.status, code);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new WebDkError("malformed", "Response is not valid JSON", response.status);
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
