import type { IncomingMessage, ServerResponse } from "node:http";
import { InitDataError, validateTelegramInitData } from "../../auth/telegram-init-data.js";
import { readBody } from "../request.js";
import { json } from "../response.js";
import type { AuthServerOptions } from "../types.js";

export async function issueChallenge(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthServerOptions,
): Promise<void> {
  let initData: string;
  try {
    const body = JSON.parse(await readBody(request)) as { initData?: unknown };
    if (typeof body.initData !== "string" || body.initData.length > 8192) throw new Error("Invalid request");
    initData = body.initData;
  } catch {
    json(response, 400, { code: "INVALID_SESSION" });
    return;
  }

  try {
    const user = validateTelegramInitData(initData, options.botToken, options.initDataMaxAgeSeconds);
    json(response, 200, { state: options.challenges.issue(String(user.id)) });
  } catch (error) {
    if (!(error instanceof InitDataError)) throw error;
    json(response, 401, { code: "INVALID_SESSION" });
  }
}
