import { randomBytes } from "node:crypto";

export interface ScheduleImageBundle { ownerId: string; pages: Buffer[]; expiresAt: number; title?: string; }

/** Short-lived public files for Telegram's inline photo fetches. */
export class ScheduleImageStore {
  private readonly bundles = new Map<string, ScheduleImageBundle>();
  constructor(private readonly lifetimeMs = 60 * 60 * 1000) {}

  put(ownerId: string, pages: Buffer[], title?: string): string {
    this.prune();
    const id = randomBytes(24).toString("base64url");
    this.bundles.set(id, { ownerId, pages, title, expiresAt: Date.now() + this.lifetimeMs });
    return id;
  }

  get(id: string): ScheduleImageBundle | undefined {
    const bundle = this.bundles.get(id);
    if (!bundle || bundle.expiresAt <= Date.now()) { this.bundles.delete(id); return undefined; }
    return bundle;
  }

  clearOwner(ownerId: string): void {
    for (const [id, bundle] of this.bundles) if (bundle.ownerId === ownerId) this.bundles.delete(id);
  }

  private prune(): void { for (const [id, bundle] of this.bundles) if (bundle.expiresAt <= Date.now()) this.bundles.delete(id); }
}
