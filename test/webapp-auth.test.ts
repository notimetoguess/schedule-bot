import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

interface MockElement {
  id: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  disabled: boolean;
  type: string;
  textContent: string;
  className: string;
  validationMessage: string;
  focused: boolean;
  attributes: Map<string, string>;
  dataset: Record<string, string>;
  validity: { valid: boolean };
  classList: {
    toggle(name: string, force?: boolean): boolean;
    contains(name: string): boolean;
    add(name: string): void;
    remove(name: string): void;
  };
  addEventListener(name: string, handler: (event?: { preventDefault(): void; target?: MockElement }) => Promise<void> | void): void;
  setCustomValidity(message: string): void;
  reportValidity(): boolean;
  checkValidity(): boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  focus(): void;
}

function createMockElement(id: string): MockElement {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const el: MockElement = {
    id,
    value: "",
    checked: false,
    hidden: false,
    disabled: false,
    type: id === "password" ? "password" : "text",
    textContent: "",
    className: "",
    validationMessage: "",
    focused: false,
    attributes,
    dataset: id === "email" ? { error: "email-error" } : id === "password" ? { error: "password-error" } : {},
    validity: {
      get valid() {
        return !el.validationMessage && !(el.id === "password" && !el.value);
      },
    },
    classList: {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
      contains: (name) => classes.has(name),
      add: (name) => { classes.add(name); },
      remove: (name) => { classes.delete(name); },
    },
    addEventListener() {},
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() { return el.checkValidity(); },
    checkValidity() { return el.validity.valid; },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    focus() { el.focused = true; },
  };
  if (id === "email") attributes.set("aria-describedby", "email-hint");
  return el;
}

function loadForm(
  responseCode = "INVALID_CREDENTIALS",
  options: { colorScheme?: "light" | "dark"; withFullDom?: boolean } = {},
) {
  const handlers = new Map<string, Map<string, (event?: { preventDefault(): void; target?: MockElement }) => Promise<void> | void>>();
  const docHandlers = new Map<string, Array<(event: { target?: MockElement }) => void>>();
  const tgHandlers = new Map<string, Array<() => void>>();
  const elements = new Map<string, MockElement>();
  const ids = [
    "auth-form", "email", "password", "remember-me", "submit", "status",
    "toggle-password", "auth-intro", "privacy", "success-panel",
    "return-current", "return-group", "email-domain", "email-error", "password-error",
  ];
  for (const id of ids) {
    const el = createMockElement(id);
    el.addEventListener = (name, handler) => { handlers.get(id)?.set(name, handler); };
    elements.set(id, el);
    handlers.set(id, new Map());
  }

  const formEl = elements.get("auth-form")!;
  formEl.checkValidity = () => {
    const emailEl = elements.get("email")!;
    const passwordEl = elements.get("password")!;
    let valid = true;
    for (const field of [emailEl, passwordEl]) {
      if (!field.validity.valid) {
        valid = false;
        if (options.withFullDom) {
          for (const listener of docHandlers.get("invalid") ?? []) listener({ target: field });
        }
      }
    }
    return valid;
  };
  formEl.reportValidity = formEl.checkValidity;

  const documentElement = { dataset: {} as Record<string, string> };
  const tgState = {
    colorScheme: options.colorScheme ?? "light",
    ready() {},
    expand() {},
    initData: "",
    switchInlineQuery() {},
    close() {},
    onEvent(name: string, cb: () => void) {
      const list = tgHandlers.get(name) ?? [];
      list.push(cb);
      tgHandlers.set(name, list);
    },
  };

  const doc: Record<string, unknown> = {
    documentElement,
    getElementById: (id: string) => elements.get(id),
  };
  if (options.withFullDom) {
    doc.body = { append() {} };
    doc.createElement = () => createMockElement("announcer");
    doc.querySelectorAll = () => [elements.get("email")!, elements.get("password")!];
    doc.addEventListener = (name: string, cb: (event: { target?: MockElement }) => void) => {
      const list = docHandlers.get(name) ?? [];
      list.push(cb);
      docHandlers.set(name, list);
    };
  }

  const requests: Array<{ email: string; password: string; rememberMe: boolean }> = [];
  runInNewContext(readFileSync(new URL("../src/webapp/auth.js", import.meta.url), "utf8"), {
    window: { Telegram: { WebApp: tgState } },
    document: doc,
    CSS: { supports: () => false },
    location: { search: "?state=test-state", hash: "" },
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return { ok: false, json: async () => ({ code: responseCode }) };
    },
  });
  return { elements, handlers, docHandlers, tgHandlers, tgState, documentElement, requests };
}

