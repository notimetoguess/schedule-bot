import { Markup } from "telegraf";
import type { StudentSemesterChoice } from "../../schedule/subject-filter.js";

export function semesterKeyboard(choices: StudentSemesterChoice[], callbackFor: (semesterId: number) => string) {
  return Markup.inlineKeyboard(choices.map((choice) => [Markup.button.callback(choice.name, callbackFor(choice.id))]));
}
