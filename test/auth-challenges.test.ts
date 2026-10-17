import assert from "node:assert/strict";
import test from "node:test";
import { AuthChallengeStore } from "../src/auth/auth-challenges.js";

test("challenge is user-bound, reused while active, and consumed once", () => {
  const store = new AuthChallengeStore(1_000);
  const state = store.issue("1", 100);
  assert.equal(state.length, 43);
  assert.equal(store.issue("1", 200), state);
  assert.equal(store.begin(state, "2", 200), false);
  assert.equal(store.begin(state, "1", 200), true);
  assert.equal(store.begin(state, "1", 200), false);
  store.release(state);
  assert.equal(store.begin(state, "1", 200), true);
  store.consume(state);
  assert.equal(store.begin(state, "1", 200), false);
});

test("expired challenges cannot be used", () => {
  const store = new AuthChallengeStore(100);
  const state = store.issue("1", 100);
  assert.equal(store.begin(state, "1", 201), false);
});
