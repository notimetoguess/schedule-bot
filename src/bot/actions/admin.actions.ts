import type { Telegraf } from "telegraf";
import { validate, type CabinetAnnouncement } from "../../announcements/announcement-store.js";
import { ensureAdmin } from "../helpers/admin.js";
import { clearTransient } from "../helpers/session.js";
import { cabinetKeyboard, composeKeyboard, mediaQuestionKeyboard, mediaTypeKeyboard } from "../keyboards/admin.keyboard.js";
import { menuKeyboard } from "../keyboards/menu.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";
import { userKey } from "../helpers/auth.js";

export function registerAdminActions(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.action(["cabinet:home", "cabinet:menu"], async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await ensureAdmin(ctx, dependencies))) return;
    clearComposer(ctx);
    if (ctx.match[0] === "cabinet:menu") { await ctx.editMessageText("Оберіть тип розкладу:", menuKeyboard(true)); return; }
    await ctx.editMessageText("Твій кабінет:", cabinetKeyboard);
  });
  bot.action("cabinet:create", async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const draft = await dependencies.announcements.create(userKey(ctx));
    ctx.session.announcementComposer = { id: draft.id, step: "text", revision: draft.revision };
    await ctx.editMessageText("Надішли текст оголошення. Для скасування натисни «До кабінету».", cabinetKeyboard);
  });
  bot.action("cabinet:drafts", async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const drafts = await dependencies.announcements.listDrafts(userKey(ctx));
    if (!drafts.length) { await ctx.editMessageText("Чернеток поки немає.", cabinetKeyboard); return; }
    await ctx.editMessageText("Оберіть чернетку:", { reply_markup: { inline_keyboard: [...drafts.map((draft) => [{ text: previewTitle(draft), callback_data: `cabinet:open:${draft.id}` }]), [{ text: "‹ До кабінету", callback_data: "cabinet:home" }]] } });
  });
  bot.action(/^cabinet:open:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies))) return;
    const draft = await dependencies.announcements?.get(userKey(ctx), ctx.match[1]!); if (!draft) { await ctx.editMessageText("Чернетку не знайдено.", cabinetKeyboard); return; }
    await showDraft(ctx, draft);
  });
  bot.action(/^cabinet:(text|media):([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const draft = await dependencies.announcements.get(userKey(ctx), ctx.match[2]!); if (!draft || draft.status !== "drafted" || draft.revision !== Number(ctx.match[3])) { await ctx.reply("Чернетка змінилася. Відкрийте її ще раз."); return; }
    ctx.session.announcementComposer = { id: draft.id, step: ctx.match[1] === "text" ? "text" : "media-type", revision: draft.revision };
    if (ctx.match[1] === "text") await ctx.reply("Надішли новий текст оголошення.");
    else await ctx.reply("Оберіть тип медіа:", mediaTypeKeyboard(draft.id, draft.revision));
  });
  bot.action(/^cabinet:media-type:([0-9a-f-]{36}):(\d+):(photo|video)$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies))) return;
    ctx.session.announcementComposer = { id: ctx.match[1]!, revision: Number(ctx.match[2]), step: "media-source", mediaType: ctx.match[3] as "photo" | "video" };
    await ctx.reply("Надішли файл у Telegram або HTTPS-посилання чи file_id.");
  });
  bot.action(/^cabinet:media-question:([0-9a-f-]{36}):(\d+):(yes|no)$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const draft = await dependencies.announcements.get(userKey(ctx), ctx.match[1]!);
    if (!draft || draft.status !== "drafted" || draft.revision !== Number(ctx.match[2])) { await ctx.reply("Чернетка змінилася. Відкрийте її ще раз."); return; }
    if (ctx.match[3] === "yes") {
      ctx.session.announcementComposer = { id: draft.id, step: "media-type", revision: draft.revision };
      await ctx.editMessageText("Оберіть тип медіа:", mediaTypeKeyboard(draft.id, draft.revision));
      return;
    }
    await showDraft(ctx, draft);
  });
  bot.action(/^cabinet:remove-media:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const draft = await dependencies.announcements.get(userKey(ctx), ctx.match[1]!); if (!draft || draft.revision !== Number(ctx.match[2])) { await ctx.reply("Чернетка змінилася. Відкрийте її ще раз."); return; }
    const changed = await dependencies.announcements.update(userKey(ctx), draft.id, draft.revision, { text: draft.text });
    if (typeof changed === "object") await showDraft(ctx, changed); else await ctx.reply("Не вдалося оновити чернетку.");
  });
  bot.action(/^cabinet:publish:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery(); if (!(await ensureAdmin(ctx, dependencies)) || !dependencies.announcements) return;
    const published = await dependencies.announcements.publish(userKey(ctx), ctx.match[1]!, Number(ctx.match[2]));
    if (published && typeof published === "object") { clearComposer(ctx); await ctx.editMessageText("Оголошення опубліковано. Розсилка почнеться автоматично.", cabinetKeyboard); }
    else await ctx.reply("Чернетка змінилася. Відкрийте її та перевірте перед публікацією.");
  });
}

export async function showDraft(ctx: BotContext, draft: CabinetAnnouncement): Promise<void> {
  ctx.session.announcementComposer = { id: draft.id, step: "idle", revision: draft.revision };
  if (draft.media?.type === "photo") await ctx.replyWithPhoto(draft.media.fileId ?? draft.media.url!, { caption: draft.text });
  else if (draft.media?.type === "video") await ctx.replyWithVideo(draft.media.fileId ?? draft.media.url!, { caption: draft.text });
  else await ctx.reply(draft.text);
  await ctx.reply("Чернетка. Перевірте вміст перед публікацією.", composeKeyboard(draft.id, draft.revision, Boolean(draft.media)));
}

function clearComposer(ctx: BotContext): void { delete ctx.session.announcementComposer; }
function previewTitle(draft: CabinetAnnouncement): string { return (draft.media ? "📎 " : "") + draft.text.slice(0, 34); }
