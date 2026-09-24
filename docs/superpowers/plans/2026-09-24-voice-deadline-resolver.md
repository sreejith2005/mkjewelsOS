# Voice task deadlines: deterministic resolver

## Problem

`interpret-task-voice` asked the extraction model for `due_datetime`, an ISO
instant it computed itself from a clock in the prompt. Relative expressions
("next Monday", "second week of next month") were therefore resolved by the
model, with no fixed week definition and no validation beyond "not in the
past". Web and native both prefill whatever instant came back.

## Design

```text
voice -> transcription -> extraction (date_expression, time_expression: words as said)
      -> resolveVoiceDeadline(expressions, one reference instant, tenant timezone)
      -> validated VoiceDeadline -> draft.plannedDatetime (only when resolved)
      -> existing composer review / gaps / Assign
```

- `packages/core/src/voiceDeadline.ts` is the only interpretation of spoken
  deadlines. The edge function imports it; web and native render its output.
- The model no longer sees today's date and never returns a calendar date.
- Reference instant: one `new Date()` taken per request in the edge function.
  Timezone: `tenants.timezone` (default `Asia/Kolkata`), validated with `Intl`.
- Status: `resolved` fills the form; `missing`, `ambiguous`, `invalid`, `past`
  leave `plannedDatetime` null so the existing "due" gap blocks Assign.
- Product rules (documented in the module header and pinned by tests):
  Monday-Sunday week; `next <weekday>` = that day in next week; bare/`coming`
  weekday = next occurrence after today; `this <weekday>` = this week's day
  (already passed -> ambiguous); week N of a month = the week starting on the
  month's Nth Monday; week/weekend/month-only expressions are ranges and need
  confirmation; beginning/middle/end of month = 1st/15th/last day; end of
  week = Sunday; no spoken time = 19:00; bare hour 1-7 = PM, 8-11 = AM.

## Client changes

Web `TaskComposer` and native `TaskComposerScreen` show `draft.deadline.note`
and clear a stale due value when the new note named a deadline that could not
be resolved. Submit guards are unchanged.

## Validation

- `pnpm.cmd --filter @jewelos/core test` (resolver + draft tests, fixed clock)
- `deno task test` / `deno task check` in `supabase/functions/interpret-task-voice`
- web/mobile composer tests, turbo typecheck, `git diff --check`
- Hosted: deploy `interpret-task-voice` (not done without approval).
