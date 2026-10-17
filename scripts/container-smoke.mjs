// Run from /app in the production image via stdin; never starts Telegram or MongoDB.
// docker run --rm -i --network none --memory 256m --memory-swap 256m --cpus 0.1 \
//   schedule-bot:northflank node --input-type=module < scripts/container-smoke.mjs
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { createAuthServer } from "./dist/src/http/auth-server.js";
import { MemoryAuthStore } from "./dist/src/auth/auth-store.js";
import { AuthChallengeStore } from "./dist/src/auth/auth-challenges.js";
import { SlidingWindowRateLimiter } from "./dist/src/shared/rate-limiter.js";
import { ScheduleImageRenderer } from "./dist/src/schedule/schedule-image-renderer.js";
import { ScheduleImageStore } from "./dist/src/schedule/image-store.js";

assert.notEqual(process.getuid(), 0, "runtime must be non-root");
for (const excluded of [".env", "src", "test", "dist/test", "node_modules/typescript"]) {
  await assert.rejects(access(excluded), { code: "ENOENT" });
}
const challenges = new AuthChallengeStore();
const requestLimiter = new SlidingWindowRateLimiter(2, 30_000);
const images = new ScheduleImageStore();
let ready = true;
const server = createAuthServer({
  botToken: "999:container-smoke-only",
  publicUrl: "https://smoke.invalid",
  initDataMaxAgeSeconds: 300,
  authSessionMaxAgeSeconds: 604800,
  authStore: new MemoryAuthStore(), challenges, requestLimiter,
  checkReady: async () => ready,
  webDk: { login: async () => { throw new Error("No upstream calls in container smoke"); } },
  scheduleImageStore: images,
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(3000, "0.0.0.0", resolve);
});
const origin = "http://127.0.0.1:3000";
const started = performance.now();
try {
  for (const [path, type] of [
    ["/health", "application/json"], ["/ready", "application/json"],
    ["/auth", "text/html"], ["/auth.js", "text/javascript"], ["/auth.css", "text/css"],
    ...["today-calendar.png", "weekly-calendar.png", "marked-calendar.png"].map(name => ["/assets/inline/" + name, "image/png"]),
    ...["show.jpg", "authorized.jpg", "logout.jpg", "need-authorize.jpg"].map(name => ["/assets/inline/" + name, "image/jpeg"]),
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert(response.headers.get("content-type")?.startsWith(type), path);
    assert((await response.arrayBuffer()).byteLength > 0, path);
  }
  ready = false;
  assert.equal((await fetch(origin + "/ready")).status, 503);
  assert.equal((await fetch(origin + "/health")).status, 200);

  // Three concurrent requests, each spanning three full days, with local avatars.
  const photo = await sharp({ create: { width: 280, height: 280, channels: 3, background: "#2d6cc0" } }).jpeg().toBuffer();
  const renderer = new ScheduleImageRenderer({ find: async () => photo });
  const lessons = Array.from({ length: 18 }, (_, i) => ({
    scheduleDate: `2026-10-${String(5 + Math.floor(i / 6)).padStart(2, "0")}T00:00:00+03:00`,
    studyTimeBegin: "08:30", studyTimeEnd: "09:50",
    disciplineName: "Системний аналіз та теорія прийняття рішень",
    empFullName: "Викладач В. В.",
  }));
  const bundles = await Promise.all(Array.from({ length: 3 }, () => renderer.render(lessons, "Розклад на тиждень")));
  for (const pages of bundles) {
    assert(pages.length >= 3);
    const id = images.put("smoke", pages);
    for (const [index, page] of pages.entries()) {
      const metadata = await sharp(page).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, 1200);
      assert(page.length < 5_000_000);
      const response = await fetch(`${origin}/schedule-images/${id}/${index}.jpg`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), page);
    }
  }
  const peak = await readFile("/sys/fs/cgroup/memory.peak", "utf8").catch(() => "unavailable");
  console.log(JSON.stringify({
    result: "passed", platform: process.platform, architecture: process.arch,
    node: process.version, pages: bundles.reduce((sum, pages) => sum + pages.length, 0),
    elapsedSeconds: Math.round((performance.now() - started) / 1000),
    processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    containerPeakMiB: Number.isFinite(Number(peak)) ? Math.round(Number(peak) / 1024 / 1024) : peak.trim(),
  }));
} finally {
  await new Promise(resolve => server.close(resolve));
  challenges.clear();
  requestLimiter.clear();
}
