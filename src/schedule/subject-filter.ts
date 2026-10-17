import type { BachelorCourse, ScheduleLesson, StudentSubject } from "../types.js";

export interface SubjectFilterResult {
  lessons: ScheduleLesson[];
  semesterName?: string;
  matchedCount: number;
  unmatchedCount: number;
}

export interface StudentSemesterChoice { id: number; name: string; }

export function filterScheduleToStudentSubjects(
  lessons: ScheduleLesson[],
  subjects: StudentSubject[],
  semesterId: number,
): SubjectFilterResult | undefined {
  const semesterSubjects = subjects.filter((subject) => subject.semesterId === semesterId);
  if (semesterSubjects.length === 0) return undefined;
  if (semesterSubjects.some((subject) => !subject.disciplineName.trim())) return undefined;
  const names = new Set(semesterSubjects.map((subject) => normalizeSubjectName(subject.disciplineName)));
  const matched = lessons.filter((lesson) => names.has(normalizeSubjectName(lesson.disciplineName)));
  return {
    lessons: matched,
    semesterName: semesterSubjects[0]?.semesterName,
    matchedCount: matched.length,
    unmatchedCount: lessons.length - matched.length,
  };
}

export function studentSemesterChoices(course: BachelorCourse, academicYear: string): StudentSemesterChoice[] {
  const startYear = Number(academicYear.slice(0, 4));
  if (!Number.isInteger(startYear)) throw new Error("Invalid academic year");
  const first = course * 2 - 1;
  return [
    { id: first, name: `${first} семестр (початок - вересень ${startYear})` },
    { id: first + 1, name: `${first + 1} семестр (початок - зима ${startYear + 1})` },
  ];
}

export function normalizeSubjectName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("uk-UA").replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").trim();
}
