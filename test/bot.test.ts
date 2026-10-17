import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "telegraf";
import { AuthChallengeStore } from "../src/auth/auth-challenges.js";
import { AuthStoreUnavailableError, MemoryAuthStore, type AuthStore } from "../src/auth/auth-store.js";
import { createBot } from "../src/bot/bot.js";
import { ScheduleImageStore } from "../src/schedule/image-store.js";
import { ScheduleImageRenderer } from "../src/schedule/schedule-image-renderer.js";
import { todayRange } from "../src/schedule/dates.js";
import type { BotContext, BotDependencies } from "../src/bot/types.js";
import { SlidingWindowRateLimiter } from "../src/shared/rate-limiter.js";
import type { ScheduleLesson } from "../src/types.js";
import { WebDkError, WebDkClient } from "../src/integrations/webdk.js";

const botInfo = {
  id: 999,
  is_bot: true as const,
  first_name: "Schedule",
  username: "schedule_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
};

function setup(options: {
  authStore?: AuthStore;
  scheduleImageRenderer?: BotDependencies["scheduleImageRenderer"];
  scheduleImageStore?: BotDependencies["scheduleImageStore"];
  getSchedule?: (token: string, from: string, to: string) => Promise<ScheduleLesson[]>;
  notifications?: BotDependencies["notifications"];
} = {}) {
  const ranges: Array<[string, string, string]> = [];
  const client = {
    async getSchedule(token: string, from: string, to: string): Promise<ScheduleLesson[]> {
      ranges.push([token, from, to]);
      if (options.getSchedule) return options.getSchedule(token, from, to);
      return [];
    },
  } as WebDkClient;
  const authStore = options.authStore ?? new MemoryAuthStore();
  const challenges = new AuthChallengeStore();
  const requestLimiter = new SlidingWindowRateLimiter(2, 30_000);
  const { bot, close } = createBot("999:test", client, {
    authStore,
    scheduleImageRenderer: options.scheduleImageRenderer,
    scheduleImageStore: options.scheduleImageStore,
    notifications: options.notifications,
    challenges,
    requestLimiter,
    webAppUrl: "https://auth.example.com",
  });
  bot.catch((error) => { throw error; });
  let nextMessageId = 100;
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const telegram = {
    async sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
      calls.push({ method: "sendMessage", payload: { chat_id: chatId, text, ...extra } });
      return { message_id: nextMessageId++, date: 1, chat: { id: chatId, type: "private", first_name: "Test" }, text };
    },
    async answerCbQuery(callbackQueryId: string, text?: string, extra: Record<string, unknown> = {}) {
      calls.push({ method: "answerCallbackQuery", payload: { callback_query_id: callbackQueryId, text, ...extra } });
      return true;
    },
    async answerInlineQuery(inlineQueryId: string, results: unknown[], extra: Record<string, unknown> = {}) {
      calls.push({ method: "answerInlineQuery", payload: { inline_query_id: inlineQueryId, results, ...extra } });
      return true;
    },
    async editMessageReplyMarkup(...args: unknown[]) {
      calls.push({ method: "editMessageReplyMarkup", payload: { args } });
      return true;
    },
    async editMessageText(...args: unknown[]) {
      calls.push({ method: "editMessageText", payload: { args } });
      return true;
    },
    async editMessageMedia(...args: unknown[]) {
      calls.push({ method: "editMessageMedia", payload: { args } });
      return true;
    },
  };
  let updateId = 1;
  const dispatch = async (update: unknown) => {
    const ctx = new Context(update as never, telegram as never, botInfo);
    await bot.middleware()(ctx as never, async () => undefined);
    return ctx as unknown as BotContext;
  };
  const message = (userId: number, text: string, id: number, type: "private" | "supergroup" = "private", command = false) => ({
    update_id: updateId++,
    message: {
      message_id: id,
      date: 1,
      chat: type === "private" ? { id: userId, type, first_name: "Test" } : { id: -1001, type, title: "Group" },
      from: { id: userId, is_bot: false, first_name: "Test" },
      text,
      ...(command ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] } : {}),
    },
  });
  const inline = (userId: number, query = "") => ({
    update_id: updateId++,
    inline_query: {
      id: "inline-" + updateId,
      from: { id: userId, is_bot: false, first_name: "Test" },
      query,
      offset: "",
    },
  });
  const chosen = (userId: number, query = "logout", resultId = "logout") => ({
    update_id: updateId++,
    chosen_inline_result: {
      result_id: resultId,
      from: { id: userId, is_bot: false, first_name: "Test" },
      query,
      inline_message_id: "inline-message-1",
    },
  });
  const callback = (userId: number, data: string, messageId: number) => ({
    update_id: updateId++,
    callback_query: {
      id: "cb-" + updateId,
      chat_instance: "instance",
      from: { id: userId, is_bot: false, first_name: "Test" },
      data,
      message: { message_id: messageId, date: 1, chat: { id: userId, type: "private", first_name: "Test" }, text: "buttons" },
    },
  });
  const inlineCallback = (userId: number, data: string) => ({
    update_id: updateId++,
    callback_query: { id: "inline-cb-" + updateId, chat_instance: "instance", from: { id: userId, is_bot: false, first_name: "Test" }, data, inline_message_id: "inline-message" },
  });
  return { authStore, calls, close, dispatch, inline, chosen, message, callback, inlineCallback, ranges, getNextMessageId: () => nextMessageId };
}

