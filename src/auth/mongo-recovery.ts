import { setTimeout as sleep } from "node:timers/promises";
import type { AuthSession } from "../types.js";
import { AuthStoreUnavailableError, type AuthStore } from "./auth-store.js";
import { databaseDiagnostic } from "./mongo-diagnostics.js";

interface RecoveryDependencies {
  store: AuthStore;
  connect(): Promise<unknown>;
  initialize(): Promise<unknown>;
  ping(): Promise<unknown>;
  close(): Promise<unknown>;
  logger?: Pick<Console, "info" | "error">;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** One recovery worker, one client, no replay of user operations. */
export class RecoveringAuthStore implements AuthStore {
  private ready = false;
  private readonly abort = new AbortController();
  private worker?: Promise<void>;
  private probe?: Promise<boolean>;
  private generation = 0;
  constructor(private readonly deps: RecoveryDependencies) {}

  start(): void { this.worker ??= this.run(); }
  async stop(): Promise<void> {
    this.abort.abort();
    this.ready = false;
    // Wait for bounded in-flight connect/index operations before closing the client.
    await this.worker;
    await this.probe;
    await this.deps.close();
  }

  async checkReady(): Promise<boolean> {
    if (!this.ready || this.abort.signal.aborted) return false;
    this.probe ??= this.check().finally(() => { this.probe = undefined; });
    return this.probe;
  }
  private async check(): Promise<boolean> {
    const generation = this.generation;
    try {
      await this.deps.ping();
      return this.ready && generation === this.generation && !this.abort.signal.aborted;
    } catch (error) {
      this.unavailable(error, "ping");
      return false;
    }
  }
  private unavailable(error: unknown, stage: string): void {
    this.ready = false;
    this.generation++;
    (this.deps.logger ?? console).error("Authorization database unavailable", { stage, ...databaseDiagnostic(error) });
  }
  private async operation<T>(action: () => Promise<T>): Promise<T> {
    if (!this.ready || this.abort.signal.aborted) throw new AuthStoreUnavailableError();
    try { return await action(); }
    catch (error) { this.unavailable(error, "operation"); throw new AuthStoreUnavailableError(error); }
  }
  get(userId: string, now?: number): Promise<AuthSession | undefined> { return this.operation(() => this.deps.store.get(userId, now)); }
  set(userId: string, session: AuthSession): Promise<void> { return this.operation(() => this.deps.store.set(userId, session)); }
  delete(userId: string, token?: string): Promise<void> { return this.operation(() => this.deps.store.delete(userId, token)); }

  private async run(): Promise<void> {
    let attempt = 0;
    const wait = this.deps.wait ?? ((ms, signal) => sleep(ms, undefined, { signal }));
    while (!this.abort.signal.aborted) {
      let delay = 15000;
      if (!this.ready) {
        const started = Date.now();
        let stage = "connect";
        attempt++;
        try {
          await this.deps.connect();
          if (this.abort.signal.aborted) break;
          stage = "index";
          await this.deps.initialize();
          if (this.abort.signal.aborted) break;
          this.ready = true;
          (this.deps.logger ?? console).info("Authorization database ready", { attempt, elapsedMs: Date.now() - started });
          attempt = 0;
        } catch (error) {
          this.ready = false;
          const base = Math.min(60000, 1000 * 2 ** Math.min(attempt - 1, 6));
          delay = Math.min(60000, Math.round(base * (1 + (this.deps.random ?? Math.random)() * 0.2)));
          (this.deps.logger ?? console).error("Authorization database initialization failed", {
            stage, attempt, elapsedMs: Date.now() - started, retryInMs: delay, ...databaseDiagnostic(error),
          });
        }
      } else {
        await this.checkReady();
        if (!this.ready) continue;
      }
      try { await wait(delay, this.abort.signal); }
      catch { if (!this.abort.signal.aborted) throw new Error("Recovery timer failed"); }
    }
  }
}
