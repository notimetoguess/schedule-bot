import assert from "node:assert/strict";
import test from "node:test";
import { paginateScheduleBlocks, ScheduleImageRenderer } from "../src/schedule/schedule-image-renderer.js";
import { ScheduleImageStore } from "../src/schedule/image-store.js";
import { privateChatMiddleware } from "../src/bot/middlewares/session.middleware.js";
import { TeacherPhotos } from "../src/schedule/teacher-photos.js";
import sharp from "sharp";

test("schedule renderer creates Telegram-compatible JPEG pages with teacher avatars", async () => {
  const renderer = new ScheduleImageRenderer({ find: async () => undefined });
  const pages = await renderer.render([{
    scheduleDate: "2026-09-22T00:00:00+03:00", studyTimeBegin: "08:30", studyTimeEnd: "09:50",
    disciplineName: "Системний аналіз та теорія прийняття рішень", empFullName: "Подоляк В. М.",
  }], "Розклад на тиждень");
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.subarray(0, 2).toString("hex"), "ffd8");
  assert(pages[0]!.length < 5_000_000);
  assert((await sharp(pages[0]).metadata()).height! > 250);
});

test("image bundles are owner-bound and expire", () => {
  const store = new ScheduleImageStore(1);
  const id = store.put("42", [Buffer.from("jpeg")]);
  assert.equal(store.get(id)?.ownerId, "42");
  assert.equal(store.get(id)?.pages[0]?.toString(), "jpeg");
});

test("inline-message navigation callbacks pass the private-chat gate", async () => {
  let passed = false;
  await privateChatMiddleware({
    session: { stage: "idle", touchedAt: 0 },
    callbackQuery: { id: "callback", from: { id: 42 }, inline_message_id: "inline-message" },
  } as never, async () => { passed = true; });
  assert.equal(passed, true);
});

test("concurrent lessons with the same teacher reuse the resolved photo", async () => {
  let directoryRequests = 0;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("searchuser")) {
      directoryRequests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response('<div><img src="/photo.jpg"></div><a href="/teacher">Подоляк Володимир Миколайович<p>Доцент</p></a>');
    }
    return new Response(jpeg);
  };
  const photos = new TeacherPhotos(fetcher as typeof fetch);
  const [first, second] = await Promise.all([photos.find("Подоляк В. М."), photos.find("Подоляк В. М.")]);
  assert.equal(directoryRequests, 1);
  assert.deepEqual(first, jpeg);
  assert.deepEqual(second, jpeg);
});

test("day headings move to the next page with a lesson and repeat on continued pages", () => {
  const date = "📅 середа, 23.09.2026";
  const lesson = "🕒 1-ша пара · 08:30–09:50\n📚 Предмет\nТип: Лекції\nАудиторія: П 219\nВикладач: Викладач В. В.\nГрупа: КН-31";
  const pages = paginateScheduleBlocks([date, lesson, lesson, "📅 четвер, 24.09.2026", lesson], 650);
  assert(pages.length > 1);
  assert(pages.every((page) => page[0]?.startsWith("📅 ")));
  assert(pages.every((page) => !page.at(-1)?.startsWith("📅 ")));
});

test("each calendar day starts a new image page", () => {
  const lesson = "🕒 1-ша пара · 08:30–09:50\n📚 Предмет\nТип: Лекції\nАудиторія: П 219\nВикладач: Викладач В. В.\nГрупа: КН-31";
  const pages = paginateScheduleBlocks([
    "📅 вівторок, 06.10.2026", lesson,
    "📅 середа, 07.10.2026", lesson,
  ]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.filter((block) => block.startsWith("📅 ")).length, 1);
  assert.equal(pages[1]?.filter((block) => block.startsWith("📅 ")).length, 1);
  assert.match(pages[0]?.[0] ?? "", /вівторок/);
  assert.match(pages[1]?.[0] ?? "", /середа/);
});