test("Mini App sends a full WebDk email unchanged and expands LNTU shorthand", async () => {
  const { elements, handlers, requests } = loadForm();
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

test("a stale Mini App recovers from unavailable remember-me without reporting an outage", async () => {
  const { elements, handlers, requests } = loadForm("REMEMBER_ME_UNAVAILABLE");
  elements.get("email")!.value = "student";
  elements.get("password")!.value = "secret";
  const remember = elements.get("remember-me")!;
  remember.checked = true;
  const submit = handlers.get("auth-form")!.get("submit")!;
  await submit({ preventDefault() {} });

  assert.equal(requests[0]?.rememberMe, true);
  assert.equal(remember.checked, false);
  assert.equal(remember.disabled, true);
  assert.match(elements.get("status")!.textContent, /Введіть пароль/);
  assert.doesNotMatch(elements.get("status")!.textContent, /тимчасово/);
  assert.equal(elements.get("password")!.value, "");
  assert.equal(elements.get("submit")!.disabled, false);
  assert.equal(elements.get("submit")!.textContent, "Увійти");

  elements.get("password")!.value = "secret";
  await submit({ preventDefault() {} });
  assert.equal(requests[1]?.rememberMe, false);
});

test("password visibility toggle updates input type, aria-pressed, and aria-label", () => {
  const { elements, handlers } = loadForm();
  const password = elements.get("password")!;
  const toggle = elements.get("toggle-password")!;
  const click = handlers.get("toggle-password")!.get("click")!;

  assert.equal(password.type, "password");
  click();
  assert.equal(password.type, "text");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Сховати пароль");

  click();
  assert.equal(password.type, "password");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.getAttribute("aria-label"), "Показати пароль");
});

test("deferred validation avoids premature errors, syncs ARIA on invalid submit, and suppresses error on programmatic clear", async () => {
  const { elements, handlers, docHandlers, requests } = loadForm("INVALID_CREDENTIALS", { withFullDom: true });
  const email = elements.get("email")!;
  const password = elements.get("password")!;
  const submit = handlers.get("auth-form")!.get("submit")!;

  assert.equal(email.getAttribute("aria-invalid"), "false");
  assert.equal(email.getAttribute("aria-describedby"), "email-hint");
  assert.equal(password.getAttribute("aria-invalid"), "false");

  await submit({ preventDefault() {} });
  assert.equal(requests.length, 0);
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(email.getAttribute("aria-describedby"), "email-hint email-error");
  assert.equal(password.getAttribute("aria-invalid"), "true");
  assert.equal(password.getAttribute("aria-describedby"), "password-error");
  assert.equal(email.focused, true);

  email.value = "student";
  handlers.get("email")!.get("input")!();
  for (const listener of docHandlers.get("input") ?? []) listener({ target: email });
  assert.equal(email.getAttribute("aria-invalid"), "false");
  assert.equal(email.getAttribute("aria-describedby"), "email-hint");

  password.value = "wrong-pass";
  for (const listener of docHandlers.get("input") ?? []) listener({ target: password });
  await submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(password.value, "");
  assert.equal(password.dataset.programmaticClear, "true");
  assert.equal(password.getAttribute("aria-invalid"), "false");
});

test("Telegram colorScheme syncs data-theme on root and updates on themeChanged", () => {
  const { tgState, tgHandlers, documentElement } = loadForm("INVALID_CREDENTIALS", { colorScheme: "dark" });
  assert.equal(documentElement.dataset.theme, "dark");

  tgState.colorScheme = "light";
  for (const listener of tgHandlers.get("themeChanged") ?? []) listener();
  assert.equal(documentElement.dataset.theme, "light");
});
