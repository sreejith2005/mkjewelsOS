# Ask Kiara implementation plan

**Goal:** a read-only organization assistant ("Ask Kiara") in JewelOS that answers from live app data
within the asker's access, from the SOP knowledge base with citations, and with app help, with human
escalation, insights, daily limits, voice, and Android parity.
**Spec:** `docs/superpowers/specs/2026-10-08-ask-kiara-design.md` (section numbers below refer to it).
**Branch / worktree:** `feat/ask-kiara` in `C:\kiara`, based on `origin/main` `fac01b6`.
**Tech:** Postgres/pgTAP, Supabase Edge Functions (Deno, `npm:@anthropic-ai/sdk`, `npm:mammoth`),
TypeScript/Vitest, React (web), React Native/Expo (Android).

## Global constraints

- AGENTS.md rules apply in full: the database is the authorization boundary; audited RPCs for every
  write; forward-only migrations; shared logic in `packages/core`; strict TypeScript; design tokens;
  private Storage; no fake data, no demo fallbacks.
- The answer path (`ask-kiara`, `kiara-knowledge-ingest`) never reads the service-role key. Every data
  read runs as the caller.
- Team questions use scoped RPCs (Dashboard, Task Control, Reports), never wider raw RLS reads (spec 3.2).
- Do not change behaviour of existing sections. The only existing code touched for behaviour is the
  voice transcription extraction (Phase 7), protected by its existing tests.
- No hosted action (migration apply, secret, deploy, `--linked`) until Phase 9, run with the owner
  present per `PRODUCTION_SWITCH_PLAYBOOK.md`.
- Other sessions share the main checkout and its local stack: run database work on an isolated local
  stack or this worktree's own `supabase start` with distinct ports; commit with
  `git commit -o -- <paths>`; never `git add -A`.

## Migration numbering

The next free number on `origin/main` was **0205** when this plan was written. Renumbered 2026-10-09:
main gained `0205_crm_master_sync_ignore_global_dropdowns` (PR #2), so this branch's unapplied
migrations became `0206_ask_kiara_foundation` and `0207_kiara_directory_lookup`. Renumbered again 2026-10-10:
main gained `0206_management_insights` and `0207_dashboard_saved_views` (applied on production), so
the Kiara migrations are `0208_ask_kiara_foundation`, `0209_kiara_directory_lookup`, and
`0210_ask_kiara_knowledge`; their manifest redefinitions keep main's `dashboard_saved_views`. Other branches also add migrations (for example
`C:\crm` carries a `0201` that differs from main's). Rule for this branch:
1. Before writing a migration, `git fetch origin` and take the next number after `origin/main`.
2. Before every push and before merge, rebase on `origin/main`. If main gained the same number,
   rename this branch's **unapplied** migration and its pgTAP file to the next free number (allowed:
   it has never been applied anywhere; forward-only applies to applied migrations), rerun
   `supabase.cmd db reset` and the full pgTAP suite.
3. Never renumber a migration that has been applied to any hosted project.

## Phasing rationale (changes from the proposed split)

The owner's nine phases are kept, with three adjustments:
- **Eval set grows from Phase 1.** Phase 9 runs the full per-role eval, but each phase adds its own
  cases (allowed/denied per role, injection) so a regression is caught where it is introduced.
- **Daily-limit enforcement ships in Phase 1** (seeded default 10), only the settings UI waits for
  Phase 6. Owner testing in Phase 1 must already be cost-bounded.
- **Launch dark from Phase 1.** The section is off for everyone except Super Admin until the owner
  switches it on (spec 15), so early phases can be deployed for owner testing without announcing.

---

## Phase 1: vertical slice

**Scope:** permissions and page, conversations/messages, quota, `ask-kiara` with two tools
(`get_my_work_summary`, `get_app_help`), streaming web chat, local tests.

Migration `0208_ask_kiara_foundation.sql` (originally 0205, then 0206):
- Permission catalog rows (`-- permission-catalog:begin/end`): all six `assistant.*` keys (spec 15)
  so later phases need no catalog change. Sort 310-315.
- `default_section_availability()` / `validated_section_availability()` with `ask_kiara`; launch-dark
  update of existing tenants with an audit row per tenant.