test("unauthorized users receive Mini App entry points and chat text is never treated as credentials", async () => {
  const fixture = setup();
  await fixture.dispatch(fixture.message(1, "/start", 1, "private", true));
  const start = fixture.calls.find((call) => call.method === "sendMessage");
  const startJson = JSON.stringify(start?.payload);
  assert.match(startJson, /web_app/);
  assert.match(startJson, /https:\/\/auth\.example\.com\/auth\?state=/);

  await fixture.dispatch(fixture.message(1, "visible-password", 2));
  assert.equal(fixture.calls.filter((call) => call.method === "sendMessage").length, 2);
  assert(!JSON.stringify(fixture.calls).includes("Введіть пароль"));
  assert(!JSON.stringify(fixture.calls).includes("force_reply"));
  assert(!JSON.stringify(fixture.calls).includes("deleteMessage"));

  await fixture.dispatch(fixture.inline(2));
  const instructions = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.match(JSON.stringify(instructions.payload.results), /@schedule_test_bot login/);
  assert.equal((instructions.payload.results as Array<{ thumbnail_url: string }>)[0]?.thumbnail_url, "https://auth.example.com/assets/inline/show.jpg");
  assert.equal(instructions.payload.button, undefined);

  await fixture.dispatch(fixture.inline(2, "  LoGiN  "));
  const answer = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.deepEqual(answer.payload.results, []);
  assert.match(JSON.stringify(answer.payload.button), /Авторизуватися/);
  assert.match(JSON.stringify(answer.payload.button), /web_app/);

  await fixture.dispatch(fixture.message(3, "/login@schedule_test_bot", 3, "supergroup", true));
  const groupReply = fixture.calls.filter((call) => call.method === "sendMessage").at(-1)!;
  assert.match(String(groupReply.payload.text), /@schedule_test_bot/);
  assert(!JSON.stringify(groupReply.payload).includes("force_reply"));
  fixture.close();
});

test("notification discovery registers private and group chat IDs, membership changes, and migrations", async () => {
  const discovered: Array<unknown[]> = [];
  const notifications = {
    async registerChat(...args: unknown[]) { discovered.push(["register", ...args]); },
    async setChatActive(...args: unknown[]) { discovered.push(["active", ...args]); },
    async migrateChat(...args: unknown[]) { discovered.push(["migrate", ...args]); },
  } as unknown as BotDependencies["notifications"];
  const fixture = setup({ notifications });

  await fixture.dispatch(fixture.message(10, "hello", 1));
  await fixture.dispatch(fixture.message(10, "/start@schedule_test_bot", 2, "supergroup", true));
  await fixture.dispatch(fixture.inline(10, "show me"));

  await fixture.dispatch({
    update_id: 500,
    my_chat_member: {
      chat: { id: -1001, type: "supergroup", title: "Group" },
      from: { id: 10, is_bot: false, first_name: "Test" },
      date: 1,
      old_chat_member: { user: botInfo, status: "left" },
      new_chat_member: { user: botInfo, status: "member" },
    },
  });
  await fixture.dispatch({
    update_id: 501,
    message: {
      message_id: 3,
      date: 1,
      chat: { id: -1001, type: "supergroup", title: "Group" },
      from: { id: 10, is_bot: false, first_name: "Test" },
      migrate_to_chat_id: -1002,
    },
  });

  assert.deepEqual(discovered, [
    ["register", "10", "private"],
    ["register", "-1001", "group"],
    ["active", "-1001", "group", true],
    ["migrate", "-1001", "-1002"],
  ]);
  fixture.close();
});

