# Voice-assigned tasks - design and implementation plan

Status: phase 1 (web) implemented 2026-09-16. Phase 2 (native composer and
recording) not started.
Scope: Tasks section only. Recurring/To-Do and FMS are untouched.

Implemented in phase 1:

| Area | Files |
| --- | --- |
| Shared roster matcher | `packages/core/src/personMatching.ts` |
| Draft logic and gaps | `packages/core/src/voiceTaskDraft.ts` (+ tests) |
| Edge Function | `supabase/functions/interpret-task-voice/` (+ `deno test`) |
| Quota migration | `supabase/migrations/0162_voice_task_interpretation_quota.sql` (+ pgTAP) |
| Web capture | `apps/web/src/features/tasks/VoiceTaskCapture.tsx`, `voiceApi.ts` |
| Composer prefill | `apps/web/src/features/tasks/TaskComposer.tsx` (+ `TaskComposerVoice.test.tsx`) |

Two deviations from the design below, both deliberate:

- The mic lives at the top of the existing composer only. The extra "Assign by
  voice" button on `TasksPage` in §3.3 was dropped: Create Task already opens
  the composer, and a second entry point would be a parallel path to maintain
  for no gain.
- The server enforces a 1 MB byte ceiling rather than measuring audio duration.
  The browser enforces the 60 s cap and stops the recorder itself; the byte
  ceiling is the bound that does not depend on the client.

## 1. Requirement

An owner/super admin/admin/manager records a short voice note in the Tasks
section. The note is transcribed, interpreted, and used to **prefill the
existing Assign New Task composer**: title, description, assignee, due date and
time, priority, task type, checklist items. A named person is resolved to that
user. A department instead of a name auto-assigns to an eligible member of that
department. Anything the note did not supply is shown as a warning on the
composer; the author fills it and presses Assign. From that point the flow is
byte-for-byte the flow that exists today.

## 2. Load-bearing decision: voice never writes a task

`create_manual_task_with_mode_with_audit` (migration 0134) remains the one and
only task write path. It already resolves the actor, validates the mode and
checklist, delegates to `create_delegation_task_with_audit`, and writes its
`audit_logs` row in the same transaction.

The voice feature adds a **read-only interpretation step that returns a draft**.
It does not create, does not bypass validation, and does not need a new write
contract. `TaskComposer.submitManual` and its guards are not modified. This is
what keeps the existing behaviour intact (AGENTS.md rules 2, 3, and the
regression-safe rules).

Nothing is auto-submitted. "Record, review, Assign" is the contract.

## 3. Components

### 3.1 Edge Function `supabase/functions/interpret-task-voice/`

Follows `ensure-my-recurring-tasks` exactly: `index.ts` does transport + auth,
`worker.ts` holds testable logic, `deno.json` pins imports, `worker.test.ts`
runs under `deno test`.

- `verify_jwt` stays at the default (true). **Do not** add this function to the
  `verify_jwt = false` list in `supabase/config.toml`.
- Auth: actor client from the `authorization` header -> `auth.getUser()` ->
  admin client -> `user_profiles` lookup with `account_status = 'active'` and
  `is_login_enabled`.
- Authorization: `admin.rpc('permission_effective_for', { p_profile_id, p_key:
  'tasks.manage_team' })` (migration 0156). That key already defaults to
  super_admin, admin, manager - the roles the request names, with "owner"
  mapping to super_admin, since `user_role` has no `owner` value. **No new
  permission key and no inline role list.**
- Input: `multipart/form-data`, one audio part. Reject anything that is not
  `audio/webm`, `audio/mp4`, `audio/m4a`, `audio/wav`, larger than 1 MB, or
  longer than 60 s. A 60 s Opus note is ~150 KB, so 1 MB is generous. The 60 s
  cap is enforced in the browser and re-checked here.
- Rate limit per actor, reusing the `username_login_rate_limits` shape from
  migration 0095 (hashed key, service_role-only grants, `consume_*` function).
  This is cost control on a paid third-party key, not a UX nicety.
- Stage 1 - transcription: `POST https://api.openai.com/v1/audio/transcriptions`
  with `gpt-4o-mini-transcribe` (about $0.003/min). `whisper-1` stays a
  configurable fallback because it accepts more tuning parameters and handles
  code-switched Indian English differently.
- Stage 2 - extraction: `gpt-4o-mini` with a **strict JSON schema** (structured
  outputs), temperature 0. The prompt carries the current Asia/Kolkata datetime
  so "tomorrow 5pm" resolves, plus the tenant's live department names and codes
  and the roster names the actor may assign to. Nothing about MDO / CRM / PC is
  hardcoded; those come from the `departments` rows.
