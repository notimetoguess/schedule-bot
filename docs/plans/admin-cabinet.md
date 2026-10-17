# Telegram admin cabinet

Draft implementation plan, based on the current repository. No runtime changes are included.

## Goal and first version

Let the person authenticated as `shyyan.d0806.122.24@lntu.edu.ua` create and publish announcements from the bot's private chat. Show that person a **«Твій кабінет»** button alongside the existing schedule choices.

The first version supports plain-text announcements and announcements with one photo or video, supplied through an HTTPS URL or a Telegram file. Include saved drafts, editing a draft, preview, and explicit publication. The bot generates the announcement ID and BSON dates. Reuse the current announcement delivery worker and its registered recipients.

Scheduled publication, delivery statistics, published-content editing, and admin management can follow separately. Cabinet media uses the existing `media: { type: "photo" | "video", url?: string, fileId?: string }` contract, preserving compatibility with manually created announcements.

## Proposed interaction

1. Authenticate through the existing Mini App.
2. Open the bot's private menu and choose **«Твій кабінет»**.
3. The cabinet offers **«Створити оголошення»**, **«Чернетки»**, and **«До головного меню»**.
4. Choose create. The bot asks **«Надішли текст оголошення»** and offers **«Скасувати»**.
5. Send the text. After validation and a successful database write, the bot previews the saved draft. Choose **«Додати медіа»** to attach one photo or video by uploading it, entering an HTTPS URL, or supplying an existing Telegram `fileId`. A media announcement is previewed as the actual photo/video with its text as the caption.
6. A separate control message offers **«Опублікувати»**, **«Змінити текст»**, **«Додати медіа»** (or **«Замінити медіа»** and **«Прибрати медіа»**), and **«До кабінету»**. Text-only announcements allow 4,096 characters; photo/video captions allow 1,024. If adding media would exceed the caption limit, ask the admin to shorten the text before attaching it; do not truncate silently.
7. Above the publish button, explain: **«Після публікації оголошення буде надіслано всім зареєстрованим активним приватним чатам і групам.»**
8. Publish saves the publication date automatically and replies **«Оголошення опубліковано. Розсилка почнеться автоматично.»** The existing worker discovers it on its next reconciliation, normally within about a minute when the database and worker are available. This confirms publication, rather than completion of every delivery.

Valid submitted text is saved immediately as a draft. Returning to the cabinet keeps it available under **«Чернетки»**. Cancel before submitting text creates no announcement. Saved drafts survive a restart; an interrupted conversation can be resumed from the draft list.

## Current integration points

- `src/http/handlers/authenticate.ts` binds a successful WebDk login to the Telegram user ID. Ordinary sessions currently retain no email identity.
- `src/auth/auth-store.ts` and `src/auth/mongo-auth-store.ts` expose and persist active sessions. The memory implementation explicitly selects fields when returning ordinary sessions.
- `src/bot/keyboards/menu.keyboard.ts` exports a static `MENU`; `showMenu` and `menu:back` both use it.
- `src/bot/handlers/text.handler.ts` currently sends any non-command private text back to the menu. Announcement composition must handle expected text before this fallback.
- `src/notifications/notification-store.ts` reads `announcements` with `status: "published"`, validates content, snapshots it, and creates durable deliveries. Drafts already use the exact status `"drafted"`.
- `src/notifications/notification-service.ts` reconciles every 60 seconds and handles sending, pacing, retries, and unreachable recipients.

## Implementation sequence

### 1. Persist the authenticated identity and define access

Add an optional `authenticatedEmail` field to `AuthSession` and `AuthDocument`. Set it from the login email only after `webDk.login` succeeds, normalizing with trim and lowercase. Persist and return it in both auth-store implementations. Keep passwords under the existing remember-me policy; this new field is identity metadata, independent of remembering credentials.

Add `ADMIN_EMAILS` to configuration and `.env.example`, with deployment configured as:

```dotenv
ADMIN_EMAILS=shyyan.d0806.122.24@lntu.edu.ua
```

Parse a normalized email allowlist; an absent or empty setting enables no administrators. Compute access from the active stored identity and the current allowlist rather than accepting an admin flag from the client or caching permanent rights in the conversation.

Create `src/bot/helpers/admin.ts` with one shared admin guard. Require a private chat, an unexpired authorization session belonging to `ctx.from.id`, and an exact normalized email match. Apply it to cabinet entry, every admin callback, and every composer input. A missing session prompts login; a database outage reports temporary unavailability and permits no write. Non-admin callers receive a concise access-denied response.