test("authorized start and login commands do not prompt for authorization", async () => {
  const fixture = setup();
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });

  await fixture.dispatch(fixture.message(1, "/start", 1, "private", true));
  await fixture.dispatch(fixture.message(1, "/login", 2, "private", true));
  const privateReplies = fixture.calls.filter((call) => call.method === "sendMessage");
  assert.equal(privateReplies.length, 2);
  for (const reply of privateReplies) {
    assert.match(String(reply.payload.text), /Ви вже авторизовані/);
    assert.match(JSON.stringify(reply.payload.reply_markup), /menu:view:all/);
    assert(!JSON.stringify(reply.payload).includes("web_app"));
  }

  await fixture.dispatch(fixture.message(1, "/start@schedule_test_bot", 3, "supergroup", true));
  await fixture.dispatch(fixture.message(1, "/login@schedule_test_bot", 4, "supergroup", true));
  const groupReplies = fixture.calls.filter((call) => call.method === "sendMessage").slice(2);
  assert.equal(groupReplies.length, 2);
  for (const reply of groupReplies) {
    assert.match(String(reply.payload.text), /Ви вже авторизовані/);
    assert.match(String(reply.payload.text), /@schedule_test_bot/);
    assert.match(String(reply.payload.text), /show/);
    assert.match(String(reply.payload.text), /загального розкладу/);
    assert(!String(reply.payload.text).includes("login"));
    assert(!JSON.stringify(reply.payload).includes("web_app"));
  }
  fixture.close();
});

test("logout and an upstream rejection remove authorization", async (t) => {
  const authStore = new MemoryAuthStore();
  await authStore.set("1", { accessToken: "logout-access", expiresAt: Date.now() + 60_000 });
  const fixture = setup({
    authStore,
    async getSchedule() {
      throw new WebDkError("unauthorized", "Session expired", 401);
    },
  });

  await fixture.dispatch(fixture.message(1, "/logout", 1, "private", true));
  assert.equal(await authStore.get("1"), undefined);

  await authStore.set("1", { accessToken: "rejected-access", expiresAt: Date.now() + 60_000 });
  await fixture.dispatch(fixture.callback(1, "menu:today", 2));
  assert.equal(await authStore.get("1"), undefined);
  fixture.close();
});