- Tables: `kiara_settings` (seed one row per tenant; trigger for new tenants), `kiara_user_limits`,
  `kiara_daily_usage`, `kiara_conversations`, `kiara_messages`, `kiara_question_facts`
  (spec 5.1-5.2), RLS, grants, column grant excluding `api_content`, restrictive
  `module_accessible('ask_kiara')` policies, indexes.
- RPCs: `start_kiara_turn`, `complete_kiara_turn`, `refund_kiara_question`,
  `list_my_kiara_conversations`, `get_my_kiara_conversation`, `archive_my_kiara_conversation`,
  `get_my_kiara_quota`.
- Retirement manifest: classify the new tables (redefine with the 0199 list plus Kiara tables).
- `notify pgrst, 'reload schema'`.

Files to create:
- `packages/core/src/assistant/index.ts`, `tools.ts` (definitions, strict schemas, permission map,
  data categories), `systemPrompt.ts`, `appHelp.ts`, `citations.ts`, `events.ts` (SSE event types and
  parser), `quota.ts`, and their `*.test.ts`.
- `supabase/functions/ask-kiara/index.ts` (HTTP, auth, wiring), `worker.ts` (turn loop with injected
  `AnthropicLike` and `ActorClient` interfaces), `tools/*.ts` executors, `worker.test.ts`,
  `deno.json` (`@anthropic-ai/sdk` pinned, `@supabase/supabase-js@2.112.1`, `@std/assert`), `deno.lock`.
- `packages/data/src/assistant/api.ts` (+ `index.ts`, `api.test.ts`): conversations, quota, SSE
  client (`fetch` + `ReadableStream`, JSON fallback).
- `apps/web/src/pages/AskKiaraPage.tsx`, `apps/web/src/features/assistant/` (chat view, message
  renderer with the restricted markdown subset, quota chip, conversation list, tests).
- `supabase/tests/0208_ask_kiara_foundation.test.sql`.
- `docs/superpowers/evals/ask-kiara/` with `cases.json` (role, question, expected tools allowed,
  forbidden tools, must-refuse flag) and `README.md` (how to run against a local stack).

Files to modify:
- `packages/core/src/roleMenu.ts` (+ `roleMenu.test.ts`), `packages/core/src/permissions/catalog.ts`
  (+ `permissions.test.ts`; category "Assistant"), `packages/core/src/index.ts` exports,
  `packages/core/src/database.types.ts` (regenerate).
- `apps/web/src/App.tsx` (lazy page + route), permission-management category label (web).
- `apps/mobile/src/navigation/shellModel.ts`: the native launcher builds from core
  (`buildLauncherItems`, shellModel.ts:159), so a new implemented page would appear natively and open
  `SectionScreen`'s "not an implemented JewelOS web route" fallback
  (`apps/mobile/src/screens/SectionScreen.tsx:36-44`). Add a native-pending list
  (`NATIVE_PENDING_PAGES = ["ask_kiara"]`) filtered out of the launcher and menus, with
  `shellModel.test.ts` cases; Phase 8 removes it.
- `apps/mobile/src/navigation/AppTabs.tsx` icon map entry (line 54) so the type stays exhaustive.

Android release note: these are mobile-consumed changes, so AGENTS.md's standing release instruction
applies when they reach `main`. Decided 2026-10-08 (spec 19 item 16): phases 1-7 stay on
`feat/ask-kiara`, rebased on `origin/main` at every phase, and the first APK containing Kiara ships in
Phase 8. If any phase merges to `main` earlier, that merge is followed by the routine release per
`docs/MOBILE_RELEASE_GUIDE.md`.

Tests:
- pgTAP: catalog rows and defaults; section key accepted by `validated_section_availability`; launch
  dark (staff denied, Super Admin allowed while off; both allowed when on); `start_kiara_turn` for
  unauthenticated, inactive, cross-tenant conversation, other user's conversation, missing
  `assistant.view` (individual deny), section disabled; quota: 10 allowed, 11th rejected, Super Admin
  unlimited, per-user exception, idempotent `request_id`, refund rules, day boundary in tenant
  timezone; `complete_kiara_turn` only by the owner and only once; audit rows have no text; RLS:
  messages readable only by the owner, `api_content` not selectable; service role cannot bypass
  ownership checks in user RPCs.
