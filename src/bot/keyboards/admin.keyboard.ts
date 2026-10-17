import { Markup } from "telegraf";

export const cabinetKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("Створити оголошення", "cabinet:create")],
  [Markup.button.callback("Чернетки", "cabinet:drafts")],
  [Markup.button.callback("‹ До головного меню", "cabinet:menu")],
]);
export const composeKeyboard = (id: string, revision: number, hasMedia: boolean) => Markup.inlineKeyboard([
  [Markup.button.callback("Опублікувати", `cabinet:publish:${id}:${revision}`)],
  [Markup.button.callback("Змінити текст", `cabinet:text:${id}:${revision}`)],
  [Markup.button.callback(hasMedia ? "Замінити медіа" : "Додати медіа", `cabinet:media:${id}:${revision}`)],
  ...(hasMedia ? [[Markup.button.callback("Прибрати медіа", `cabinet:remove-media:${id}:${revision}`)]] : []),
  [Markup.button.callback("До кабінету", "cabinet:home")],
]);
export const mediaTypeKeyboard = (id: string, revision: number) => Markup.inlineKeyboard([
  [Markup.button.callback("Фото", `cabinet:media-type:${id}:${revision}:photo`), Markup.button.callback("Відео", `cabinet:media-type:${id}:${revision}:video`)],
  [Markup.button.callback("Скасувати", "cabinet:home")],
]);
export const mediaQuestionKeyboard = (id: string, revision: number) => Markup.inlineKeyboard([
  [Markup.button.callback("Так", `cabinet:media-question:${id}:${revision}:yes`), Markup.button.callback("Ні", `cabinet:media-question:${id}:${revision}:no`)],
  [Markup.button.callback("До кабінету", "cabinet:home")],
]);
