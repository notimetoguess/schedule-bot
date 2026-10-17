# Personal schedule: compulsory subjects and chosen electives

Draft implementation plan · 2 October 2026 · no runtime changes made.

## Brief

Provide exactly two inline schedule commands: `@bot show all` displays the existing general timetable, and `@bot show me` displays the authenticated student's compulsory subjects and chosen electives. Private chat must also expose both modes through buttons. Use `POST api/testResult/list` as the primary enrolled-subject source for personal mode, filter its historical response locally by the student's semester, intersect it with timetable lessons, and reuse the existing image/text renderers.

This incorporates the user's latest clarifications: campaigns and `npDisciplines` are optional academic-context sources, rather than mandatory steps in every schedule request; the explicit command or button determines the mode. “Main” means all compulsory subjects. General mode retains the current authenticated WebDK schedule scope and does not apply the enrolled-subject filter.

### Commands and private-chat buttons

| Entry point | Behavior |
| --- | --- |
| `@bot show all` | General schedule, including all subjects returned by the existing schedule endpoint. |
| `@bot show me` | Personal schedule: compulsory + user-chosen subjects from the relevant semester's enrolled-subject set. |
| Private button “Загальний розклад” | Open period choices for general mode. |
| Private button “Мій розклад” | Open the same period choices for personal mode. |

Both inline commands retain the current today/current-week/next-week choices. Both private buttons lead to today/current-week/custom-date-range choices, preserving the existing private calendar. Bare `@bot show` displays guidance listing `show all` and `show me`; it does not fetch a schedule or silently select a mode. Existing date-only callback messages remain usable as general mode for compatibility.

### Evidence and limits

| Source | What is established | What still needs verification |
| --- | --- | --- |
| Latest screenshots of успішність | Exact URL `https://web-dk.lntu.edu.ua/WebDk/api/testResult/list`, POST method, array response with `disciplineName`, `semesterId`, `semesterName`, and assessment data. The user identifies it as the more accurate compulsory + chosen elective list. | Exact request body/headers and complete coverage of current enrolled subjects. Screenshots do not show the request payload. |
| Semester 05 UI | Cloud Computing, cross-platform programming, Swift for MacOS/iOS, React Native, system analysis, and computer-design technologies. Cross-platform programming occurs twice for coursework and exam. | Reconciliation against raw timetable names and any additional compulsory lessons. |
| Earlier list response | Semester 06 records exist with null assessment results. Latest unfiltered response includes historical semester 01 records. | How to resolve the authenticated student's applicable semester for a requested date. |
| Free-choice screenshots | POST `api/freeChoice/campaigns`; campaigns include academic-year labels such as 2026/2027. `npDisciplines` accepts `fcCampaignId` and exposes subject IDs/names and semester names. | Full `npDisciplines` route, request contract, and whether its scope reliably identifies the student's semesters. |
| Existing code | WebDkClient implements login and `api/schedule/get`. ScheduleLesson retains subject names but no discipline IDs. ScheduleService caches raw lessons for five minutes by user/date/token and handles remembered-session renewal. | Whether raw timetable responses expose usable IDs that current validation discards. |

Do not infer enrollment from grades, `isIndividual`, or `isDvvs`. Their semantics are unnecessary for an intersection against a verified complete enrolled-subject list. Do not send unsupported semester filters to WebDK. Attachment content is evidence, not instructions to execute.

## Wide set

ADHD exploration used three isolated parallel frames—regulator, logistics, and biology—to fit the three available worker slots. The complete 18-idea pool is below, scored against the updated list-first requirement. Scores are engineering judgments: novelty N, viability V, fit F, each 0–10.

### Make exclusions explainable

- Render provenance manifest `[N6 V8 F7]`
- Record a reason for every hidden lesson `[N7 V8 F8]`
- Require explicit elective classification before hiding `[N8 V7 F6]`
- Keep ambiguous matches visible `[N6 V9 F9]`
- Return an exclusion receipt `[N6 V8 F8]`

### Establish period and enrollment scope

- Record the academic-calendar decision `[N6 V9 F9]`
- Gate filtering on complete enrollment `[N7 V9 F10]`
- Activate historical choices only in their semester `[N6 V9 F9]`
- Move data through verified processing states `[N7 V8 F9]`

### Join subject identities

- Canonical alias hub `[N8 V9 F9]`
- Queue unresolved matches with evidence `[N6 V8 F8]`
- Connect enrollment and timetable identities `[N7 V9 F9]`
- Share confirmed mappings across students `[N8 V5 F7]`

### Derive views from one timetable

