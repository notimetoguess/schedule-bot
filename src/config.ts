import "dotenv/config";

export interface Config {
  botToken: string;
  apiVersion: string;
  authWebAppUrl: string;
  authHost: string;
  authPort: number;
  initDataMaxAgeSeconds: number;
  authSessionMaxAgeSeconds: number;
  mongoUri: string;
  mongoDatabase: string;
  credentialsEncryptionKey?: Buffer;
  adminEmails: ReadonlySet<string>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) throw new Error("BOT_TOKEN is required");
  const authWebAppUrl = env.AUTH_WEBAPP_URL?.trim().replace(/\/+$/, "");
  if (!authWebAppUrl) throw new Error("AUTH_WEBAPP_URL is required");
  const parsedUrl = new URL(authWebAppUrl);
  if (parsedUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
    throw new Error("AUTH_WEBAPP_URL must use HTTPS");
  }
  const platformPort = env.PORT?.trim();
  const authPort = platformPort
    ? positiveInteger(platformPort, 3000, "PORT", 65_535)
    : positiveInteger(env.AUTH_PORT, 3000, "AUTH_PORT", 65_535);
  const initDataMaxAgeSeconds = positiveInteger(env.WEBAPP_INIT_DATA_MAX_AGE_SECONDS, 300, "WEBAPP_INIT_DATA_MAX_AGE_SECONDS");
  const authSessionMaxAgeSeconds = positiveInteger(env.AUTH_SESSION_MAX_AGE_SECONDS, 604_800, "AUTH_SESSION_MAX_AGE_SECONDS");
  const mongoUri = env.MONGODB_URI?.trim();
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) throw new Error("MONGODB_URI must use mongodb:// or mongodb+srv://");
  const mongoDatabase = env.MONGODB_DATABASE?.trim() || "schedule_bot";
  const encodedKey = env.AUTH_CREDENTIALS_ENCRYPTION_KEY?.trim();
  const adminEmails = new Set((env.ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  let credentialsEncryptionKey: Buffer | undefined;
  if (encodedKey) {
    try { credentialsEncryptionKey = Buffer.from(encodedKey, "base64"); } catch { throw new Error("AUTH_CREDENTIALS_ENCRYPTION_KEY must be base64"); }
    if (credentialsEncryptionKey.length !== 32) throw new Error("AUTH_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
  }

  return {
    botToken,
    apiVersion: env.WEBDK_API_VERSION?.trim() || "2.18",
    authWebAppUrl,
    authHost: env.AUTH_HOST?.trim() || (platformPort ? "0.0.0.0" : "127.0.0.1"),
    authPort,
    initDataMaxAgeSeconds,
    authSessionMaxAgeSeconds,
    mongoUri,
    mongoDatabase,
    credentialsEncryptionKey,
    adminEmails,
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum = Math.floor(Number.MAX_SAFE_INTEGER / 1000)): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new Error(name + " must be a positive integer");
  return parsed;
}
