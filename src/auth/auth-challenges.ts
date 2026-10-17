import { createHash, randomBytes } from "node:crypto";

interface Challenge {
  userId: string;
  expiresAt: number;
  inFlight: boolean;
  state: string;
}

export class AuthChallengeStore {
  private readonly byHash = new Map<string, Challenge>();
  private readonly activeHashByUser = new Map<string, string>();
  private lastSweepAt = 0;

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  issue(userId: string, now = Date.now()): string {
    if (now - this.lastSweepAt >= this.ttlMs) this.sweep(now);
    const activeHash = this.activeHashByUser.get(userId);
    const active = activeHash ? this.byHash.get(activeHash) : undefined;
    if (active && active.expiresAt > now && !active.inFlight) return active.state;
    if (activeHash) this.remove(activeHash);

    const state = randomBytes(32).toString("base64url");
    const hash = hashState(state);
    this.byHash.set(hash, { userId, expiresAt: now + this.ttlMs, inFlight: false, state });
    this.activeHashByUser.set(userId, hash);
    return state;
  }

  begin(state: string, userId: string, now = Date.now()): boolean {
    const hash = hashState(state);
    const challenge = this.byHash.get(hash);
    if (!challenge || challenge.userId !== userId || challenge.inFlight) return false;
    if (challenge.expiresAt <= now) {
      this.remove(hash);
      return false;
    }
    challenge.inFlight = true;
    return true;
  }

  beginBound(state: string, now = Date.now()): string | undefined {
    const hash = hashState(state);
    const challenge = this.byHash.get(hash);
    if (!challenge || challenge.inFlight) return undefined;
    if (challenge.expiresAt <= now) {
      this.remove(hash);
      return undefined;
    }
    challenge.inFlight = true;
    return challenge.userId;
  }

  release(state: string): void {
    const challenge = this.byHash.get(hashState(state));
    if (challenge) challenge.inFlight = false;
  }

  consume(state: string): void {
    this.remove(hashState(state));
  }

  clear(): void {
    this.byHash.clear();
    this.activeHashByUser.clear();
  }

  private sweep(now: number): void {
    for (const [hash, challenge] of this.byHash) if (challenge.expiresAt <= now) this.remove(hash);
    this.lastSweepAt = now;
  }

  private remove(hash: string): void {
    const challenge = this.byHash.get(hash);
    if (challenge && this.activeHashByUser.get(challenge.userId) === hash) this.activeHashByUser.delete(challenge.userId);
    this.byHash.delete(hash);
  }
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
