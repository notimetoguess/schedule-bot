import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import type { AnnouncementAttachment, AnnouncementSnapshot } from "../notifications/types.js";

export interface CabinetAnnouncement {
  id: string;
  ownerId: string;
  status: "drafted" | "published";
  text: string;
  media?: AnnouncementAttachment;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}

interface AnnouncementDocument {
  _id: string;
  status: "drafted" | "published";
  text: string;
  media?: AnnouncementAttachment;
  frozen?: AnnouncementSnapshot;
  publishedAt?: Date;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
  revision?: number;
}

export interface AnnouncementStore {
  create(ownerId: string): Promise<CabinetAnnouncement>;
  get(ownerId: string, id: string): Promise<CabinetAnnouncement | undefined>;
  listDrafts(ownerId: string): Promise<CabinetAnnouncement[]>;
  update(ownerId: string, id: string, revision: number, content: Pick<CabinetAnnouncement, "text" | "media">): Promise<CabinetAnnouncement | "conflict" | undefined>;
  publish(ownerId: string, id: string, revision: number): Promise<CabinetAnnouncement | "conflict" | undefined>;
}

export class MongoAnnouncementStore implements AnnouncementStore {
  constructor(private readonly collection: Collection<AnnouncementDocument>) {}
  async create(ownerId: string): Promise<CabinetAnnouncement> {
    const now = new Date();
    const document: AnnouncementDocument = { _id: randomUUID(), status: "drafted", text: "", createdBy: ownerId, createdAt: now, updatedAt: now, revision: 0 };
    await this.collection.insertOne(document, { timeoutMS: 10_000 });
    return cabinet(document)!;
  }
  async get(ownerId: string, id: string): Promise<CabinetAnnouncement | undefined> {
    return cabinet(await this.collection.findOne({ _id: id, createdBy: ownerId }, { timeoutMS: 10_000 }));
  }
  async listDrafts(ownerId: string): Promise<CabinetAnnouncement[]> {
    return (await this.collection.find({ createdBy: ownerId, status: "drafted" }, { timeoutMS: 10_000 }).sort({ updatedAt: -1 }).limit(30).toArray()).flatMap((value) => {
      const result = cabinet(value); return result ? [result] : [];
    });
  }
  async update(ownerId: string, id: string, revision: number, content: Pick<CabinetAnnouncement, "text" | "media">): Promise<CabinetAnnouncement | "conflict" | undefined> {
    validate(content.text, content.media);
    const changed = await this.collection.findOneAndUpdate(
      { _id: id, createdBy: ownerId, status: "drafted", revision },
      { $set: { text: content.text, ...(content.media ? { media: content.media } : {}) }, ...(content.media ? {} : { $unset: { media: "" } }), $inc: { revision: 1 }, $currentDate: { updatedAt: true } },
      { returnDocument: "after", timeoutMS: 10_000 },
    );
    if (changed) return cabinet(changed)!;
    return await this.get(ownerId, id) ? "conflict" : undefined;
  }
  async publish(ownerId: string, id: string, revision: number): Promise<CabinetAnnouncement | "conflict" | undefined> {
    const current = await this.get(ownerId, id);
    if (!current) return undefined;
    if (current.status === "published") return current;
    if (current.revision !== revision) return "conflict";
    validate(current.text, current.media);
    const changed = await this.collection.findOneAndUpdate(
      { _id: id, createdBy: ownerId, status: "drafted", revision },
      { $set: { status: "published", frozen: { text: current.text, ...(current.media ? { media: current.media } : {}) } }, $inc: { revision: 1 }, $currentDate: { publishedAt: true, updatedAt: true } },
      { returnDocument: "after", timeoutMS: 10_000 },
    );
    return changed ? cabinet(changed)! : "conflict";
  }
}

/** Test/local implementation; production uses MongoDB so drafts survive restarts. */
export class MemoryAnnouncementStore implements AnnouncementStore {
  private readonly drafts = new Map<string, CabinetAnnouncement>();
  async create(ownerId: string): Promise<CabinetAnnouncement> {
    const now = new Date();
    const draft: CabinetAnnouncement = { id: randomUUID(), ownerId, status: "drafted", text: "", revision: 0, createdAt: now, updatedAt: now };
    this.drafts.set(draft.id, draft); return clone(draft);
  }
  async get(ownerId: string, id: string): Promise<CabinetAnnouncement | undefined> {
    const draft = this.drafts.get(id); return draft?.ownerId === ownerId ? clone(draft) : undefined;
  }
  async listDrafts(ownerId: string): Promise<CabinetAnnouncement[]> {
    return [...this.drafts.values()].filter((draft) => draft.ownerId === ownerId && draft.status === "drafted").map(clone);
  }
  async update(ownerId: string, id: string, revision: number, content: Pick<CabinetAnnouncement, "text" | "media">): Promise<CabinetAnnouncement | "conflict" | undefined> {
    const draft = this.drafts.get(id); if (!draft || draft.ownerId !== ownerId) return undefined;
    if (draft.status !== "drafted" || draft.revision !== revision) return "conflict";
    validate(content.text, content.media); draft.text = content.text; draft.media = content.media; draft.revision++; draft.updatedAt = new Date(); return clone(draft);
  }
  async publish(ownerId: string, id: string, revision: number): Promise<CabinetAnnouncement | "conflict" | undefined> {
    const draft = this.drafts.get(id); if (!draft || draft.ownerId !== ownerId) return undefined;
    if (draft.status === "published") return clone(draft);
    if (draft.revision !== revision) return "conflict";
    validate(draft.text, draft.media); draft.status = "published"; draft.revision++; draft.publishedAt = new Date(); draft.updatedAt = draft.publishedAt; return clone(draft);
  }
}

function cabinet(document: AnnouncementDocument | null): CabinetAnnouncement | undefined {
  if (!document?.createdBy || !document.createdAt || !document.updatedAt || typeof document.revision !== "number") return undefined;
  return { id: document._id, ownerId: document.createdBy, status: document.status, text: document.text, media: document.media, revision: document.revision, createdAt: document.createdAt, updatedAt: document.updatedAt, publishedAt: document.publishedAt };
}

function clone(value: CabinetAnnouncement): CabinetAnnouncement {
  return { ...value, ...(value.media ? { media: { ...value.media } } : {}), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), ...(value.publishedAt ? { publishedAt: new Date(value.publishedAt) } : {}) };
}

export function validate(text: string, media?: AnnouncementAttachment): void {
  if (!text.trim()) throw new Error("Announcement text is required");
  if (text.length > (media ? 1024 : 4096)) throw new Error(media ? "Media caption is too long" : "Announcement text is too long");
  if (!media) return;
  if (media.type !== "photo" && media.type !== "video") throw new Error("Unsupported media type");
  if (Boolean(media.url) === Boolean(media.fileId)) throw new Error("Media needs exactly one source");
  const source = media.url ?? media.fileId;
  if (!source || source.length > 2048) throw new Error("Invalid media source");
  if (media.url) { const url = new URL(media.url); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Media URL must use HTTPS"); }
}
