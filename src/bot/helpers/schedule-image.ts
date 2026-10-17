export function imageKeyboard(id: string, page: number, total: number) {
  const row = [] as Array<{ text: string; callback_data: string }>;
  if (page > 0) row.push({ text: "‹ Назад", callback_data: `schedule-image:${id}:${page - 1}` });
  if (page < total - 1) row.push({ text: "Далі ›", callback_data: `schedule-image:${id}:${page + 1}` });
  return row.length ? { inline_keyboard: [row] } : undefined;
}

export function textKeyboard(id: string, page: number, total: number) {
  const row = [] as Array<{ text: string; callback_data: string }>;
  if (page > 0) row.push({ text: "‹ Назад", callback_data: `schedule-text:${id}:${page - 1}` });
  if (page < total - 1) row.push({ text: "Далі ›", callback_data: `schedule-text:${id}:${page + 1}` });
  return row.length ? { inline_keyboard: [row] } : undefined;
}
