# CRM cumulative profile repair implementation plan

**Goal:** Restore returning-client prefill and accumulated profile details without deleting historical records.

**Architecture:** Shared invoker SQL answer assembly; latest-visited phone resolution; profile-by-ID and planning read contracts; blank preservation inside the existing audited walk-in transaction. Existing IDs and visit/document histories remain intact.

**Spec:** ../specs/2026-10-23-crm-prefill-repair.md

- [x] Trace current form, queue, audited RPC and profile/history reads. Confirm separate CRM project and migration ledger; save private schema/data evidence outside Git.
- [x] Reproduce misleading empty prefill markers and same-route stale drafts; add regression tests and scoped fixes.
- [x] Add forward CRM migration, generated read types and tests for accumulated answers, conflicts, empty answers, original snapshots, international/no-phone identities, record preservation, audit and authorization denials.
- [x] Update form/profile loaders, planning defaults and current-client proof upload paths; retain explicit profile identity actions.
- [x] Update Kiara help/review; obtain independent code review and fix its findings.
- [x] Complete UI/database validation, typecheck/build and synthetic desktop/phone verification; results below.
- [ ] Production release: follow PRODUCTION_SWITCH_PLAYBOOK.md staging/approval gates. No hosted write is implied by local validation.

## Evidence boundaries

Read-only production audit: 1,593 clients, 2,186 timeline entries, 1,997 saved forms and 16 documents. Zero duplicate client codes, orphaned visits/forms/documents or total-visit mismatches. These checks do not prove every historical answer is complete.

Local SQL testing uses an isolated scratch database with current hosted public/private/Storage schema, static configuration and synthetic transaction fixtures. Country-code/bucket configuration and test-role/migration-history fixtures must be restored after schema-only cloning. No customer data is loaded into test fixtures. The historical clean migration replay currently stops at the pre-existing 20261009000100 browse-definition guard; do not rewrite that applied migration to bypass it.

Hosted data/schema application, deployment and signed-in production/physical-phone verification are separate gates. No APK is required because this is a web/shared CRM change.

## Final local validation and release status

- `pnpm.cmd --filter @jewelos/crm-ui test --maxWorkers=1`: 219 tests in 49 files passed, including profile/history loaders, shared-phone defaults, new/old labels, preserved drafts, proof identity and international numbers.
- `pnpm.cmd --filter @jewelos/crm-ui typecheck`: passed. `pnpm.cmd --filter web build`: passed (existing bundle-size advisory only).
- `pnpm.cmd --filter @jewelos/core exec vitest run src/assistant/appHelp.test.ts --maxWorkers=1`: 5 passed.
- Direct PostgreSQL tests on the isolated current-schema clone: 702 existing assertions passed. The final migration rehearsal and final focused contract suite passed 32 new assertions, including direct API identity resolution, audit and anonymous/inactive/service denials. One full-run attempt used a stale copied new-test file; the corrected direct run uses the current source.
- Synthetic browser fixture using the real CRM components/styles: 1440px and 390px passed saved-field, occupation, billing-country and queue-switch checks, with no page errors or horizontal overflow. Browser plugin was unavailable, so regular Playwright was used. Fixture files were removed; evidence stays outside Git. No signed-in production or physical Android claim.
- Independent review completed and its ordering, nested preference, international-phone and proof-path findings were fixed and reverified.
- `git diff --check`: passed. Unrelated concurrent Home edits and older dirty CRM work were preserved. No commit or push was made.
- CRM production migration ledger was checked. `supabase.cmd db push --linked --dry-run --workdir supabase-crm` lists only `20261023000100_crm_cumulative_profiles.sql`, with no seeds/roles. No hosted migration, data write or deployment was performed.

Production remains behind the hosted-staging and release-approval gates in `PRODUCTION_SWITCH_PLAYBOOK.md`. No configured staging target was identified among the connected projects. The change is implemented and locally verified, not yet live. No new APK is needed.

## Authorized production release follow-up

The owner subsequently instructed deployment of necessary migrations and publication to main. That explicit instruction authorizes this release after the missing hosted-staging environment was disclosed; no hosted staging project was created. Production CRM migration 20261023000100 applied, the dry run is now up to date, nine table counts/digests are unchanged, and read-only authenticated-role verification confirms the returning-client defaults and original profile identity. All 219 CRM tests passed again after integration with current origin/main; typecheck/build passed. See docs/releases/2026-10-23-crm-cumulative-profiles.md for release scope, approval and remaining evidence boundaries. Git publication/web-host verification follow separately; earlier local-only statements above describe the pre-approval checkpoint.