- Vitest core: tool offering per permission set (staff/manager/super admin fixtures), app-help covers
  every implemented page, citation marker validation, quota day computation, prompt has no volatile
  content (snapshot), catalog parity.
- Deno: `worker.test.ts` with fakes: tool not offered without permission; 42501 becomes
  `access: denied`; loop caps; refusal handling; SSE ordering (`meta` first, `done` last); refund on
  provider error before text; history replayed unchanged (append-only check); untrusted-text wrapping.
- Vitest web/data: SSE parser, renderer strips images/HTML/external links, quota chip.

Validation (from AGENTS.md):
```powershell
supabase.cmd start
supabase.cmd db reset
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
deno test --allow-env supabase/functions/ask-kiara/worker.test.ts
deno check supabase/functions/ask-kiara/index.ts
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```
Plus a local end-to-end check with `supabase.cmd functions serve ask-kiara` and a local
`ANTHROPIC_API_KEY` in an untracked env file (never committed), signing in as synthetic seed users of
each role.

Exit criteria:
- A staff, a manager, and a Super Admin seed user each ask "what is pending for me today" and get
  answers matching their Home screen, in English and in Hindi in English letters.
- A staff user asking for branch metrics is told they do not have access.
- The 11th question of the day is refused with the reset time; Super Admin is not limited.
- SSE streaming verified in the browser; JSON fallback verified with curl.
- Prompt-cache reads observed in `usage` on the second question with the same permission shape.
- All gates above green; evidence recorded in the PR description, local vs hosted kept separate.

## Phase 2: internal data tools

**Scope:** `search_my_tasks`, `get_dashboard_metrics`, `get_team_progress`, `list_reports`/
`run_report`, `find_people`, `get_availability`, `get_leave`, `get_fms_work`, `search_forms`,
`get_my_notifications` (spec 8), and `kiara_directory_lookup` (spec 19 item 8, approved 2026-10-08).

Migration (approved, spec 19 item 8): `0209_kiara_directory_lookup.sql` with
`kiara_directory_lookup(p_name text, p_limit int)` (active colleagues in tenant; name, designation,
department, branch; no contact data; `assert_module_access('ask_kiara')`; pgTAP).

Files: `supabase/functions/ask-kiara/tools/{tasks,dashboard,progress,reports,people,availability,
leave,fms,forms,notifications}.ts` and tests; `packages/core/src/assistant/tools.ts` entries;
`appHelp.ts` additions; eval cases.

Tests:
- Deno executor tests with recorded RPC response shapes (from the generated types), trimming and
  sensitive-field removal (personal mobile/email never present), caps and `truncated`.
- Local integration script (`supabase/functions/ask-kiara/integration.test.ts`, runs only when
  `KIARA_LOCAL_STACK=1`): signs in as seed staff, manager (two branches), hr, admin, super admin, and
  a staff user with a dashboard-authority override; calls each executor directly as that user; asserts
  row sets equal the corresponding section RPC results and that a manager never receives another
  branch's rows through Kiara.
- Eval: per role, allowed and denied questions for every tool.

Validation: Phase 1 list plus the integration script against the local stack.

Exit criteria: every tool returns exactly what the matching section shows for each role; denials are
correct for staff; manager branch/reports-to scopes hold; no raw wide RLS read is used for team
questions (code review checklist item).

## Phase 3: knowledge base

**Scope:** spec 5.3 and 10, `search_knowledge_base` tool, Super Admin KB UI. Ask the owner how and
when the real SOP files will be supplied (memory note); never commit them.

First task (gate): run `npm:mammoth@1.8.0` inside `supabase.cmd functions serve` with the largest
real SOP, measure CPU/memory/time. If it exceeds edge-runtime limits, stop and bring options to the
owner (smaller files, split documents, or browser-side extraction re-validated server-side).

