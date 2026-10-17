import type { Telegraf } from "telegraf";
import { showDraft } from "../actions/admin.actions.js";
import { ensureAdmin } from "../helpers/admin.js";
import { mediaQuestionKeyboard } from "../keyboards/admin.keyboard.js";
import type { BotContext, BotDependencies } from "../types.js";
import { userKey } from "../helpers/auth.js";

export function registerAdminMessageHandler(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.on(["text", "photo", "video"], async (ctx, next) => {
    const state = ctx.session.announcementComposer;
    if (!state || state.step === "idle" || !dependencies.announcements || !ctx.message || ("text" in ctx.message && ctx.message.text.startsWith("/"))) return next();
    if (!(await ensureAdmin(ctx, dependencies))) return;
    const draft = await dependencies.announcements.get(userKey(ctx), state.id);
    if (!draft || draft.status !== "drafted" || draft.revision !== state.revision) { delete ctx.session.announcementComposer; await ctx.reply("Чернетка змінилася. Відкрийте її ще раз."); return; }
    try {
      if (state.step === "text" && "text" in ctx.message) {
        const changed = await dependencies.announcements.update(userKey(ctx), draft.id, draft.revision, { text: ctx.message.text, media: draft.media });
        if (typeof changed !== "object") throw new Error("conflict");
        if (changed.media) { await showDraft(ctx, changed); return; }
        ctx.session.announcementComposer = { id: changed.id, step: "media-question", revision: changed.revision };
        await ctx.reply("Додати медіа до оголошення?", mediaQuestionKeyboard(changed.id, changed.revision));
        return;
      }
      if (state.step === "media-source" && state.mediaType) {
        let source: { url?: string; fileId?: string } | undefined;
        if (state.mediaType === "photo" && "photo" in ctx.message) source = { fileId: ctx.message.photo.at(-1)?.file_id };
        if (state.mediaType === "video" && "video" in ctx.message) source = { fileId: ctx.message.video.file_id };
        if ("text" in ctx.message) source = /^https:\/\//i.test(ctx.message.text.trim()) ? { url: ctx.message.text.trim() } : { fileId: ctx.message.text.trim() };
        if (!source?.url && !source?.fileId) { await ctx.reply("Надішли відповідний файл, HTTPS-посилання або file_id."); return; }
        const changed = await dependencies.announcements.update(userKey(ctx), draft.id, draft.revision, { text: draft.text, media: { type: state.mediaType, ...source } });
        if (typeof changed !== "object") throw new Error("conflict"); await showDraft(ctx, changed); return;
      }
      await ctx.reply("Надішли текст оголошення або оберіть потрібну дію кнопкою.");
    } catch (error) { await ctx.reply(error instanceof Error && error.message.includes("long") ? error.message : "Не вдалося зберегти чернетку. Перевірте дані та спробуйте ще раз."); }
  });
}
