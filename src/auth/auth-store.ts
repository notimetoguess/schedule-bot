import type { AuthSession } from "../types.js";

export interface AuthStore {
  get(userId: string, now?: number): Promise<AuthSession | undefined>;
  set(userId: string, session: AuthSession): Promise<void>;
  delete(userId: string, accessToken?: string): Promise<void>;
}

export class AuthStoreUnavailableError extends Error {
  constructor(cause?: unknown) { super("Authorization storage temporarily unavailable", { cause }); }
}

/** Test implementation; production never falls back to memory. */
export class MemoryAuthStore implements AuthStore {
  private readonly sessions = new Map<string, AuthSession>();
  async get(userId: string, now = Date.now()): Promise<AuthSession | undefined> {
    const session = this.sessions.get(userId);
    if (!session || session.expiresAt <= now) return undefined;
    const identity = session.authenticatedEmail ? { authenticatedEmail: session.authenticatedEmail } : {};
    return session.rememberedCredentials
      ? { ...session, ...identity, rememberedCredentials: { ...session.rememberedCredentials } }
      : { accessToken: session.accessToken, expiresAt: session.expiresAt, ...identity };
  }
  async set(userId: string, session: AuthSession): Promise<void> {
    this.sessions.set(userId, { ...session });
  }
  async delete(userId: string, accessToken?: string): Promise<void> {
    if (accessToken === undefined || this.sessions.get(userId)?.accessToken === accessToken) this.sessions.delete(userId);
  }
}
