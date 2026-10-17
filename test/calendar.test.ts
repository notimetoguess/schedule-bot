import assert from "node:assert/strict";
import test from "node:test";
import { calendarKeyboard } from "../src/bot/keyboards/calendar.keyboard.js";

test("calendar is Monday-first and navigates across years", () => {
  const keyboard = calendarKeyboard("from", "2026-02").reply_markup.inline_keyboard;
  assert.deepEqual(keyboard[1]?.map((button) => button.text), ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]);
  const dayRows = keyboard.slice(2, -1).flat();
  const first = dayRows.find((button) => button.text === "1");
  assert.equal("callback_data" in first! && first.callback_data, "cal:pick:from:2026-02-01");

  const january = calendarKeyboard("to", "2026-01").reply_markup.inline_keyboard;
  const nav = january.at(-1)!;
  assert.equal("callback_data" in nav[0]! && nav[0].callback_data, "cal:nav:to:2025-12");
  assert.equal("callback_data" in nav[2]! && nav[2].callback_data, "cal:nav:to:2026-02");
});

test("leap-year February contains day 29", () => {
  const buttons = calendarKeyboard("from", "2028-02").reply_markup.inline_keyboard.flat();
  assert(buttons.some((button) => button.text === "29" && "callback_data" in button && button.callback_data.endsWith("2028-02-29")));
});
