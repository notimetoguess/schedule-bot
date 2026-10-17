import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export class InitDataError extends Error {}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramWebAppUser {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const rawUser = params.get("user");
  if (!receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash) || !Number.isInteger(authDate) || !rawUser) {
    throw new InitDataError("Missing signed Telegram fields");
  }
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new InitDataError("Telegram authorization data expired");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new InitDataError("Invalid Telegram signature");
  }

  let user: unknown;
  try { user = JSON.parse(rawUser); } catch { throw new InitDataError("Invalid Telegram user"); }
  if (!isTelegramUser(user)) throw new InitDataError("Invalid Telegram user");
  return user;
}

function isTelegramUser(value: unknown): value is TelegramWebAppUser {
  return typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    Number.isSafeInteger((value as { id: number }).id) && (value as { id: number }).id > 0;
}