Migration `0210_ask_kiara_knowledge.sql`: documents, versions, chunks (generated `tsvector`, GIN),
bucket `kiara-knowledge` with MIME/size limits and path policies, all KB RPCs, `search_kiara_knowledge`,
`assistant` realtime topic (constraint + `emit_tenant_realtime_event` replace), manifest
classification.

Files:
- `supabase/functions/kiara-knowledge-ingest/{index.ts,worker.ts,worker.test.ts,deno.json,deno.lock}`.
- `packages/core/src/assistant/chunking.ts` (+ tests with synthetic HTML fixtures).
- `supabase/functions/ask-kiara/tools/knowledge.ts` (+ tests).
- `packages/data/src/assistant/knowledge.ts` (+ tests); `apps/web/src/features/assistant/knowledge/*`.
- Synthetic test fixtures generated at test time (no real SOP content in Git).

Tests:
- pgTAP: only `assistant.manage_knowledge` holders create/replace/edit/status/delete; ordinary users
  cannot select documents or chunks directly; `search_kiara_knowledge` returns only active documents'
  active versions; replace keeps the old version live until extraction succeeds; delete tombstones and
  removes chunks; storage insert denied for wrong path, wrong MIME, oversize, non-manager; cross-tenant
  denied; audit rows.
- Deno: ZIP bomb guard, SHA mismatch, non-docx bytes, extraction failure path, chunk limits.
- Vitest: chunking (headings, tables, no-heading fallback, long sections), citation chips.
- Eval: Hindi, Hinglish, Hindi-in-Latin questions retrieve English SOP sections; unanswerable policy
  question does not invent an answer.

Exit criteria: owner uploads two real SOPs locally, asks 10 questions in four language styles, every
policy answer has a valid citation, an unknown policy is not invented.

**Phase 3 status (2026-10-10, local only).** Gate passed on the local edge runtime (the limits mirror
hosted: 256 MB, 1 s CPU soft / 2 s hard): no hard-limit hit; the most text-heavy SOP sometimes passes
the soft limit (the worker is recycled after answering). Built as planned, with these owner decisions
and deviations:
- Per-document `audience` (`everyone` | `managers_and_above` = effective role manager, admin, or super
  admin) enforced in `search_kiara_knowledge` and `get_kiara_knowledge_excerpt`.
- One splitter (`packages/core/src/assistant/chunking.ts`) for uploads, edits, and typed articles,
  instead of a second SQL splitter; the RPCs verify every chunk is a verbatim slice of the stored text.
  Small sections under one top-level heading are packed (up to 1,200 characters); documents without
  heading styles use bold lines, then inferred title lines, then fixed size.
- `search_kiara_knowledge(p_query, p_original_terms, p_limit)`: OR-ranked English query plus a
  `simple` query over the original words (Devanagari); document titles weigh in ranking.
- Extra RPCs: `get_kiara_version_for_ingest`, `update_kiara_document_details_with_audit`,
  `get_kiara_knowledge_excerpt` (citation drawer); `save_kiara_document_text_with_audit` also creates
  typed articles (`p_document_id` null).
- Duplicate uploads are refused by SHA-256 (`kiara_duplicate_document`); mammoth skips images.
- Real-SOP evaluation questions are kept in the git-ignored `docs/superpowers/evals/ask-kiara/private/`.

## Phase 4: human step-in

**Scope:** spec 5.4, 5.6, escalation RPCs, `offer_escalation` tool, "Questions for you" tab, nav
badge (web), notifications, save-to-KB as "suggested".

Migration `02xx_ask_kiara_escalations.sql`: `kiara_escalations`, `kiara_escalation_answerer`,
`kiara_can_answer_escalation`, RPCs, derived-close trigger on notifications, realtime trigger,
manifest classification.

Files: `supabase/functions/ask-kiara/tools/escalation.ts`; `packages/core/src/assistant/escalation.ts`
(offer validation); `packages/data/src/assistant/escalations.ts`; web tab, badge in
`ApplicationShell.tsx` and `MobileNavigationDrawer.tsx`, notification destination mapping; tests.

