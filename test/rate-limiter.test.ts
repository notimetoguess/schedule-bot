import assert from "node:assert/strict";
import test from "node:test";
import { SlidingWindowRateLimiter } from "../src/shared/rate-limiter.js";

test("allows two requests per user in a rolling 30-second window", () => {
  const limiter = new SlidingWindowRateLimiter(2, 30_000);
  assert.equal(limiter.consume("user-1", 1_000).allowed, true);
  assert.equal(limiter.consume("user-1", 2_000).allowed, true);
  assert.deepEqual(limiter.consume("user-1", 3_000), { allowed: false, retryAfterMs: 28_000 });
  assert.equal(limiter.consume("user-1", 31_001).allowed, true);
});

test("tracks users independently", () => {
  const limiter = new SlidingWindowRateLimiter(2, 30_000);
  limiter.consume("user-1", 1_000);
  limiter.consume("user-1", 2_000);
  assert.equal(limiter.consume("user-2", 3_000).allowed, true);
});
