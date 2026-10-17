import sharp from "sharp";
import { createRequire } from "node:module";
import opentype from "opentype.js";
import type { ScheduleLesson } from "../types.js";
import { formatSchedule } from "./format.js";
import { TeacherPhotos, initials } from "./teacher-photos.js";

const WIDTH = 1200;
const MAX_HEIGHT = 2300;
const require = createRequire(import.meta.url);
const regularFont = opentype.loadSync(require.resolve("@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff"));
const boldFont = opentype.loadSync(require.resolve("@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff"));
const regularLatinFont = opentype.loadSync(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
const boldLatinFont = opentype.loadSync(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff"));

export interface TeacherPhotoProvider { find(name: string | undefined): Promise<Buffer | undefined>; }

export class ScheduleImageRenderer {
  constructor(private readonly teachers: TeacherPhotoProvider = new TeacherPhotos()) {}

  async render(lessons: ScheduleLesson[], title: string): Promise<Buffer[]> {
    if (!lessons.length) return [await this.svgJpeg(title, ["За обраний період занять немає."], [])];
    const blocks = formatSchedule(lessons).flatMap((text) => text.split("\n\n"));
    const pages = paginateScheduleBlocks(blocks);
    return Promise.all(pages.map(async (page, index) => {
      const names = page.flatMap((block) => [...block.matchAll(/^Викладач:\s*(.+)$/gm)].map((match) => match[1]!));
      const photos = await Promise.all(names.map((name) => this.teachers.find(name)));
      return this.svgJpeg(title + (pages.length > 1 ? ` · ${index + 1}/${pages.length}` : ""), page, names.map((name, i) => ({ name, photo: photos[i] })));
    }));
  }

  private async svgJpeg(title: string, blocks: string[], teachers: Array<{ name: string; photo?: Buffer }>): Promise<Buffer> {
    let y = 112;
    let teacherIndex = 0;
    const parts = [`<rect width="${WIDTH}" height="2400" fill="#f5f8fc"/>${svgText(title, 60, 72, 36, true, "#1556aa")}`];
    for (const block of blocks) {
      const lines = block.split("\n").flatMap((line) => wrap(line, 48));
      const h = 35 + lines.length * 42;
      parts.push(`<rect x="42" y="${y}" width="1116" height="${h}" rx="22" fill="white" stroke="#d9e5f5"/>`);
      let ly = y + 45;
      for (const line of lines) {
        const bold = line.startsWith("📅") || line.startsWith("🕒") || line.startsWith("📚");
        const clean = bold ? line.slice(line.indexOf(" ") + 1) : line;
        parts.push(svgLabeledText(clean, 72, ly, 28, bold));
        if (line.startsWith("Викладач:")) {
          const avatarIndex = teacherIndex;
          const teacher = teachers[teacherIndex++];
          const avatar = teacher?.photo ? `data:${imageMime(teacher.photo)};base64,${teacher.photo.toString("base64")}` : "";
          const photoWidth = 280;
          const ax = 1158 - photoWidth;
          const ay = y + 3;
          const photoHeight = h - 6;
          if (avatar) parts.push(`<defs><clipPath id="avatar-${avatarIndex}" clipPathUnits="userSpaceOnUse"><rect x="${ax}" y="${ay}" width="${photoWidth}" height="${photoHeight}" rx="18"/></clipPath></defs><image href="${avatar}" x="${ax}" y="${ay}" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-${avatarIndex})"/>`);
          else {
            const radius = 38;
            const cx = ax + photoWidth / 2;
            const cy = ay + photoHeight / 2;
            parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#2d6cc0"/>${svgText(initials(teacher?.name ?? ""), cx, cy + 8, 22, true, "white", true)}`);
          }
        }
        ly += 42;
      }
      y += h + 18;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${Math.min(2400, y + 30)}">${parts.join("")}</svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  }
}

export function paginateScheduleBlocks(blocks: string[], maxHeight = MAX_HEIGHT): string[][] {
  const pages: string[][] = [[]];
  let height = 190;
  let currentDate: string | undefined;
  const newPage = () => { pages.push([]); height = 190; };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const blockHeight = estimateHeight(block);
    if (block.startsWith("📅 ")) {
      currentDate = block;
      // A calendar day owns its image page. A long day may continue onto
      // additional pages below, but a new date must never share a page.
      if (pages.at(-1)!.length) newPage();
      pages.at(-1)!.push(block);
      height += blockHeight;
      continue;
    }
    if (height + blockHeight > maxHeight && pages.at(-1)!.length) {
      newPage();
      if (currentDate) { pages.at(-1)!.push(currentDate); height += estimateHeight(currentDate); }
    }
    pages.at(-1)!.push(block);
    height += blockHeight;
  }
  return pages.filter((page) => page.length > 0);
}

function estimateHeight(block: string): number { return 35 + block.split("\n").flatMap((line) => wrap(line, 48)).length * 42 + 18; }
function wrap(line: string, max: number): string[] { const words = line.split(/\s+/); const result: string[] = []; let current = ""; for (const word of words) { if ((current + " " + word).trim().length > max && current) { result.push(current); current = word; } else current = (current + " " + word).trim(); } if (current) result.push(current); return result.length ? result : [""]; }
function imageMime(bytes: Buffer): string { if (bytes.subarray(0, 4).toString("hex") === "89504e47") return "image/png"; if (bytes.subarray(0, 3).toString() === "GIF") return "image/gif"; return "image/jpeg"; }
function svgLabeledText(value: string, x: number, y: number, size: number, bold: boolean): string {
  if (bold) return svgText(value, x, y, size, true, "#172b4d");
  const separator = value.indexOf(":");
  const label = separator >= 0 ? value.slice(0, separator + 1) : "";
  if (!["Тип:", "Аудиторія:", "Викладач:", "Група:"].includes(label)) return svgText(value, x, y, size, false, "#172b4d");
  const valueText = value.slice(separator + 1);
  return svgText(label, x, y, size, true, "#1556aa")
    + svgText(valueText, x + textWidth(label, size, true), y, size, false, "#172b4d");
}
function svgText(value: string, x: number, y: number, size: number, bold: boolean, fill: string, centered = false): string {
  let cursor = centered ? x - textWidth(value, size, bold) / 2 : x;
  let path = "";
  for (const char of value) {
    const font = fontFor(char, bold);
    path += font.getPath(char, cursor, y, size).toPathData(1);
    cursor += font.getAdvanceWidth(char, size);
  }
  return `<path d="${path}" fill="${fill}"/>`;
}

function textWidth(value: string, size: number, bold: boolean): number {
  return [...value].reduce((width, char) => width + fontFor(char, bold).getAdvanceWidth(char, size), 0);
}

function fontFor(char: string, bold: boolean) {
  const cyrillic = bold ? boldFont : regularFont;
  return cyrillic.charToGlyphIndex(char) ? cyrillic : (bold ? boldLatinFont : regularLatinFont);
}
