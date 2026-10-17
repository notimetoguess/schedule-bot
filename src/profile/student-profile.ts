import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { BachelorCourse, StudentProfile, WebDkStudentProfile } from "../types.js";

const KYIV_ZONE = "Europe/Kyiv";

export function currentAcademicYear(now = DateTime.now().setZone(KYIV_ZONE)): string {
  const startYear = now.month >= 9 ? now.year : now.year - 1;
  return `${startYear}/${startYear + 1}`;
}

export function tokenFingerprint(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex").slice(0, 24);
}

export function toStudentProfile(data: WebDkStudentProfile, accessToken: string, now = Date.now()): StudentProfile {
  const course = parseBachelorCourse(data.courseName, data.educationLevelName);
  return { course, academicYear: currentAcademicYear(), tokenFingerprint: tokenFingerprint(accessToken), refreshedAt: now };
}

export function parseBachelorCourse(courseName: string, educationLevelName?: string): BachelorCourse {
  if (educationLevelName && !/бакалавр/i.test(educationLevelName)) throw new Error("Unsupported education level");
  const match = courseName.match(/(?:^|\D)([1-4])\s*(?:курс)?(?:\D|$)/iu);
  if (!match) throw new Error("Unsupported course");
  return Number(match[1]) as BachelorCourse;
}
