import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { currentAcademicWeekRange, extractClock, KYIV_ZONE, nextAcademicWeekRange, todayRange, toApiDateRange, webDkDateKey } from "../src/schedule/dates.js";

test("today range uses the current Kyiv date for both boundaries", () => {
  const instant = DateTime.fromISO("2026-09-07T22:30:00Z");
  assert.deepEqual(todayRange(instant), { from: "2026-09-08", to: "2026-09-08" });
});

test("current academic week ends on Saturday", () => {
  const now = DateTime.fromISO("2026-09-08T09:00:00", { zone: KYIV_ZONE });
  assert.deepEqual(currentAcademicWeekRange(now), { from: "2026-09-08", to: "2026-09-12" });
});

test("Saturday returns one day and Sunday returns no current academic week", () => {
  assert.deepEqual(currentAcademicWeekRange(DateTime.fromISO("2026-09-12T12:00:00", { zone: KYIV_ZONE })), {
    from: "2026-09-12",
    to: "2026-09-12",
  });
  assert.equal(currentAcademicWeekRange(DateTime.fromISO("2026-09-13T12:00:00", { zone: KYIV_ZONE })), null);
});

test("next academic week always covers Monday through Saturday", () => {
  assert.deepEqual(nextAcademicWeekRange(DateTime.fromISO("2026-09-08T09:00:00", { zone: KYIV_ZONE })), {
    from: "2026-09-14",
    to: "2026-09-19",
  });
  assert.deepEqual(nextAcademicWeekRange(DateTime.fromISO("2026-09-13T23:00:00", { zone: KYIV_ZONE })), {
    from: "2026-09-14",
    to: "2026-09-19",
  });
  assert.deepEqual(nextAcademicWeekRange(DateTime.fromISO("2026-12-31T12:00:00", { zone: KYIV_ZONE })), {
    from: "2027-01-04",
    to: "2027-01-09",
  });
});

test("API range uses inclusive Kyiv boundaries and daylight-saving offsets", () => {
  assert.deepEqual(toApiDateRange({ from: "2026-09-08", to: "2026-09-12" }), {
    dateFrom: "2026-09-08T00:00:00.000+03:00",
    dateTo: "2026-09-12T23:59:59.999+03:00",
  });
  assert.deepEqual(toApiDateRange({ from: "2026-10-24", to: "2026-10-26" }), {
    dateFrom: "2026-10-24T00:00:00.000+03:00",
    dateTo: "2026-10-26T23:59:59.999+02:00",
  });
});

test("extractClock and webDkDateKey handle ISO and SQL-style WebDk v3 timestamps", () => {
  assert.equal(extractClock("1900-01-01 09:40:00"), "09:40");
  assert.equal(extractClock("1900-01-01 9:40:00"), "09:40");
  assert.equal(extractClock("2026-09-08T09:00:00+03:00"), "09:00");
  assert.equal(extractClock("08:30"), "08:30");
  assert.equal(extractClock("25:00"), null);
  assert.equal(webDkDateKey("2026-11-19 00:00:00"), "2026-11-19");
  assert.equal(webDkDateKey("2026-09-07T22:00:00Z"), "2026-09-08");
});