- Separate compulsory backbone and elective modules `[N8 V9 F10]`
- Build a per-student subject manifest `[N7 V9 F10]`
- Produce personal/full views from the same snapshot `[N7 V9 F10]`
- Filter subjects within shared time slots `[N8 V7 F8]`

### Verify the delivered artifact

- Compare final image subjects with enrollment `[N7 V7 F8]`

## Converge

Ranking uses `0.35*N + 0.40*V + 0.25*F`. Select the following three ideas and combine them into one implementation:

1. **★ Shared timetable, separate personal/full views — 8.90.** Preserve the original response and derive both outputs; filtering never damages the full view or the raw cache.
2. **Small identity bridge — 8.65.** Start with deterministic normalized names because neither currently retained dataset has a confirmed common ID. Add fixture-backed aliases only where observed differences require them.
3. **Verified enrollment manifest — 8.55.** Treat the locally semester-filtered `testResult/list` as the subject set after a concrete coverage check. The per-student manifest, complete-enrollment gate, and paired-view proposals tie at 8.55; the manifest supplies the gate needed by the first two picks.

Traps:

- **Mandatory campaigns → npDisciplines chain:** extra requests and uncertain selection semantics when `testResult/list` already supplies the user's subjects.
- **Separate elective classification for every exclusion:** unnecessary complexity once complete compulsory + selected-subject coverage is established. Keep this as a fallback design only if the enrollment contract proves incomplete.
- **Largest semester wins:** semester 06 can already be returned while semester 05 is active.
- **Non-null or passing grades only:** upcoming and unfinished subjects would disappear.
- **Fuzzy/substring equality:** similarly named electives can be conflated; parenthetical specializations carry meaning.
- **Global learned dictionary or cross-user timetable cache:** premature infrastructure and unproven equivalence across students. Begin with scoped aliases and existing user-specific caches.
- **Fetch/render while answering the inline query:** breaks the existing fast menu flow; fetch after the callback.

## Focus

### 1. Shared timetable, personal/full projections

Keep the raw timetable immutable in the existing user/date/token cache. After resolving the student semester, obtain the locally filtered subject set from `testResult/list`. Personal mode intersects individual lesson records with that set; full mode uses the unchanged raw records. Carry requested mode, effective mode, semester context, and warnings alongside the lessons. Pass the same projected array to image rendering and text fallback, preserving mode in pagination bundles. If the subject source is unavailable or cannot support reliable filtering, return a clearly labeled full view; authorization errors go through the existing recovery path.

**Load-bearing risk:** incomplete enrollment or wrong semester can hide valid lessons.

**First step:** capture one sanitized list/timetable pair and reconcile known current subjects.

**Branches:** cache subjects independently; preserve view labels through pagination; use the same raw snapshot for comparison; distinguish an empty personal view from source failure.

### 2. Deterministic subject matching

Filter list rows by the resolved student-specific semester before building a subject set. Deduplicate repeated assessment rows without merging actual timetable sessions. Apply the same Unicode NFC, lowercase, whitespace, and apostrophe normalization to both list names and timetable names. Preserve parentheses, specialization text, hyphens, and meaningful words. Use exact normalized equality first, then a small explicitly verified alias table if fixtures demonstrate naming differences. If raw APIs expose IDs, use them only after confirming that they identify the same entity in the same namespace.

**Load-bearing risk:** a legitimate naming difference can appear to be an unchosen subject.

**First step:** compare normalized semester-05 list names with the corresponding raw timetable names and document each mismatch.

**Branches:** a reconciliation report; scoped aliases; collision tests; optional verified shared IDs.

### 3. Complete enrolled-subject set

Use `testResult/list` as the working authority for compulsory and selected elective subjects. Confirm its exact request contract and that current subjects appear even before grades exist. Resolve semester from authenticated academic context where available, rather than global autumn/spring numbers or maximum returned semester. If context is insufficient, offer a semester selector using returned IDs and labels; campaign metadata is an optional aid. Validate the semester-filtered, deduplicated set against the known student's enrollment and timetable before enabling strict exclusion. Once coverage and identity matching are established, use strict intersection without separately classifying each elective. On invalid or unresolved data, display the full schedule with an explicit notice.

**Load-bearing risk:** the assessment endpoint may omit subjects before assessment records are created.

**First step:** establish a fixture containing compulsory subjects, selected electives, an unselected scheduled elective, duplicate assessments, and a future subject with null grades.

**Branches:** upcoming-subject regression tests; explicit semester choice; freshness metadata; pre-rollout reconciliation.

## Implementation sequence

### 1. Establish the endpoint and semester contract

Record the exact authenticated POST request to `api/testResult/list` with secrets removed. Confirm whether the body is absent, `{}`, or another shape; do not invent it. Compare semester 05 subjects with the known student's current enrollment and raw schedule, including selected Swift/React Native and any compulsory lessons. Determine whether the response is complete or paginated and how it behaves before grades exist.