test("shared authentication enables today, custom range, inline results, and logout", async () => {
  const fixture = setup();
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  await fixture.dispatch(fixture.inline(1, "login"));
  const alreadyAuthorized = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.match(JSON.stringify(alreadyAuthorized.payload.results), /Ви вже авторизовані/);
  assert.equal((alreadyAuthorized.payload.results as Array<{ thumbnail_url: string }>)[0]?.thumbnail_url, "https://auth.example.com/assets/inline/authorized.jpg");
  assert.equal((await fixture.authStore.get("1"))?.accessToken, "access");
  assert.equal(fixture.ranges.length, 0);

  await fixture.dispatch(fixture.message(1, "/start", 1, "private", true));
  assert.match(JSON.stringify(fixture.calls), /Загальний розклад/);

  await fixture.dispatch(fixture.callback(1, "menu:view:all", 10));
  await fixture.dispatch(fixture.callback(1, "menu:all:today", 10));
  assert.equal(fixture.ranges.length, 1);
  assert.equal(fixture.ranges[0]?.[0], "access");
  assert.equal(fixture.ranges[0]?.[1].slice(0, 10), fixture.ranges[0]?.[2].slice(0, 10));

  await fixture.dispatch(fixture.callback(1, "menu:all:range", 11));
  const calendarId = fixture.getNextMessageId() - 1;
  await fixture.dispatch(fixture.callback(1, "cal:pick:from:2026-09-08", calendarId));
  await fixture.dispatch(fixture.callback(1, "cal:pick:to:2026-09-08", calendarId));
  assert.equal(fixture.ranges.length, 2);
  assert.match(fixture.ranges[1]![1], /^2026-09-08T00:00:00\.000/);
  assert.match(fixture.ranges[1]![2], /^2026-09-08T23:59:59\.999/);

  await fixture.dispatch(fixture.inline(1, "show"));
  const menu = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.match(JSON.stringify(menu.payload.results), /Саме show лише показує цю підказку/);
  assert.equal(fixture.ranges.length, 2);

  await fixture.dispatch(fixture.message(1, "/logout", 20, "private", true));
  assert.equal((await fixture.authStore.get("1")), undefined);
  await fixture.dispatch(fixture.inline(1, "show"));
  const loggedOut = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.equal(loggedOut.payload.button, undefined);
  assert.match(JSON.stringify(loggedOut.payload.results), /show all/);
  await fixture.dispatch(fixture.inline(1, "login"));
  const relogin = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
  assert.match(JSON.stringify(relogin.payload.button), /Авторизуватися/);
  fixture.close();
});

test("inline logout clears only the querying user's authorization and transient state", async (t) => {
  const fixture = setup();
  t.after(fixture.close);
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  await fixture.authStore.set("2", { accessToken: "other", expiresAt: Date.now() + 60_000 });
  await fixture.dispatch(fixture.callback(1, "menu:range", 10));
  const calendarId = fixture.getNextMessageId() - 1;
  await fixture.dispatch(fixture.callback(1, "cal:pick:from:2026-09-08", calendarId));

  for (const query of ["  LoGoUt  ", "logout"]) {
    await fixture.dispatch(fixture.inline(1, query));
    const answer = fixture.calls.at(-1)!;
    assert.equal(answer.method, "answerInlineQuery");
    assert.equal(answer.payload.cache_time, 0);
    assert.equal(answer.payload.is_personal, true);
    const results = answer.payload.results as Array<{ title: string; thumbnail_url: string; input_message_content: { message_text: string } }>;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.title, "Вийти з облікового запису");
    assert.equal(results[0]!.thumbnail_url, "https://auth.example.com/assets/inline/logout.jpg?v=" + createHash("sha256").update(readFileSync(new URL("../src/assets/inline/logout.jpg", import.meta.url))).digest("hex").slice(0, 12));
    assert.doesNotMatch(results[0]!.input_message_content.message_text, /Ви вийшли/);
    const ctx = await fixture.dispatch(fixture.chosen(1, query));
    assert.equal(ctx.session.stage, "idle");
    assert.equal(ctx.session.selectedStart, undefined);
    assert.equal(ctx.session.calendarMessageId, undefined);
    assert.equal(await fixture.authStore.get("1"), undefined);
    assert.equal((await fixture.authStore.get("2"))?.accessToken, "other");
    assert.match(JSON.stringify(fixture.calls.at(-1)!.payload), /Ви вийшли.*@schedule_test_bot login/);
  }
  await fixture.dispatch(fixture.callback(1, "cal:pick:to:2026-09-08", calendarId));
  assert.match(String(fixture.calls.at(-1)!.payload.text), /неактивний/);
  await fixture.dispatch(fixture.inline(1, "show"));
  assert.match(JSON.stringify(fixture.calls.at(-1)!.payload.results), /show all/);
  assert.equal(fixture.ranges.length, 0);
});

test("partial and extended inline logout queries only show instructions", async (t) => {
  const fixture = setup();
  t.after(fixture.close);
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  for (const query of ["log", "logou", "logout something"]) {
    await fixture.dispatch(fixture.inline(1, query));
    assert.equal((await fixture.authStore.get("1"))?.accessToken, "access");
    assert.match(JSON.stringify(fixture.calls.at(-1)!.payload.results), /@schedule_test_bot logout/);
  }
  assert.equal(fixture.ranges.length, 0);
});

