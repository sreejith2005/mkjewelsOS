# FMS assistant: AI debugger and AI workflow builder

**Update 2026-10-28 (owner request): one assistant, one chat.** The Check /
Ask / Build / Run tabs, the **Build with AI** start choice and the **Ask AI**
button on workflow cards are gone. Inside the builder, **AI assistant** opens a
single chat that builds, changes, checks, fixes or explains the workflow; the
model decides from the message (`FMS_AI_ASSISTANT_PROMPT`). The request `mode`
now only says whether edits may be proposed (`build`, needs `builder_enabled`)
or not (`debug`). Administrators get one switch (**Turn on the AI assistant**),
which sets `debugger_enabled` and `builder_enabled` together and
`run_diagnosis_enabled` off; the run-snapshot RPC stays in the database unused.
No migration. The sections below describe the original 2026-10-23 design.

Production bug fixed at the same time: every request failed with "The FMS
assistant is unavailable right now" because the reply schema was sent as
structured output (`output_config.format`) and has more than the API's limit
of 16 union-typed (nullable) fields, so Claude's API rejected it ("Schema is
too complex"). The schema is now in the system prompt, the reply is parsed and
repaired by the existing contract code, and `fms_ai_turn_failed` logs a
`detail` (provider status and error type only) for future diagnosis.

Status (2026-10-23): implemented on branch `feat/fms-ai-builder-debugger`, not
deployed. Migration `0344_fms_ai_assistant.sql`, Edge Function `fms-ai`. Ships
dark: every capability is off until an administrator switches it on.

## What it is

Two features inside the existing FMS Builder, sharing one server function:

| Capability | Switch | What the author gets |
| --- | --- | --- |
| Check (no AI) | always, once the panel is visible | The app's own validator findings plus extra static rules, with evidence, **Go to step**, and a **What happens if…** route preview for the selected step. |
| Debug workflows | `debugger_enabled` | Questions about the current (unsaved) draft or a published version; grounded answers with evidence labelled From the workflow / Simulated / Observed / Not enough evidence; suggested fixes as reviewable edits. |
| Build with AI | `builder_enabled` | Describe → clarify → review → **Apply to editor** of a native `FmsFlowDefinition` draft. |
| Diagnose runs | `run_diagnosis_enabled` | A bounded, redacted record of one live run, analysed without AI; sent to AI only after the author ticks **Include this run's records**. |

The assistant never saves, publishes, revises, assigns, completes, notifies or
retries anything. The author applies a reviewed proposal to the editor with one
`commit()` (one Undo step) and then uses the normal **Save draft** / **Publish**
(`save_fms_flow_draft_with_audit`, `publish_fms_flow_with_audit`). Fixes for a
published version go through **Create a new version** (`create_fms_revision_with_audit`).

## Architecture

```text
Browser (FMS Builder)                         Edge Function fms-ai (caller JWT)            Postgres (RLS + RPC checks)
  FmsAiPanel ── draft + fingerprint ──────▶   auth.getUser → access context + section ─▶ get_my_access_context / get_section_availability
            │                                 start_fms_ai_request (switch + quota) ─────▶ fms_ai_requests (metrics only)
            │                                 bounded catalog reads as the caller ───────▶ form_templates/form_fields/user_profiles/...
            │                                 diagnoseFmsDefinition (core)                 get_fms_run_diagnostic_snapshot (opt-in)
            │                                 Claude (structured JSON output)
            │                                 parse → applyFmsAiOperations (core) → validate
            ◀── proposal (ops + fingerprint) ─ finish_fms_ai_request (token metrics)
  recompile ops locally with the same core code and seed; compare fingerprints;
  refuse if the draft changed; Apply = one commit(); Save/Publish unchanged.
```

Key choices:

- **One contract, one compiler.** The model returns typed edit operations
  (`packages/core/src/fms/aiContract.ts`), never a definition, SQL or code.
  `applyFmsAiOperations` (`aiOperations.ts`) compiles them onto the current
  draft, all-or-nothing, with the same stage factory the manual builder uses
  (`fmsStageTemplate`). The server compiles to validate; the browser compiles
  again before applying and requires the same fingerprint (route ids come from
  `fmsAiIdFactory(requestId)`, so both sides are byte-identical).
- **No guessing.** Employees must be exact active ids from the caller's
  directory; Forms must be published ids the caller can read; questions and
  options must exist (a display label is mapped to its stored value only when
  unambiguous, and the mapping is shown as an assumption). Everything else is
  rejected and sent back to the model once for repair; a second failure is
  shown to the author with nothing changed.
- **Deterministic findings are authoritative.** `diagnoseFmsDefinition`
  (`diagnostics.ts`) reports every `validateFmsDefinition` issue unchanged as an
  error and adds warnings/suggestions with evidence. The model explains them and
  may not contradict them. `explainFmsRoute` uses the engine's `resolveFmsBranch`.
- **Run diagnosis reuses existing authorization.** `get_fms_run_diagnostic_snapshot`
  requires `fms.manage`, the FMS section, the run-diagnosis switch, and
  `can_read_fms_instance` (so `fms.manage` does not widen run visibility). It is
  bounded (200 steps, 200 log entries, 100 decisions/answers) and states what it
  truncated, redacted and cannot know.
- **Failure evidence that did not exist before.** A failed work transition rolls
  back, so nothing recorded it. After such a failure the browser calls
  `record_fms_diagnostic_event` (operation, step, SQLSTATE, correlation id; the
  database derives the run/flow ids itself). It is a separate best-effort call
  that cannot retry or alter the failed work, is rate limited (30/hour/user),
  and is purged after 30 days. Older failures are reported as unknown.