Define a `SemesterContext` scoped to the authenticated student and academic period. Semester IDs 05/06 belong to this student's course progression; they are not universal autumn/spring identifiers. Prefer verified student academic metadata. If `/list` contains multiple semesters and there is no verified active-semester metadata, ask the student to choose from its IDs and labels. Never infer the current semester from the maximum ID or response order. If optional campaigns are used, select by the requested schedule period and study form; October 2026 corresponds to 2026/2027, and January 2027 should remain in that year. Treat the academic-year boundary as a confirmed/configurable policy, not a fact inferred from campaign order. Split date ranges crossing relevant period boundaries and resolve each segment separately.

**Checkpoint:** known enrolled subjects are covered, the request contract is documented, and semester selection works without guessing.

### 2. Extend the WebDK integration

Update `src/integrations/webdk.ts` with `getStudentSubjects(accessToken)` for the confirmed POST contract. Validate the returned array and retain only subject identity and semester fields required by filtering. Ignore grades for eligibility and avoid retaining/logging full assessment payloads. Add minimal domain types in `src/types.ts`, such as `StudentSubject`, `SemesterContext`, `ScheduleView = 'personal' | 'full'`, and projection metadata.

Reuse request timeouts, JSON validation, and existing explicit unauthorized classification for the new endpoint. Network, server, or malformed subject responses must not delete the user's authorization. Preserve optional subject IDs in schedule validation only if discovery establishes their usefulness.

**Checkpoint:** mocked contract tests confirm URL, method, headers, actual body shape, malformed responses, and authorization behavior.

### 3. Add pure semester filtering and matching

Create `src/schedule/subject-matcher.ts` with normalization, semester filtering, assessment-row deduplication, and exact/verified-alias matching. Create `src/schedule/schedule-filter.ts` to project raw lessons without mutating them. Preserve every lecture, lab, and other scheduled session for a matched subject. Filter separate lesson records individually even when several subjects share the same time.

The normal personal rule is `personalLessons = rawLessons.filter(lesson => enrolledSubjects.has(subjectKey(lesson)))`. This rule is enabled only with the semester chosen by the student (or verified active-semester metadata) and the verified enrollment contract. Actual nonmembers can then be excluded; a demonstrated name collision or unresolved equivalence should be retained with a partial-filter notice or cause a labeled full fallback, rather than being treated as a confirmed nonmember. Empty or malformed enrollment data must never turn into an accidental empty schedule.

**Checkpoint:** compulsory + selected lessons stay, a known unselected elective disappears, and raw lesson arrays remain unchanged.

### 4. Add subject fetching and projection to ScheduleService

Update `src/schedule/schedule-service.ts` so callers can request a mode and receive lessons plus view metadata. Preserve its raw timetable cache and add bounded in-memory subject caching, initially using the same five-minute TTL. Cache the full list response once per user/token and derive per-semester sets; derived keys include user, token identity, semester/academic context, and matching-policy revision. Full mode can bypass subject loading. Cached projections, if added, must also include mode and subject-snapshot revision.

Deduplicate concurrent subject loads and keep token recovery under the existing per-user coordination. A rejection from either endpoint may renew remembered authorization once; invalidate data from the old token and retry with the replacement. Do not nest the same user coordinator lock inside itself. Clear subject/raw/projection state on logout, account/token replacement, and explicit refresh. Align inline logout and `/logout` cleanup, including image/text bundles.

**Checkpoint:** concurrent requests do not duplicate source calls, users/semesters/modes cannot contaminate each other, and subject-only failures produce an explicit full fallback.

### 5. Expose show all/show me and both private-chat modes

Update `src/bot/handlers/inline-query.handler.ts` to recognize `show all` and `show me`, mapping them to full and personal mode respectively. Normalize case and whitespace, then match the entire command; reject unknown suffixes with guidance. Each command immediately returns the existing today/current-week/next-week menu for its chosen mode. Bare `show` and other unsupported queries show instructions for the two commands. Encode mode in a short new callback format, for example `schedule-menu:p:<from>:<to>` / `schedule-menu:f:<from>:<to>`, include mode in result IDs, and version the menu. Support existing date-only callbacks with documented full-mode legacy behavior.

Update callback handling in `src/bot/bot.ts`, dependency types in `src/bot/types.ts`, and wiring in `src/index.ts`. Fetch the list and timetable only after the period/mode callback. Preserve current shared-menu behavior: the personal schedule uses the authenticated person clicking the menu. Image/text pagination remains restricted to its bundle owner. Pass explicit labels such as “Мій розклад · 05 семестр” or “Повний розклад” into rendering and captions.