test("inline logout does not require an authorization read", async (t) => {
  const auth = new MemoryAuthStore();
  auth.get = async () => { throw new AuthStoreUnavailableError(); };
  const fixture = setup({ authStore: auth });
  t.after(fixture.close);
  await fixture.dispatch(fixture.inline(1, "logout"));
  assert.match(JSON.stringify(fixture.calls.at(-1)!.payload.results), /Вийти з облікового запису/);
});

test("inline logout deletion failure preserves authorization and transient state", async (t) => {
  const auth = new MemoryAuthStore();
  await auth.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  auth.delete = async () => { throw new AuthStoreUnavailableError(); };
  const fixture = setup({ authStore: auth });
  t.after(fixture.close);
  await fixture.dispatch(fixture.callback(1, "menu:range", 10));
  const calendarId = fixture.getNextMessageId() - 1;
  await fixture.dispatch(fixture.callback(1, "cal:pick:from:2026-09-08", calendarId));
  const ctx = await fixture.dispatch(fixture.chosen(1, "logout"));
  assert.equal(ctx.session.stage, "choosing_end");
  assert.equal(ctx.session.selectedStart, "2026-09-08");
  assert.equal(ctx.session.calendarMessageId, calendarId);
  assert.equal((await auth.get("1"))?.accessToken, "access");
  const answer = JSON.stringify(fixture.calls.at(-1)!.payload);
  assert.match(answer, /тимчасово недоступний/);
  assert.doesNotMatch(answer, /Ви вийшли/);
  assert.equal(fixture.ranges.length, 0);
});

test("stale calendar callbacks are rejected", async () => {
  const fixture = setup();
  await fixture.dispatch(fixture.callback(1, "cal:pick:from:2026-09-08", 10));
  assert(fixture.calls.some((call) => String(call.payload.text).includes("неактивний")));
  fixture.close();
});

test("bare show only returns guidance and never loads an inline schedule menu", async () => {
  const fixture = setup();
  try {
    await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
    for (const query of ["", "   ", "sh", "show something"]) {
      await fixture.dispatch(fixture.inline(1, query));
      const answer = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!;
      assert.match(JSON.stringify(answer.payload.results), /@schedule_test_bot show/);
      assert.match(JSON.stringify(answer.payload.results), /@schedule_test_bot login/);
    }
    assert.equal(fixture.ranges.length, 0);

    await fixture.dispatch(fixture.inline(1, "  ShOw  "));
    assert.equal(fixture.ranges.length, 0);
    const results = fixture.calls.filter((call) => call.method === "answerInlineQuery").at(-1)!.payload.results;
    assert.doesNotMatch(JSON.stringify(results), /schedule-menu:/);
    assert.match(JSON.stringify(results), /Саме show лише показує цю підказку/);
  } finally {
    fixture.close();
  }
});

test("schedule inline results use the supplied calendar thumbnails", async () => {
  const fixture = setup();
  try {
    await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
    await fixture.dispatch(fixture.inline(1, "show all"));
    const answer = fixture.calls.find((call) => call.method === "answerInlineQuery")!;
    const results = answer.payload.results as Array<{ type: string; description: string; id: string; title: string; thumbnail_url: string; input_message_content: { message_text: string } }>;
    assert(results.length >= 3);
    const nextWeek = results.find((result) => result.id.startsWith("all:next-week:"));
    assert(nextWeek);
    assert.match(nextWeek.title, /^Загальний розклад на наступний тиждень/);
    assert.equal(nextWeek.thumbnail_url, "https://auth.example.com/assets/inline/weekly-calendar.png");
    for (const result of results) {
      const filename = result.id.startsWith("all:today:") ? "today-calendar.png" : "weekly-calendar.png";
      assert.equal(result.thumbnail_url, "https://auth.example.com/assets/inline/" + filename);
      assert.equal(result.type, "article");
      assert.equal(result.description, "Оберіть, щоб надіслати меню розкладу.");
      assert.equal(typeof result.input_message_content.message_text, "string");
      assert.match(JSON.stringify(result), /Показати розклад/);
    }
  } finally {
    fixture.close();
  }
});

