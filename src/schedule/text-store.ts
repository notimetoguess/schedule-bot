import { randomBytes } from "node:crypto";

export interface ScheduleTextBundle { ownerId: string; pages: string[]; expiresAt: number; }

/** Short-lived pagination state for schedule text sent through inline mode. */
export class ScheduleTextStore {
  private readonly bundles = new Map<string, ScheduleTextBundle>();
  constructor(private readonly lifetimeMs = 60 * 60 * 1000) {}

  put(ownerId: string, pages: string[]): string {
    this.prune();
    const id = randomBytes(24).toString("base64url");
    this.bundles.set(id, { ownerId, pages, expiresAt: Date.now() + this.lifetimeMs });
    return id;
  }

  get(id: string): ScheduleTextBundle | undefined {
    const bundle = this.bundles.get(id);
    if (!bundle || bundle.expiresAt <= Date.now()) { this.bundles.delete(id); return undefined; }
    return bundle;
  }

  clearOwner(ownerId: string): void {
    for (const [id, bundle] of this.bundles) if (bundle.ownerId === ownerId) this.bundles.delete(id);
  }

  private prune(): void { for (const [id, bundle] of this.bundles) if (bundle.expiresAt <= Date.now()) this.bundles.delete(id); }
}