Preserve login idempotency: when `authenticate.ts` reuses an active session, use its stored identity. Never promote that session from the newly submitted email, because that branch skips WebDk authentication. Sessions created before this change remain valid for schedules but have no cabinet access until a fresh login. Do not infer identity from Telegram text, username, or display name.

Ensure remembered-token replacement in `src/schedule/schedule-service.ts` retains the identity. Removing the email from configuration takes effect after the configuration is reloaded, without needing to wait for stored sessions to expire.

**Checkpoint:** the configured account receives access after successful authentication; failed login and resubmission against an existing non-admin session cannot grant access.

### 2. Make the menu conditional and provide private entry

Replace the static `MENU` with a menu builder accepting the resolved admin-access flag. Keep the two schedule choices and append **«Твій кабінет»** only for an authorized admin in private chat.

Update `showMenu`, its callers, and the direct `menu:back` rendering so the cabinet button appears consistently after `/start`, `/login`, schedule completion, calendar cancellation, and ordinary private messages. Re-read current access when constructing a menu. Old messages can retain buttons visually, so the callback guard remains authoritative.

Add a guarded `/cabinet` command as a direct entry and support a guarded `/start cabinet` deep link. The current Mini App's **«Чат боту»** action actually opens inline query guidance. For an authenticated admin, expose an additional success-screen shortcut into the bot's private cabinet using `https://t.me/<bot_username>?start=cabinet`. Obtain the bot username from runtime bot information and supply the shortcut server-side; derive it from the stored session on reused-login responses as well. Preserve ordinary users' existing success and return-to-group behavior.

Use `src/bot/actions/admin.actions.ts`, `src/bot/commands/cabinet.command.ts`, and a new cabinet keyboard module. Register them in `src/bot/bot.ts` and inject dependencies through `src/bot/types.ts` and `src/index.ts`.

**Checkpoint:** the admin can reach the cabinet after login; other users cannot invoke it through commands, fabricated callback data, groups, or inline messages.

### 3. Add draft persistence and safe publication

Create `src/announcements/announcement-store.ts` and `announcement-service.ts` with a MongoDB implementation using the existing shared client and `announcements` collection. Expose create, list-owned-drafts, load-owned-draft, update-draft, and publish operations.

Extend announcement documents with optional metadata so existing manually created documents remain compatible:

| Field | Cabinet-created behavior |
| --- | --- |
| `_id` | Stable server-generated UUID string |
| `status` | `"drafted"` until explicitly published |
| `text` | Validated plain text |
| `media` | Optional photo/video with exactly one source: HTTPS `url` or Telegram `fileId` |
| `createdBy` | Telegram user ID from the authenticated update |
| `createdAt`, `updatedAt` | BSON Dates generated automatically |
| `revision` | Integer incremented whenever draft content changes |
| `publishedAt` | Absent while drafted; BSON Date set at publication |
| `frozen` | Validated snapshot of the text and optional media being published |

All cabinet reads and writes scope by `createdBy`. Edit operations additionally require `status: "drafted"` and the expected revision. Paginate the draft list. Existing documents without ownership metadata remain available to the worker; do not automatically adopt them into an admin's editable list.

Extract shared content validation from the notification store for both cabinet and worker: nonempty plain text, at most 4,096 characters without media or 1,024 with media, and the existing photo/video source validation. Require exactly one of `url` or `fileId`; URLs must use HTTPS without embedded credentials, and source strings retain the existing 2,048-character limit. Validate when saving and again before publication. Send preview and delivery without a parse mode, matching current announcement behavior.

Publish with a single conditional MongoDB update matching ID, owner, `status: "drafted"`, and the previewed revision. Set `status: "published"` and the validated `frozen` payload together; use `$currentDate` for `publishedAt` and `updatedAt`. This prevents an old preview from publishing newer, unseen text and ensures the worker receives the exact approved content. No multi-document transaction or direct recipient loop is required.

Repeated publish clicks or a retry after an ambiguous database response must re-read the same owned announcement. Already-published content returns success without changing its date or creating a new announcement. A revision conflict requires a refreshed preview. Generate a draft ID once per compose operation and retain it before writing, so a create retry uses the same ID rather than creating a second draft.

Apply the existing bounded database-operation/readiness conventions to the new store. Report a saved/published result only after it is confirmed; on failure retain recoverable state and offer retry. Published announcements are read-only in the cabinet. A correction is a new announcement, consistent with the existing delivery snapshot policy.

**Checkpoint:** no JSON or date entry is needed; drafts never reach recipients; publication is atomic and repeated clicks preserve a single publication.

### 4. Support photo/video by URL or Telegram file