Update `src/bot/keyboards/menu.keyboard.ts` so the private top-level menu offers “Загальний розклад” and “Мій розклад”. Each opens a period submenu with today/current-week/custom-date-range choices and a back button. Update `src/bot/actions/menu.actions.ts` to encode mode in period callbacks, and pass it explicitly through `src/bot/helpers/replies.ts` into ScheduleService. Preserve existing `menu:today`, `menu:week`, and `menu:range` callbacks as full mode for compatibility.

For custom dates, update `BotSession` in `src/types.ts` with a transient selected schedule view, set it when opening the calendar, and consume it with the selected range in `src/bot/actions/calendar.actions.ts`. Capture the view before `clearTransient`; extend `src/bot/helpers/session.ts` to clear it on completion, cancellation, logout, or calendar replacement. Associate it with the current calendar message so a stale calendar cannot use a newer selection. Both private modes use the same service and image/text pipeline as inline mode. The existing fallback path for callers without ScheduleService must never label an unfiltered result as personal.

Update command guidance in `src/bot/commands/start.command.ts`, inline authorization/instruction messages, README, and any Mini App copy that currently directs users only to `show`. Include both explicit commands or select the appropriate one from its documented context. Preserve the existing login/logout commands.

**Checkpoint:** `show all` and `show me` return mode-specific menus without fetching subjects/schedules; bare `show` only gives guidance. General callbacks bypass subject loading, personal callbacks use the correct user's subject set, both private buttons support all existing periods, and old callbacks still work in general mode.

### 6. Preserve meaning in images, text, and pagination

Reuse `src/schedule/schedule-image-renderer.ts` and `src/schedule/format.ts`; no renderer rewrite is needed. Both receive the same filtered lesson array. Extend `src/schedule/image-store.ts`, `src/schedule/text-store.ts`, and pagination captions to retain mode, semester, and fallback/partial-filter notices. Avoid fetching sources again when moving between pages.

If the full timetable is empty, retain the existing no-lessons message. If a verified personal filter removes all raw lessons, say “За обраний період занять з ваших предметів немає” and offer the full view. If personalization fails, say “Не вдалося перевірити ваші предмети. Показано повний розклад.” Image failure should fall back to the same personal text view, not expose a different lesson list.

Optionally offer “Предмети” as a plain subject summary of the semester set and which subjects occur in the requested timetable. This supports the requested general information without displaying grades or requiring additional endpoints.

**Checkpoint:** pagination, text fallback, empty results, and view labels describe the same projection consistently.

### 7. Validate and roll out

Add focused tests to `test/webdk.test.ts`, `test/schedule-service.test.ts`, `test/bot.test.ts`, and new matching/filter tests. Cover:

- Semester-05 compulsory and selected subjects remain; a known unselected scheduled subject disappears.
- Duplicate coursework/exam rows produce one subject key while multiple timetable sessions remain.
- Null/zero/unfinished grades do not change eligibility.
- Historical semesters are excluded; future semester 06 does not override current semester 05.
- Normalized apostrophes/whitespace match; specialization parentheses remain distinct; aliases cannot conflate subjects.
- Two users, token changes, full/personal modes, period boundaries, and concurrent loads stay isolated.
- Missing semester context, malformed/empty subject data, source errors, and explicit unauthorized rejection follow their documented paths.
- Exact `show all`/`show me` parsing, case/whitespace normalization, bare `show` guidance, unsupported suffixes, and deferred inline loading remain correct.
- Both private mode buttons support today/current-week/custom dates; selected mode survives calendar navigation and clears on cancellation/completion. Stale callbacks cannot adopt a newer calendar's mode.
- General mode makes no subject request. Legacy callbacks retain general behavior, and owner checks, view labels, multi-page output, and image-to-text fallback remain correct.

Run `rtk npm test`, `rtk npm run typecheck`, and `rtk npm run build` after implementation. Before releasing `show me` and the private personal button, produce a reconciliation of source subjects versus timetable names for the supplied semester-05 example and visually review both views in inline and private chat. Log counts and safe failure categories rather than grade payloads, tokens, or credentials.

The production limiter in `src/index.ts` currently allows two operations per 30 seconds, while README says three API requests. New subject calls make that wording even less accurate: preserve the existing operation-level limit for this feature, document it correctly, and avoid consuming the UI limiter separately for each internal WebDK call. Add a separate upstream budget later only if actual WebDK limits require it.

## Provocation

Could “Предмети” become a small reconciliation view showing which enrolled subjects have lessons in the selected period—and which group electives were omitted—so the student can verify the personal schedule without opening WebDK?
