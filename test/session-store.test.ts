import assert from "node:assert/strict";
import test from "node:test";
import { TtlMemoryStore } from "../src/stores/session-store.js";

test("memory sessions expire and close clears data", () => {
  const store = new TtlMemoryStore<{ value: number }>(10);
  store.set("one", { value: 1 });
  assert.deepEqual(store.get("one"), { value: 1 });
  store.sweep(Date.now() + 20);
  assert.equal(store.get("one"), undefined);
  store.set("two", { value: 2 });
  store.close();
  assert.equal(store.get("two"), undefined);
});
