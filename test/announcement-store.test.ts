import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAnnouncementStore, validate } from "../src/announcements/announcement-store.js";

test("announcement validation accepts existing delivery media shapes and caption limits", () => {
  assert.doesNotThrow(() => validate("text"));
  assert.doesNotThrow(() => validate("caption", { type: "photo", fileId: "telegram-file" }));
  assert.doesNotThrow(() => validate("caption", { type: "video", url: "https://cdn.example/video.mp4" }));
  assert.throws(() => validate("caption", { type: "photo", url: "http://example.com/a.jpg" }));
  assert.throws(() => validate("caption", { type: "photo", url: "https://example.com/a.jpg", fileId: "file" }));
  assert.throws(() => validate("x".repeat(1025), { type: "photo", fileId: "file" }));
  assert.throws(() => validate("x".repeat(4097)));
});

test("drafts are owner-scoped and publication is idempotent", async () => {
  const store = new MemoryAnnouncementStore();
  const draft = await store.create("admin");
  const saved = await store.update("admin", draft.id, draft.revision, { text: "Hello", media: { type: "photo", fileId: "photo-file" } });
  assert.equal(typeof saved, "object");
  if (typeof saved !== "object") return;
  assert.equal(await store.get("other", draft.id), undefined);
  const published = await store.publish("admin", draft.id, saved.revision);
  assert.equal(typeof published, "object");
  if (typeof published !== "object") return;
  assert.equal(published.status, "published");
  assert(published.publishedAt instanceof Date);
  const repeated = await store.publish("admin", draft.id, saved.revision);
  assert.equal(typeof repeated, "object");
  if (typeof repeated === "object") assert.equal(repeated.publishedAt?.getTime(), published.publishedAt.getTime());
});