- The model returns **hints, never identifiers**:
  `{ title, description, assignee_hint, department_hint, due_datetime,
     priority, task_type, checklist_items[] }`.
  The server resolves hints to ids deterministically (3.2). A model must never
  be able to invent a UUID that lands work on the wrong person.
- Output: `{ transcript, draft, resolution, gaps }`. `resolution` explains each
  resolved id ("matched name Priya Nair", "auto-assigned from CRM, lowest open
  load") so the composer can show it and the author can override.
- The audio is transcribed in memory and discarded. No Storage bucket, no
  signed URLs, no lifecycle job, no retention question about someone's voice.
- One `audit_logs` row per interpretation: action `task_voice_interpreted`,
  module `tasks`, recording duration, model, and resolved gaps. **Not** the
  transcript - a voice note can contain incidental personal content and the
  interpretation is not a write.

### 3.2 Pure core module `packages/core/src/voiceTaskDraft.ts`

All deterministic logic lives here, unit-tested, and is imported by the web
composer, the native composer, and the edge worker (the worker already imports
`../../../packages/core/src/recurrence.ts`, so this path is proven).

- `matchPersonBySpokenName(spoken, candidates)` - added during implementation.
  A note says "Reshma", not "Reshma Menon", and the import matcher deliberately
  requires first+last. The looser first-name step therefore lives in the voice
  module and import keeps its stricter rule. Uniqueness is still required: two
  Reshmas resolve to nobody and the composer asks.
- `matchPersonByLabel(label, candidates)` - name resolution. This logic already
  exists as `resolveIdentity` in
  `apps/web/src/features/tasks/import/identityMappings.ts` (exact email, alias,
  exact name, then first+last compact key, each requiring a *unique* match).
  Per AGENTS.md rule 5 it is **extracted into core and re-exported** by
  `identityMappings.ts` rather than copied. Behaviour is unchanged and the
  existing `identityMappings` tests guard the extraction.
- `matchDepartmentByLabel(label, departments)` - matches `departments.name` and
  `departments.code`.
- `autoAssignFromDepartment(candidates, context)` - deterministic and
  explainable: `departments.head_id` first when eligible, else the fewest open
  tasks for the due day, tie-broken by name (decision 8.2). Excludes anyone not
  `account_status = 'active'` / `working_status = 'active'` and anyone recorded
  `absent` or `half_day` in `user_availability` for the due date. Existing
  coverage behaviour (`taskCoverage.ts`) continues to handle absence that
  appears *after* assignment; this only avoids assigning into a known gap.
- `voiceDraftGaps(draft)` -> which of title / assignee / due / checklist is
  missing. It mirrors the checks already in `TaskComposer.submitManual` so the
  warning and the submit guard can never disagree.

### 3.3 Web - `apps/web`

- New `apps/web/src/features/tasks/VoiceTaskCapture.tsx`: a mic control using
  `MediaRecorder` (`audio/webm;codecs=opus`), with record / stop / re-record, a
  60 s cap with a visible countdown, and the transcript shown for review after
  interpretation. The transcript is display-only and is dropped when the
  composer closes (decision 8.4).
- Rendered at the top of the **existing** `TaskComposer`, gated on
  `hasPermission(access, "tasks.manage_team")`. No second composer, no second
  modal, no parallel create path.
- Applying a draft calls one `applyVoiceDraft(draft)` that drives the composer's
  current `useState` setters. When `voiceDraftGaps` is non-empty the composer
  raises a **popup alert** naming each missing field - "User not selected" when
  the note resolved to nobody (decision 8.1) - and on dismiss opens the first
  gap's `ChipSelector` panel. The same gaps also stay visible as an inline
  `Notice` so the warning survives the dismiss. `submitManual` is untouched, so
  a missing field still blocks Assign exactly as it does today.
- `TasksPage` gains one "Assign by voice" action next to Create Task that opens
  the same composer with the recorder expanded.
- Tokens only (the `task-*` semantic classes already in the composer); no new
  colours, no second design system.

### 3.4 Mobile - `apps/mobile` (phase 2, called out deliberately)

`apps/mobile` has **no task composer today**. `TasksScreen.tsx` is a read-only
feed; `packages/data/src/tasks/api.ts` already exports `createDelegationTask`
but nothing in the app calls it. So "voice assignment in the app" is really two
pieces of work, and the composer is the larger one.

Phase 2 therefore is: build the native composer against the shared
`packages/data` task API and the shared core helpers, then add `expo-audio`
recording plus `RECORD_AUDIO` in `app.json`, an Expo prebuild, and a release cut
with `scripts/release-mobile.ps1` per `docs/MOBILE_RELEASE_GUIDE.md`. Splitting
it this way keeps phase 1 shippable on web without an APK cycle.

## 4. Configuration and secrets

- `OPENAI_API_KEY` is set as a Supabase Edge Function secret in the dashboard
  (Edge Functions -> Secrets), never on a command line. It is never a `VITE_*` variable,
  never in source, never in git, never in terminal or chat output. Record the
  requirement in `PRODUCTION_SWITCH_PLAYBOOK.md`.
- Optional `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_EXTRACT_MODEL` overrides so the
  model can be changed without redeploying code.

## 5. Migration

One forward-only migration, `0162_voice_task_interpretation_limits.sql`: the
per-actor rate-limit table (RLS enabled, all grants revoked from
`public`/`anon`/`authenticated`, service_role only) and its `consume_*`
function, modelled on migration 0095. No new permission key, so the
`catalog.migration.test.ts` parity contract is unaffected. No change to any task
table, view, or existing RPC.

## 6. What is explicitly NOT changed

`create_manual_task_with_mode_with_audit`, `create_delegation_task_with_audit`,
`v_all_tasks`, `taskFeedCurrentOrOverdueFilter`, notification outbox and
triggers, recurring/To-Do generation, FMS, forms, the bulk-import flow's
behaviour, and `TaskComposer.submitManual`'s validation.

## 7. Validation (phase 1, run 2026-09-16)

Proven locally:

- `deno test worker.test.ts` - 13 passed; `deno check index.ts worker.ts` clean.
- `pnpm --filter @jewelos/core test` - 493 passed (18 new).
- `pnpm --filter web test` - 325 passed (6 new). The pre-existing 319 still pass,
  which is what proves the `identityMappings` extraction changed no behaviour.
- `turbo run typecheck` and `turbo run build` - 5/5 tasks each.
- Migration 0162 applied to the local database; its pgTAP file passes 9/9.
- Quota function exercised directly: 40 calls allowed then 5 refused in one
  window, an unknown profile rejected, and `authenticated` denied EXECUTE.
- `supabase db lint --local --level warning` - four warnings, all pre-existing,
  none in the new function.

Not proven, and needing a follow-up before release:

- No call has been made against the real OpenAI API. Transcription accuracy,
  extraction quality on Indian-English speech, and end-to-end latency are
  unmeasured. The gateway is covered only by injected fakes.
- `MediaRecorder` capture is untested in a real browser; the composer tests
  mock `VoiceTaskCapture`.
- `supabase db reset` did not finish - the local storage container reports
  unhealthy, which is an environment fault unrelated to this work. Migrations
  applied and the pgTAP suite ran against the resulting database.
- `supabase test db` reports three failing files that all fail without this
  change: `0006_restrict_function_execution` (its reviewed function inventory
  expects 323 postgres-owned functions and the database already held 354 before
  0162 added one), `0106_production_demo_data_retirement` (unclassified
  `task_import_identity_aliases`), and `0139_task_control_overview`. That
  inventory drift wants a deliberate review of the 31 unreviewed functions
  rather than bumping the constant, so it is left as-is and flagged here.

## 7a. Original validation plan

- `deno test` in the new function directory (worker logic, hint resolution,
  rejection of oversized/wrong-MIME input, 403 without `tasks.manage_team`).
- `pnpm --filter @jewelos/core test` - new `voiceTaskDraft.test.ts` plus the
  unchanged `identityMappings` tests proving the extraction is behaviour-neutral.
- `pnpm --filter web test` - composer prefill, the missing-user popup, and that
  Assign is still blocked when a gap remains after the popup is dismissed.
- `supabase db reset` + `supabase test db` + `supabase db lint --local` for the
  migration; exercise unauthenticated, inactive, ordinary-user, cross-tenant,
  and service-role paths against the rate-limit table.
- `turbo run typecheck` and `turbo run build`.
- Manual: `docs/REGRESSION_CHECKLIST.md` task rows, confirming a manually
  authored task is unchanged.
- A green typecheck/build proves none of the Postgres, RLS, edge-runtime, or
  rendered-UX behaviour. Report local and hosted evidence separately.

## 8. Decisions (settled 2026-09-16)

1. **A note that names neither a person nor a department is never guessed at.**
   No fallback to the author's own department. When the draft is applied the
   composer raises a popup alert naming the missing fields, with "User not
   selected" stated explicitly. The author dismisses it, fills the gaps, and
   assigns. `submitManual` continues to block the write independently, so the
   popup is the prompt and the existing guard is still the enforcement.
2. **Department auto-assign prefers the department head.** `departments.head_id`
   wins when that person is active and not recorded absent or half-day for the
   due date; otherwise the eligible member with the fewest open tasks for the
   due day, tie-broken by name. The resolution string shown in the composer says
   which rule fired, and the author can always override.
3. **Recording cap is 60 s**, client-side and re-checked server-side.
4. **The transcript is discarded** once the draft is accepted. It is shown in
   the composer while the author reviews, and is never written to the task, the
   audit row, or Storage.