- **Isolated from Ask Kiara.** Own function, prompts, quotas (`fms_ai_requests`)
  and switches. Kiara's tools are unchanged; Kiara only describes the screens
  (`appHelp.ts`).

## Files

| Area | Path |
| --- | --- |
| Core contract, compiler, diagnostics, run analysis, prompts | `packages/core/src/fms/{aiContract,aiOperations,aiContext,diagnostics,definitionDiff,runDiagnosis,stageTemplate}.ts` (+ tests) |
| Database | `supabase/migrations/0344_fms_ai_assistant.sql`, `supabase/tests/0344_fms_ai_assistant.test.sql` |
| Edge Function | `supabase/functions/fms-ai/{index,handler,model,catalog}.ts`, `handler.test.ts` |
| Web | `apps/web/src/features/fms/ai/*`, `FmsFlowBuilder.tsx` (optional `ai` prop), `pages/FMSBuilderPage.tsx` |
| Failure events | `packages/data/src/fms/work.ts` (`reportFmsWorkFailure`) |

## Configuration (Edge Function secrets / env)

| Name | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (already set for Ask Kiara) | Without it the function answers 503; manual editing is unaffected. |
| `FMS_AI_MODEL` | `claude-opus-5-5` | Owner choice; `claude-sonnet-5-5` is cheaper. Requests use adaptive thinking, structured JSON output and the server-side refusal fallback (`fallbacks: "default"`). |
| `FMS_AI_EFFORT` | `medium` | `low` / `medium` / `high`. |
| `FMS_AI_TIMEOUT_MS` | `100000` | Per model call (10 000–130 000); total budget 140 s including one repair. |
| `FMS_AI_DISABLED` | unset | `true` is a global kill switch (503, no database or model call). |

Model availability and cost were **not** measured: no live model call was made
during implementation. Measure on the first hosted calls (the response shows
model and token counts; `fms_ai_requests` keeps per-request totals).

## Threat model

| Threat | Control |
| --- | --- |
| Unauthenticated / forged / expired token | `auth.getUser` before any read; 401 without database or model calls (Deno test). |
| Author without `fms.manage`, FMS section disabled, inactive account | Checked in the function and again in every RPC (`has_permission`, `assert_module_enabled`, `current_profile_is_active`); pgTAP and Deno tests. |
| Client-supplied tenant, role or permission | Request schema rejects unknown fields; tenant comes from `current_profile()` only. |
| Cross-tenant ids (employee, Form, run) | Catalog is read as the caller under RLS; ids outside it are rejected; the snapshot RPC checks tenant + `can_read_fms_instance`. |
| Prompt injection in Form/step/employee names or chat | User text travels only inside a JSON data block that the system prompt declares to be data; output is schema-validated; operations are compiled against the catalog; nothing is executed or rendered as HTML. |
| Malformed / oversized / truncated model output | Strict parser with length and count limits; one bounded repair; then a clear error and no change. Request body ≤ 300 KB. |
| Silent overwrite of the author's edits | Base fingerprint check before Apply; Apply disabled on conflict. |
| AI mutating live data | The function has no write path except its own metrics rows; published versions are read-only; applying needs an explicit click, then the normal audited Save/Publish. |
| Cost abuse | Per-user and per-tenant daily request limits (serialized with an advisory lock), duplicate request ids refused, token metrics recorded. Token totals are client-reported by the function as the caller (soft metric; the request count is the hard limit). |
| Personal data to the provider | No phone, email, remarks, files, checklist answers or form answers except the questions that decide a route or assignment, and only after explicit consent for runs. Employee names and roles are sent for assignment; review the provider's data-retention terms before enabling. |
| Diagnostic events as a covert channel | Fixed operation list, SQLSTATE format check, server-derived ids, rate limit, 30-day retention, no direct table access. |

## Known limits

- Proposed Forms are created as drafts only; the author must publish them in
  Forms and then link them (ask the assistant, or link in the step).
- The browser holds the conversation; nothing is stored, so a reload starts a
  new conversation.
- Failed attempts before 0344, or on devices that could not report them, are
  not visible; the assistant says so.
- Runtime eligibility (leave coverage, recipient scope at handoff) is decided by
  the server at the time of work; previews and simulations say this.
- `supabase/tests/0006_restrict_function_execution.test.sql` was already failing
  on `main` (stale function counts) before this change; 0344 adds six
  authenticated SECURITY DEFINER functions, covered by `0344_fms_ai_assistant.test.sql`.

## Production rollout (owner approval gates)

Follow `PRODUCTION_SWITCH_PLAYBOOK.md`. Nothing below has been run.

1. Review and merge approval of the PR (CI green). Do not merge before step 4.
2. Confirm the migration number against production `schema_migrations` and
   `origin/main` (renumber if 0344 is taken).
3. Owner runs the gated migration script for `0344_fms_ai_assistant.sql`; verify
   read-only: the three tables exist with RLS on, six functions granted to
   `authenticated` only, `fms_ai_settings` empty (all switches off).
4. Owner deploys the function: `supabase.cmd functions deploy fms-ai` (JWT
   verification on). Optional secrets `FMS_AI_MODEL` / `FMS_AI_EFFORT`.
   Verify: OPTIONS 200, POST without a token 401.
5. Merge to `main`; confirm the Vercel deployment. With all switches off the
   FMS screens are unchanged.
6. Owner production test: FMS -> **Assistant** -> switch on **Debug workflows**
   only; run the regression checklist section "FMS assistant"; then **Build
   with AI**; then **Diagnose runs**. Watch `fms_ai_requests` totals for cost.
7. Rollback: switch capabilities off in **Assistant**, or set
   `FMS_AI_DISABLED=true`; the migration is additive and can stay.
