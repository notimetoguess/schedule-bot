import type { Collection } from "mongodb";
import { databaseDiagnostic } from "./mongo-diagnostics.js";
import type { AuthSession, EncryptedCredentials } from "../types.js";
import { AuthStoreUnavailableError, type AuthStore } from "./auth-store.js";

export interface AuthDocument {
  _id: string;
  accessToken: string;
  createdAt: Date;
  expiresAt: Date;
  rememberedCredentials?: EncryptedCredentials;
  authenticatedEmail?: string;
}

type Logger = Pick<Console, "info" | "warn" | "error">;

export class MongoAuthStore implements AuthStore {
  constructor(private readonly collection: Collection<AuthDocument>, private readonly logger: Logger = console) {}

  async initialize(): Promise<void> {
    await this.run("initialize", undefined, () => this.collection.createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, name: "auth_session_expiry", timeoutMS: 10000 },
    ));
  }

  async get(userId: string, now?: number): Promise<AuthSession | undefined> {
    return this.run("get", userId, async () => {
      const document = await this.collection.findOne({ _id: userId }, { timeoutMS: 10000 });
      if (!document) {
        this.logger.info("Authorization session missing", { userId });
        return undefined;
      }
      // TTL is asynchronous cleanup, never the authorization boundary.
      if (!(document.expiresAt instanceof Date) || !Number.isFinite(document.expiresAt.getTime())) {
        throw new Error("Invalid session expiry");
      }
      if (document.expiresAt.getTime() <= (now ?? Date.now())) {
        this.logger.info("Authorization session locally expired", { userId, createdAt: document.createdAt, expiresAt: document.expiresAt });
        return undefined;
      }
      return { accessToken: document.accessToken, expiresAt: document.expiresAt.getTime(), rememberedCredentials: document.rememberedCredentials, ...(document.authenticatedEmail ? { authenticatedEmail: document.authenticatedEmail } : {}) };
    });
  }

  async set(userId: string, session: AuthSession): Promise<void> {
    await this.run("set", userId, async () => {
      const document: AuthDocument = {
        _id: userId, accessToken: session.accessToken,
        createdAt: new Date(), expiresAt: new Date(session.expiresAt), rememberedCredentials: session.rememberedCredentials, authenticatedEmail: session.authenticatedEmail,
      };
      await this.collection.replaceOne({ _id: userId }, document, { upsert: true, timeoutMS: 10000 });
      this.logger.info("Authorization session saved", { userId, createdAt: document.createdAt, expiresAt: document.expiresAt });
    });
  }

  async delete(userId: string, accessToken?: string): Promise<void> {
    await this.run("delete", userId, async () => {
      await this.collection.deleteOne({ _id: userId, ...(accessToken === undefined ? {} : { accessToken }) }, { timeoutMS: 10000 });
    });
  }

  private async run<T>(operation: string, userId: string | undefined, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      // Driver errors may contain connection strings or document contents.
      this.logger.error("Authorization database error", { operation, ...databaseDiagnostic(error) });
      throw new AuthStoreUnavailableError(error);
    }
  }
}
