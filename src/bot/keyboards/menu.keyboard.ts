import { Markup } from "telegraf";

export function menuKeyboard(admin = false) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Загальний розклад", "menu:view:all")],
    [Markup.button.callback("Мій розклад", "menu:view:me")],
    ...(admin ? [[Markup.button.callback("Твій кабінет", "cabinet:home")]] : []),
  ]);
}

export function schedulePeriodKeyboard(view: "all" | "me") {
  return Markup.inlineKeyboard([
    [Markup.button.callback("На сьогодні", `menu:${view}:today`)],
    [Markup.button.callback("На цей тиждень", `menu:${view}:week`)],
    [Markup.button.callback("Обрати дати", `menu:${view}:range`)],
    [Markup.button.callback("‹ До вибору розкладу", "menu:back")],
  ]);
}