Add an attachment flow with **«Фото»** / **«Відео»** and a choice of upload, HTTPS URL, or existing Telegram file ID. Keep one optional attachment per announcement, matching the current worker's payload.

For uploads, accept Telegram photo/video messages and persist the Telegram `file_id` in `media.fileId`; choose the largest available photo size. No local file download, binary storage in MongoDB, or external hosting is required. For URL or file-ID input, use the selected media type and save the source as `media.url` or `media.fileId`. Replacing a source removes the old source field so a payload never contains both. Removing media restores a text-only draft.

Render previews through the same photo/video sending behavior as delivery, with the draft text as the caption. Confirm that the selected URL/file is usable by Telegram before offering publication; a failed preview retains the draft and asks for another source. Any text or attachment edit increments the draft revision and requires a fresh preview, so old controls cannot publish changed media. Freeze both text and media atomically at publication.

Handle missing captions by prompting for announcement text; retain the existing nonempty-text requirement. Explain unsupported input such as albums or unrelated file types and keep the draft unchanged. Support the photo/video formats already accepted by the existing sender.

**Checkpoint:** an admin can save, reopen, replace/remove, preview, and publish a photo or video supplied by URL or Telegram file, and the existing worker receives the same payload shape as today.

### 5. Add the compose state and connect delivery

Create `src/bot/handlers/admin-message.handler.ts` and register it before the generic text handler. Process text, photo, and video only when expected by an active composer. Route URLs/file IDs through the corresponding attachment step; explain unsupported attachments without changing the draft. Commands continue through their normal handlers.

Extend `BotSession` with a small optional composer state containing the draft ID, text/media/source-entry step, selected media type, expected revision, and current prompt/control reference. Keep accepted text and media references in MongoDB. Bind callbacks to the draft ID and revision, check ownership on the server, and reject obsolete controls. Keep callback data within Telegram's existing size constraint.

Extend `clearTransient` and navigation handling: entering composition clears calendar state; opening schedule actions, `/start`, `/login`, and either logout route ends composition. Saved drafts remain recoverable after navigating away. Use the existing session lock around mutations and MongoDB revision checks for concurrent or stale updates. Session expiry or loss of access ends composition and blocks further writes.

Pass the new announcement service through runtime composition. Let the existing notification worker discover published documents, create delivery-ledger entries, and send them. Preview sends only to the admin's private chat. No recipient registration or delivery bypass is introduced.

**Checkpoint:** composing text is not swallowed by the menu fallback, navigation cannot accidentally become announcement content, and publication reaches the existing queue.

### 6. Verify and roll out

Add focused coverage to the existing auth, bot, schedule-service, and MongoDB integration suites, plus announcement-service tests:

- Correct email, normalized email, different email, failed authentication, missing identity, expired session, and database failure.
- Existing-session login reuse cannot promote a student from an unverified submitted admin email.
- Identity survives both ordinary auth-store reads and remembered-token replacement; logout removes access.
- Conditional menus, Mini App cabinet entry, guarded commands/callbacks, group/inline rejection, and owner isolation.
- Create, preview, edit, resume-after-restart, cancel, whitespace-only input, and the 4,096-character boundary.
- Photo and video via HTTPS URL, uploaded Telegram file, and existing file ID; attachment persistence, replacement/removal, actual media previews, and the 1,024-character caption boundary.
- Invalid URLs/file IDs, conflicting source fields, missing text, failed media previews, unsupported uploads, and stale controls after a media change cannot publish invalid or unseen content.
- Preview creates no publication; stale preview conflicts; double/concurrent publish and retry preserve one ID/date/snapshot.
- Real MongoDB confirms BSON dates, atomic publication, and compatibility with notification reconciliation and the durable delivery ledger.
- Existing schedule menus, login behavior, legacy callbacks, and manually created announcements keep working.

After implementation run `rtk npm test`, `rtk npm run typecheck`, and `rtk npm run build`. Run integration tests with the existing disposable `MONGODB_TEST_URI` setup, and do a Telegram smoke test with a separate test bot/database before broadcasting real content. The worker's existing rare duplicate-delivery risk after a send with unknown outcome remains unchanged; publication idempotency does not promise exactly-once Telegram delivery.

Update README and Mini App privacy copy to disclose persisted login email identity, document `ADMIN_EMAILS`, cabinet usage, photo/video URL and file input, caption limits, and generated publication dates. Deploy the setting, then perform `/logout` followed by a fresh Mini App login for the configured admin account. No destructive data migration is required.

**Done when:** the configured admin logs in, sees **«Твій кабінет»**, saves and previews text-only and photo/video drafts using URL or file sources, publishes once, and the existing worker delivers them without any manual MongoDB editing.
