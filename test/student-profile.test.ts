import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAuthStore } from "../src/auth/auth-store.js";
import { MemoryStudentProfileStore } from "../src/profile/student-profile-store.js";
import { currentAcademicYear, parseBachelorCourse } from "../src/profile/student-profile.js";
import { ScheduleService } from "../src/schedule/schedule-service.js";

test("normalizes bachelor courses and derives academic years", () => {
  assert.equal(parseBachelorCourse("3 курс", "Бакалавр"), 3);
  assert.equal(parseBachelorCourse("4", undefined), 4);
  assert.throws(() => parseBachelorCourse("5 курс", "Магістр"));
  assert.equal(currentAcademicYear({ month: 1, year: 2027 } as never), "2026/2027");
  assert.equal(currentAcademicYear({ month: 9, year: 2027 } as never), "2027/2028");
});

test("third-course personal view offers only semesters five and six", async () => {
  const auth = new MemoryAuthStore();
  const profiles = new MemoryStudentProfileStore();
  await auth.set("42", { accessToken: "token", expiresAt: Date.now() + 60_000 });
  const webDk = {
    async getSchedule() { return [{ scheduleDate: "x", studyTimeBegin: "x", studyTimeEnd: "x", disciplineName: "Моя дисципліна" }]; },
    async getStudentSubjects() { return [
      { semesterId: 5, semesterName: "05 семестр", disciplineName: "Моя дисципліна" },
      { semesterId: 7, semesterName: "07 семестр", disciplineName: "Чужа дисципліна" },
    ]; },
    async getStudentProfile() { return { courseName: "3 курс", educationLevelName: "Бакалавр" }; },
  };
  const service = new ScheduleService(auth, webDk as never, undefined, profiles);
  const pending = await service.get("42", "from", "to", "me");
  assert.equal(pending.needsSemesterSelection, true);
  assert.deepEqual(pending.semesterChoices?.map((choice) => choice.id), [5, 6]);
  assert.match(pending.semesterChoices?.[0]?.name ?? "", /вересень/);
  const schedule = await service.get("42", "from", "to", "me", 5);
  assert.equal(schedule.view, "me");
  assert.equal(schedule.lessons.length, 1);
  const invalid = await service.get("42", "from", "to", "me", 7);
  assert.equal(invalid.needsSemesterSelection, true);
});

test("general schedules do not fetch or store a student profile", async () => {
  const auth = new MemoryAuthStore();
  await auth.set("42", { accessToken: "token", expiresAt: Date.now() + 60_000 });
  let profileCalls = 0;
  const service = new ScheduleService(auth, {
    async getSchedule() { return []; },
    async getStudentProfile() { profileCalls++; return { courseName: "3 курс" }; },
  } as never, undefined, new MemoryStudentProfileStore());
  await service.get("42", "from", "to", "all");
  assert.equal(profileCalls, 0);
});
