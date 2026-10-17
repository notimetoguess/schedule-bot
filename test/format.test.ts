import assert from "node:assert/strict";
import test from "node:test";
import { formatSchedule } from "../src/schedule/format.js";
import type { ScheduleLesson } from "../src/types.js";

const base: ScheduleLesson = {
  scheduleDate: "2026-09-08T00:00:00+03:00",
  studyTimeBegin: "2026-09-08T09:00:00+03:00",
  studyTimeEnd: "2026-09-08T10:20:00+03:00",
  disciplineName: "Алгоритми",
};

test("empty schedule has a clear message", () => {
  assert.deepEqual(formatSchedule([]), ["За обраний період занять немає."]);
});

test("lessons are ordered and separate same-time subgroup records remain visible", () => {
  const messages = formatSchedule([
    { ...base, disciplineName: "Пізня пара", studyTimeBegin: "2026-09-08T11:00:00+03:00", contingentName: "A" },
    { ...base, disciplineName: "Алгоритми", contingentName: "Підгрупа 1", studyTypeName: "Лекція" },
    { ...base, disciplineName: "Алгоритми", contingentName: "Підгрупа 2" },
  ]);
  const text = messages.join("\n");
  assert(text.indexOf("Алгоритми") < text.indexOf("Пізня пара"));
  assert(text.includes("Підгрупа 1"));
  assert(text.includes("Підгрупа 2"));
  assert(text.includes("Тип: Лекція"));
});

test("time-only WebDk values keep their clock time without historical Kyiv offset", () => {
  const [message] = formatSchedule([{
    ...base,
    studyTimeName: "1-ша пара",
    studyTimeBegin: "0001-01-01T08:30:00",
    studyTimeEnd: "0001-01-01T09:50:00",
  }]);
  assert(message?.includes("1-ша пара · 08:30–09:50"));
  assert(!message?.includes("08:32"));
});

test("group label is not duplicated and department is omitted", () => {
  const [message] = formatSchedule([{ ...base, contingentName: "Група КН-31", chairName: "Кафедра комп’ютерних наук" }]);
  assert(message?.includes("Група: КН-31"));
  assert(!message?.includes("Група: Група"));
  assert(!message?.includes("Кафедра:"));
});

test("oversized schedules are split under Telegram's limit", () => {
  const messages = formatSchedule(Array.from({ length: 80 }, (_, index) => ({
    ...base,
    disciplineName: `Предмет ${index} ${"x".repeat(80)}`,
  })));
  assert(messages.length > 1);
  assert(messages.every((message) => message.length <= 3900));
});