test("database read outages return temporary errors without login prompts in chat and inline", async (t) => {
  const auth = new MemoryAuthStore();
  auth.get = async () => { throw new AuthStoreUnavailableError(); };
  const fixture = setup({ authStore: auth });
  t.after(fixture.close);
  await fixture.dispatch(fixture.message(1, "/start", 1, "private", true));
  await fixture.dispatch(fixture.inline(1, "show all"));
  assert.equal(fixture.calls.length, 2);
  for (const call of fixture.calls) {
    assert.match(JSON.stringify(call.payload), /тимчасово недоступний/);
    assert.doesNotMatch(JSON.stringify(call.payload), /web_app|Авторизуйтеся/);
  }
  assert.equal(fixture.ranges.length, 0);
});

test("logout write failure never confirms logout or clears authorization", async (t) => {
  const auth = new MemoryAuthStore();
  await auth.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  auth.delete = async () => { throw new AuthStoreUnavailableError(); };
  const fixture = setup({ authStore: auth });
  t.after(fixture.close);
  await fixture.dispatch(fixture.message(1, "/logout", 1, "private", true));
  assert.match(JSON.stringify(fixture.calls), /тимчасово недоступний/);
  assert.equal((await auth.get("1"))?.accessToken, "access");
});

for (const inline of [false, true]) {
  test("stale upstream rejection preserves a newer login: " + (inline ? "inline" : "chat"), async (t) => {
    const auth = new MemoryAuthStore();
    await auth.set("1", { accessToken: "old", expiresAt: Date.now() + 60_000 });
    const fixture = setup({
      authStore: auth,
      async getSchedule() {
        await auth.set("1", { accessToken: "new", expiresAt: Date.now() + 60_000 });
        throw new WebDkError("unauthorized", "Session expired", 401);
      },
    });
    t.after(fixture.close);
    if (inline) {
      await fixture.dispatch(fixture.inline(1, "show all"));
      const today = todayRange();
      await fixture.dispatch(fixture.inlineCallback(1, `schedule-menu:${today.from}:${today.to}`));
    } else await fixture.dispatch(fixture.callback(1, "menu:today", 1));
    assert.equal((await auth.get("1"))?.accessToken, "new");
  });
}

 test("typing logout or selecting unrelated results preserves authorization and calendar", async (t) => {
  const fixture = setup();
  t.after(fixture.close);
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  await fixture.dispatch(fixture.callback(1, "menu:range", 10));
  const calendarId = fixture.getNextMessageId() - 1;
  await fixture.dispatch(fixture.callback(1, "cal:pick:from:2026-09-08", calendarId));
  for (const update of [fixture.inline(1, "logout"), fixture.chosen(1, "show", "today:1"), fixture.chosen(1, "logout extra")]) {
    const ctx = await fixture.dispatch(update);
    assert.equal((await fixture.authStore.get("1"))?.accessToken, "access");
    assert.equal(ctx.session.stage, "choosing_end");
    assert.equal(ctx.session.selectedStart, "2026-09-08");
    assert.equal(ctx.session.calendarMessageId, calendarId);
  }
  assert.equal(fixture.calls.filter(call => call.method === "editMessageText").length, 1);
});

test("unauthorized inline show uses the versioned authorization thumbnail", async (t) => {
  const fixture = setup();
  t.after(fixture.close);
  await fixture.dispatch(fixture.inline(1, "show all"));
  const results = fixture.calls.at(-1)!.payload.results as Array<{ thumbnail_url: string }>;
  const hash = createHash("sha256").update(readFileSync(new URL("../src/assets/inline/need-authorize.jpg", import.meta.url))).digest("hex").slice(0, 12);
  assert.equal(results[0]!.thumbnail_url, "https://auth.example.com/assets/inline/need-authorize.jpg?v=" + hash);
});