Tests:
- pgTAP: recipients rule for reports-to ancestor (two levels), department head, branch manager,
  admin, super admin; a same-branch manager outside the chain cannot see or answer; staff cannot see;
  answerer without `assistant.answer_escalations` cannot see; asker cannot answer own; first answer
  wins under concurrency (two sessions, `for update`); answer appends a `human_answer` message and a
  notification to the asker; answerers' notifications marked read by the trigger (not by the client);
  withdraw; save-to-KB creates `suggested` only; badge counts; cross-tenant; audit rows without text.
- Vitest/Deno: offer only for valid reasons; never offered for access denials (eval).
- Web: badge refresh through the realtime topic; notification opens the escalation.

Exit criteria: end-to-end locally: staff asks an unanswerable policy question, confirms, their manager
sees the badge, answers, staff sees the answer in the conversation and a notification; history is
preserved (`is_read`, `read_at`).

## Phase 5: CRM tools

**Scope:** `crm_search_clients`, `crm_walkins`, `crm_followups` via `crm-session-exchange`.
Coordinate with CRM work (`C:\crm` and CRM-project owners) before relying on CRM RPC shapes; no CRM
schema change unless the owner approves a new read RPC for aggregates.

Files: `supabase/functions/ask-kiara/tools/crm.ts` (exchange client, per-request token, CRM queries),
tests; `packages/core/src/assistant/tools.ts` entries; eval cases.

Tests:
- Deno with fakes: exchange 403 becomes `access: denied`; token never logged, stored, or returned;
  phone numbers masked to the last 4 digits; caps.
- Local integration (optional, needs both local stacks): a user without `crm.view` is refused; a CRM
  user gets company-wide read; revoked grant refused on the next question.

Exit criteria: CRM answers match what `/crm` shows the same user; non-CRM users are refused.

## Phase 6: insights and limit settings

**Scope:** spec 5.5, 13; `kiara-insights` worker and cron; Insights tab; Limits tab with settings
and per-user exceptions; retention purge job.

Migration `02xx_ask_kiara_insights.sql`: `kiara_employee_insights`, service-role RPCs,
`get_kiara_insights`, settings/limit RPCs, `list_kiara_usage`, `purge_kiara_conversations`, pg_cron
schedules using the vault pattern of 0007 (the cron job is created only when the vault secret exists,
fail closed), manifest classification.

Files: `supabase/functions/kiara-insights/{index.ts,worker.ts,worker.test.ts,deno.json,deno.lock}`;
`supabase/config.toml` (`[functions.kiara-insights] verify_jwt = false` with the explanatory comment
style used for other cron workers); `packages/core/src/assistant/insights.ts` (+ tests);
web Insights and Limits tabs; data API.

Tests:
- pgTAP: insights visible to admin/super admin tenant-wide, manager only for reports-to descendants,
  never the caller's own row, staff denied; settings/limits only Super Admin (protected key, cannot be
  granted to admin); limit changes take effect on the next question; purge removes old messages and
  keeps facts; service-role RPCs reject authenticated callers.
- Deno: `x-cron-secret` checked before body parsing; skips employees without new questions; structured
  output validation; batch item failure retried next run.
- Vitest: rating formula (minimum activity, thresholds, rounding, clamping), classification bands.

Exit criteria: on synthetic seed questions, ratings and classes match hand-computed values; manager
views only their tree; the employee cannot see their own row anywhere.

## Phase 7: voice input

**Scope:** shared transcription module; `/ask-kiara/transcribe`; `consume_my_voice_quota`; web mic
button gated by `assistant.voice`.

Migration `02xx_ask_kiara_voice.sql`: `consume_my_voice_quota()` (authenticated, `assistant.voice`,
same table as 0162); pgTAP.

Files:
- Create `supabase/functions/_shared/voice/transcribe.ts` (+ test): the whisper call, MIME/size
  checks, no-speech guard, moved from `interpret-task-voice/index.ts:184-223` and `worker.ts`
  (`assertVoiceUpload`, `VOICE_NOTE_*`), with `language` as a parameter.
- Modify `supabase/functions/interpret-task-voice/index.ts` to import it with `language` defaulting
  to the current `OPENAI_TRANSCRIBE_LANGUAGE`/`"en"` behaviour (no behaviour change).
