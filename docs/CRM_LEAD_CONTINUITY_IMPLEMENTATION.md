# CRM lead continuity implementation — 2026-10-08

Initially implemented locally in the required `C:/crm` worktree (`feat/crm-native`). The owner subsequently authorized deployment and publication; the integrated release and hosted outcome are recorded in [the release record](CRM_LEAD_CONTINUITY_RELEASE_2026-10-08.md). The original worktree contained substantial unrelated CRM changes; they were preserved. No historical customer repair or APK release was performed.

## Behavior

- Audited lead registration links the lead to its client identity and fills missing profile values, including DOB, anniversary, address and preferences. Original answers remain saved, including unmapped answers. Existing profile values are preserved; conflicting contributions retain their source evidence. Invalid historical dates/phone values do not prevent other valid contributions.
- All walk-in phone lookup paths use the full profile and shared autofill mapping, retaining country-coded identity and guarding against stale responses.
- Client Database uses one server query and one row per identity, with filters applied before counts/pagination. It supports lead/client type, lifecycle, branch, city/state, source, potential, purchase outcome, visit counts, registration/contact date ranges and ordering. Default order is latest actual interaction across leads and clients, with stable ties. Store-only visit sources are included.
- Profiles show durable activity from lead registration/calls/stages, walk-ins, queue registration, follow-ups, referral history, engagement asks, contacts and profile edits, with source details and actors. Actual contact updates the latest interaction; future schedules and administrative edits/conversions do not. Repeated explicit follow-up outcomes remain individual history entries.
- Staff can record calls, messages, thank-you contacts and notes through an audited, branch-authorized RPC with retry protection. Recording a message documents contact; it does not send a message. Contacts do not inflate visit counts.
- Configurable lead, walk-in and profile choices use JewelOS Dropdown Master through the existing outbox/receiver transport. Sugar uses that source. Server validation rejects invalid new choices, retains unchanged historical choices and preserves conditional routes when master labels change. Missing sync reports an actionable error rather than fabricating options.

## Change scope and contracts

CRM migrations `20261008000600_crm_lead_continuity.sql` and `20261008000700_crm_jewelos_master_options.sql` add protected lead/profile contribution evidence, audited lead/contact/recovery RPCs, invoker activity/browse views and RPCs, private tenant-scoped master snapshots, master read/route RPCs and validation triggers. Public contacts have RLS and no direct mutation grants; private projection tables have RLS and no client policies/grants. Master application is service-only. Lead direct INSERT is revoked; existing protected post-call creation remains compatible. Existing branch authorization and audit contracts are retained.

JewelOS migration `0204_crm_dropdown_master_sync.sql` extends the existing sync outbox for scoped master events, coalescing/retry behavior, change triggers and missing CRM master lists. Sender/receiver workers and focused tests support master events separately from staff events. No new secret is required.

UI changes cover the lead form, all walk-in lookup paths, lead/visit/profile loaders, Client Database and profile history. New shared CRM helpers are `client-browse.ts` and `crm-port/master-options.ts`; new history UI is `client-activity.tsx`. CRM public generated database types and generated CSS are updated. Relevant UI/pgTAP fixtures were adapted to the protected RPC and master contracts. No Storage bucket/path/grant changes were made; existing private document/media flows are retained.

No native source or mobile-consumed shared contract was changed by this task. Native CRM uses the same hosted `/crm` WebView. Browser/embedded rendering and physical-device parity remain unproven; source inspection alone is not runtime evidence.

## Local validation