for (const inline of [false, true]) {
  for (const scenario of [
    { name: "explicit 401", status: 401, body: { message: "Authorization has been denied for this request." }, rejected: true },
    { name: "expiry code", status: 400, body: { errorCode: 20700 }, rejected: true },
    { name: "ambiguous 401", status: 401, body: { message: "private-upstream-message", errorCode: 999 }, rejected: false },
    { name: "server error", status: 500, body: { message: "private-upstream-message" }, rejected: false },
    { name: "non-JSON 401", status: 401, body: null, rejected: false },
    { name: "network failure", status: 0, body: null, rejected: false },
  ]) {
    test(scenario.name + " authorization handling: " + (inline ? "inline" : "chat"), async (t) => {
      const logs: unknown[][] = [];
      t.mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); });
      const client = new WebDkClient("2.18", (async () => {
        if (!scenario.status) throw new Error("private-upstream-message");
        return new Response(scenario.body ? JSON.stringify(scenario.body) : "private-upstream-message", { status: scenario.status });
      }) as typeof fetch);
      const fixture = setup({ getSchedule: client.getSchedule.bind(client) });
      t.after(fixture.close);
      await fixture.authStore.set("1", { accessToken: "secret-access-token", expiresAt: Date.now() + 604800000 });
      if (inline) {
        await fixture.dispatch(fixture.inline(1, "show"));
        const today = todayRange();
        await fixture.dispatch(fixture.inlineCallback(1, `schedule-menu:${today.from}:${today.to}`));
      } else await fixture.dispatch(fixture.callback(1, "menu:today", 1));
      assert.equal(Boolean(await fixture.authStore.get("1")), !scenario.rejected);
      assert.equal(logs.length, 1);
      const metadata = logs[0]![1] as Record<string, unknown>;
      assert.equal(metadata.status, scenario.status || null);
      assert.equal(metadata.upstreamCode, scenario.body?.errorCode ?? null);
      assert.equal(metadata.classification === "unauthorized", scenario.rejected);
      assert(Number(metadata.remainingLocalLifetimeSeconds) > 604790);
      assert.doesNotMatch(JSON.stringify(logs), /secret-access-token|private-upstream-message/);
      if (!scenario.rejected) assert.doesNotMatch(JSON.stringify(fixture.calls), /Авторизуйтеся|web_app/);
    });
  }
}


test("static inline cards use calendar thumbnails and load images only after the button is tapped", async (t) => {
  const store = new ScheduleImageStore();
  const fixture = setup({
    scheduleImageRenderer: new ScheduleImageRenderer({ find: async () => undefined }),
    scheduleImageStore: store,
    getSchedule: async () => [{
      scheduleDate: todayRange().from, studyTimeBegin: "08:30", studyTimeEnd: "09:50",
      disciplineName: "Тестовий предмет",
    }],
  });
  t.after(fixture.close);
  await fixture.authStore.set("1", { accessToken: "access", expiresAt: Date.now() + 60_000 });
  await fixture.dispatch(fixture.inline(1, "show all"));
  const results = fixture.calls.find((call) => call.method === "answerInlineQuery")!.payload.results as Array<{
    id: string; type: string; thumbnail_url: string; reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> };
  }>;
  const today = results.find((result) => result.id.startsWith("all:today:"))!;
  assert.equal(today.type, "article");
  assert.match(today.id, /:menu-v1$/);
  assert.equal(today.thumbnail_url, "https://auth.example.com/assets/inline/today-calendar.png");
  assert.match(today.reply_markup.inline_keyboard[0]![0]!.callback_data, /^schedule-menu:/);
  assert.equal(fixture.ranges.length, 0);
  const callback = today.reply_markup.inline_keyboard[0]![0]!.callback_data;
  await fixture.dispatch(fixture.inlineCallback(1, callback));
  const media = fixture.calls.find((call) => call.method === "editMessageMedia")!;
  const payload = JSON.stringify(media.payload);
  assert.match(payload, /^.*schedule-images\/[^/]+\/0\.jpg/);
  const bundle = (payload.match(/schedule-images\/([^/]+)\/0\.jpg/) ?? [])[1]!;
  assert.equal(store.get(bundle)?.pages[0]?.subarray(0, 2).toString("hex"), "ffd8");
});