- `supabase/functions/ask-kiara/transcribe.ts`; web capture reuse from
  `apps/web/src/features/tasks/` voice capture (extract a shared recorder hook if needed, no
  behaviour change for Tasks).

Tests: existing `interpret-task-voice/worker.test.ts` passes unchanged; new shared-module tests;
`assistant.voice` allowed/denied (role default, individual grant/deny, HR denied by default); quota
shared with Tasks; transcript not auto-sent; Tasks voice regression in `docs/REGRESSION_CHECKLIST.md`.

Exit criteria: Hindi, Hinglish, and English voice questions transcribe acceptably on desktop Chrome
and Android Chrome; Tasks voice assignment behaves exactly as before.

## Phase 8: Android parity and release

Read `docs/MOBILE_RELEASE_GUIDE.md`, `apps/mobile/README.md`, `docs/MOBILE_PARITY_PLAYBOOK.md`,
`docs/MOBILE_HANDOFF.md` first.

Scope: native Ask Kiara screen in the Section stack (chat, quota chip, citations, "Ask a person",
Questions for you with badge, read-only Insights; KB and Limits admin stay web-only unless the owner
asks); streaming with `expo/fetch`, falling back to the JSON contract if streaming is unreliable on
device; voice with `expo-audio` reusing the Tasks capture; `incomingPath.ts` mapping for
`/ask-kiara`; realtime `assistant` topic refresh.

Files: `apps/mobile/src/features/assistant/*`, `apps/mobile/src/navigation/{AppTabs.tsx,
incomingPath.ts,shellModel.ts}` and tests; shared code stays in `packages/core`/`packages/data`.

Tests: native unit tests for navigation and SSE/JSON parsing; device checks at phone width for every
role fixture; notification deep links from a cold start.

Release: per the standing instruction in AGENTS.md, after gates pass, publish with
`scripts\release-mobile.ps1` only (never hand-rolled, never `-Mandatory` without explicit owner
approval), push the release commit, verify `latest.json` and the APK asset. Because the section
launches dark, the release can precede the announcement.

Exit criteria: parity matrix entries for Ask Kiara pass on a physical Android phone; release verified.

## Phase 9: hardening and hosted deploy

- Full eval run per role (staff denied, manager scoped, owner full), language styles, injection cases
  (instructions planted in a synthetic task description, CRM note, form name, and SOP paragraph must
  not change behaviour or trigger extra tool calls), citation validity, escalation offers.
- Effort tuning (`low` vs `medium`) on the eval set; keep `low` unless quality gains are measured.
- Cost check from the audit rows' token counts against spec 18; adjust caps if needed.
- Security review of the branch (`/security-review`), RLS review of every new table, storage policy
  review.
- `docs/REGRESSION_CHECKLIST.md` additions (Ask Kiara, Tasks voice, notifications, permissions).
- Hosted deploy with the owner present, following `PRODUCTION_SWITCH_PLAYBOOK.md`: confirm linked
  project ref, dry run, apply migrations in order, set secrets (`ANTHROPIC_API_KEY`,
  `KIARA_INSIGHTS_CRON_SECRET`, CRM public URL/anon key) without echoing values, deploy named
  functions only (`ask-kiara`, `kiara-knowledge-ingest`, `kiara-insights`, and `interpret-task-voice`
  for the shared module), create the vault secret and cron, hosted smoke test per role with the
  section still dark, release record with SHA and rollback plan (switch the section off in Developer
  Mode; functions can be undeployed; migrations stay).
- Owner tests, then switches the section on for everyone.

Exit criteria: eval pass rates agreed with the owner; hosted smoke evidence recorded separately from
local evidence; owner sign-off before enabling.

## Review checklist (every phase)

- No service-role client in the answer path; no data read outside a caller-scoped contract.
- Every new RPC: active-profile, tenant, permission, section checks, audit in the same transaction,
  allowed and denied pgTAP cases (unauthenticated, inactive, cross-tenant, cross-branch, ordinary,
  privileged, service role).
- No question text or data payloads in `audit_logs` or function logs.
- Generated types regenerated when the schema changes.
- Web change checked for native parity (AGENTS.md) before any APK release.
