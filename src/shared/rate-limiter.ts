export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly maxRequests = 5,
    private readonly windowMs = 30_000,
  ) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const recent = (this.requests.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.maxRequests) {
      this.requests.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(1, recent[0]! + this.windowMs - now) };
    }
    recent.push(now);
    this.requests.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear(): void {
    this.requests.clear();
  }
}