| Command/check | Result |
| --- | --- |
| `pnpm.cmd --filter @jewelos/crm-ui test` | 151 tests, 36 files passed; generated CSS check passed |
| `pnpm.cmd --filter web test` | 380 tests, 80 files passed |
| `pnpm.cmd --filter @jewelos/core test` | 768 tests, 59 files passed |
| `pnpm.cmd exec turbo run typecheck --force --concurrency=1` | All six workspace checks passed |
| `pnpm.cmd --filter web build` | Passed; existing bundle-size warning remains |
| `deno test --config supabase/functions/crm-staff-sync/deno.json supabase/functions/crm-staff-sync/worker.test.ts supabase-crm/supabase/functions/sync-receive/worker.test.ts` | 19 tests passed |
| `deno check --config supabase/functions/crm-staff-sync/deno.json supabase/functions/crm-staff-sync/index.ts` | Passed |
| `deno check --config supabase-crm/supabase/functions/sync-receive/deno.json supabase-crm/supabase/functions/sync-receive/index.ts` | Passed |
| `git diff --check` | Passed |

Final migration files were applied transactionally to fresh, isolated schema-only copies of the existing local databases: CRM `crm_lead_verified` in `supabase_db_crm-workflow-perf`, and JewelOS `jewelos_lead_verified` in `supabase_db_jewelos`. Maintained static setup and synthetic pgTAP fixtures were used. No production/customer data was copied and no shared database was reset.

SQL commands used `docker exec <container> psql -U supabase_admin -d <isolated_database> -v ON_ERROR_STOP=1 -1 -f <migration>` for application and `-At -v ON_ERROR_STOP=1 -f <test>` for pgTAP. TAP output was inspected for failures and errors, because a failed assertion alone does not produce a nonzero psql exit status.

New tests: lead continuity **61/61**, CRM masters **23/23**, JewelOS sync **12/12**, including anonymous/inactive/cross-branch denial, direct-write denial, ordinary/admin/service behavior, idempotency, conditional master routing, stale snapshot membership and conservative recovery. All other current CRM database test files passed. The legacy `20261006_crm_sheet_sync.test.sql` retains **19 assertion failures**, reproduced with the same descriptions on an isolated pre-change baseline. The maintained one-way Sheet suite passes. The full database suite is therefore not entirely green. Stale phone-format expectations in existing tests were corrected to the persisted E.164 contract.

Final review found no unresolved Important finding. Rendered browser checks were unavailable because this session had no callable browser automation runtime. The native bridge test could not start because the separate mobile dependency tree lacks Vitest; no dependencies were installed or native runtime claim made. No hosted RLS/RPC, deployed sync, browser, or physical-phone validation was performed.

## Release and historical recovery gates

1. Review the named changes and required earlier dirty migrations; do not publish the entire dirty worktree. Confirm the actual Git root and follow `PRODUCTION_SWITCH_PLAYBOOK.md` and the two-project runbook. Check each project's linked migration ledger and `db push --linked --dry-run` separately. These migrations require the existing current CRM baseline through `20261008000200` and the JewelOS staff-sync contracts; never assume those local dependencies are hosted.
2. Deploy master-capable receiver/sender code in a compatible order and apply JewelOS `0201`. Apply CRM `003`/`004` during a controlled bootstrap window, deliver master snapshots, and verify tenant memberships/options before exposing forms or deploying the new web UI. `004` changes existing queue option loading immediately; incomplete bootstrap can block existing form opening. Retain existing staff sync and verify leased/retried events survive rollout.
3. Run authenticated synthetic desktop, responsive and embedded/native flows end to end: lead → same-phone walk-in → filtered database → profile history; thank-you contact and repeated follow-up; Sugar and renamed/deactivated master choices; branch/permission denials; existing documents, follow-ups, task handoff and walk-ins. Inspect persisted records and audit entries. Physical-phone checks remain required for runtime parity.
4. Historical recovery is explicit and conservative: first call `reconcile_crm_lead_profiles(false)` as an active CRM super admin and inspect aggregate counts. Apply only after reviewing conflicts and original evidence. The implementation fills missing values and records provenance; it cannot reconstruct interactions never recorded. No historical recovery has been run against customer data.

The implementation is locally validated, not declared production-ready. The baseline Sheet failures and outstanding hosted/browser/device checks remain release considerations.
