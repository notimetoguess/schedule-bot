import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("Mini App sends a full WebDk email unchanged and expands LNTU shorthand", async () => {
  const handlers = new Map<string, Map<string, (event?: { preventDefault(): void }) => Promise<void> | void>>();
  const elements = new Map<string, {
    value: string; checked: boolean; hidden: boolean; disabled: boolean; type: string;
    textContent: string; className: string; validationMessage: string;
    addEventListener(name: string, handler: (event?: { preventDefault(): void }) => Promise<void> | void): void;
    setCustomValidity(message: string): void; reportValidity(): boolean; setAttribute(): void;
  }>();
  for (const id of ["auth-form", "email", "password", "remember-me", "submit", "status", "toggle-password", "auth-intro", "privacy", "success-panel", "return-current", "return-group", "email-domain"]) {
    elements.set(id, {
      value: "", checked: false, hidden: false, disabled: false, type: "text", textContent: "", className: "", validationMessage: "",
      addEventListener(name, handler) { handlers.get(id)?.set(name, handler); },
      setCustomValidity(message) { this.validationMessage = message; },
      reportValidity() { return !elements.get("email")?.validationMessage; },
      setAttribute() {},
    });
    handlers.set(id, new Map());
  }
  const requests: Array<{ email: string }> = [];
  runInNewContext(readFileSync(new URL("../src/webapp/auth.js", import.meta.url), "utf8"), {
    window: { Telegram: { WebApp: { ready() {}, expand() {}, initData: "", switchInlineQuery() {}, close() {} } } },
    document: { getElementById: (id: string) => elements.get(id) },
    location: { search: "?state=test-state", hash: "" },
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return { ok: false, json: async () => ({ code: "INVALID_CREDENTIALS" }) };
    },
  });

  const email = elements.get("email")!;
  const password = elements.get("password")!;
  const formSubmit = handlers.get("auth-form")!.get("submit")!;
  email.value = "student@another.example";
  password.value = "diagnostic-only";
  await formSubmit({ preventDefault() {} });
  assert.equal(requests.at(-1)?.email, "student@another.example");
  assert.equal(elements.get("email-domain")?.hidden, true);

  email.value = "student";
  password.value = "diagnostic-only";
  await formSubmit({ preventDefault() {} });
  assert.equal(requests.at(-1)?.email, "student@lntu.edu.ua");
  assert.equal(elements.get("email-domain")?.hidden, false);
});
