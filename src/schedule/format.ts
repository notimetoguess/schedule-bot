import { DateTime } from "luxon";
import { KYIV_ZONE } from "./dates.js";
import type { ScheduleLesson } from "../types.js";

const MAX_MESSAGE_LENGTH = 3900;

export function formatSchedule(lessons: ScheduleLesson[]): string[] {
  if (lessons.length === 0) return ["За обраний період занять немає."];

  const sorted = [...lessons].sort((a, b) => {
    const dateOrder = dateKey(a.scheduleDate).localeCompare(dateKey(b.scheduleDate));
    return dateOrder || timeInMinutes(a.studyTimeBegin) - timeInMinutes(b.studyTimeBegin);
  });
  const groups = new Map<string, ScheduleLesson[]>();
  for (const lesson of sorted) {
    const key = dateKey(lesson.scheduleDate);
    const group = groups.get(key) ?? [];
    group.push(lesson);
    groups.set(key, group);
  }

  const blocks: string[] = [];
  for (const [date, dayLessons] of groups) {
    const parsed = DateTime.fromISO(date, { zone: KYIV_ZONE }).setLocale("uk");
    blocks.push(`📅 ${parsed.isValid ? parsed.toFormat("cccc, dd.LL.yyyy") : date}`);
    for (const lesson of dayLessons) blocks.push(formatLesson(lesson));
  }
  return splitBlocks(blocks);
}

function formatLesson(lesson: ScheduleLesson): string {
  const begin = formatTime(lesson.studyTimeBegin);
  const end = formatTime(lesson.studyTimeEnd);
  const lines = [`🕒 ${lesson.studyTimeName ? `${lesson.studyTimeName} · ` : ""}${begin}–${end}`, `📚 ${lesson.disciplineName}`];
  if (lesson.studyTypeName) lines.push(`Тип: ${lesson.studyTypeName}`);
  if (lesson.cabinetNumber) lines.push(`Аудиторія: ${lesson.cabinetNumber}`);
  if (lesson.empFullName) lines.push(`Викладач: ${lesson.empFullName}`);
  if (lesson.contingentName) lines.push(`Група: ${lesson.contingentName.replace(/^Група\s*:?\s*/i, "")}`);
  if (lesson.contentNotes) lines.push(`Примітка: ${lesson.contentNotes}`);
  return lines.join("\n");
}

function dateKey(value: string): string {
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed.setZone(KYIV_ZONE).toISODate()! : value.slice(0, 10);
}

function formatTime(value: string): string {
  const clock = extractClock(value);
  if (clock) return clock;
  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed.toFormat("HH:mm") : value;
}

function timeInMinutes(value: string): number {
  const clock = extractClock(value);
  if (!clock) return Number.MAX_SAFE_INTEGER;
  const [hour, minute] = clock.split(":").map(Number);
  return hour! * 60 + minute!;
}

function extractClock(value: string): string | null {
  return value.match(/(?:T|^)([01]\d|2[0-3]):([0-5]\d)/)?.slice(1, 3).join(":") || null;
}

function splitBlocks(blocks: string[]): string[] {
  const result: string[] = [];
  let current = "";
  for (const block of blocks) {
    const pieces = block.length <= MAX_MESSAGE_LENGTH ? [block] : chunkText(block, MAX_MESSAGE_LENGTH);
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > MAX_MESSAGE_LENGTH) {
        if (current) result.push(current);
        current = piece;
      } else current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) chunks.push(text.slice(offset, offset + size));
  return chunks;
}
