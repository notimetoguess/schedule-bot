interface Stored<T> { value: T; expiresAt: number }

export class TtlMemoryStore<T> {
  private readonly values = new Map<string, Stored<T>>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {
    this.timer = setInterval(() => this.sweep(), Math.min(ttlMs, 60 * 60 * 1000));
    this.timer.unref();
  }

  get(key: string): T | undefined {
    const stored = this.values.get(key);
    if (!stored) return undefined;
    if (stored.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return stored.value;
  }

  set(key: string, value: T): void {
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  sweep(now = Date.now()): void {
    for (const [key, stored] of this.values) if (stored.expiresAt <= now) this.values.delete(key);
  }

  close(): void {
    clearInterval(this.timer);
    this.values.clear();
  }
}
