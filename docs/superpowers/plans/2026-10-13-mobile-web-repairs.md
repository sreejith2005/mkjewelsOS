# Mobile web repair plan

Goal: repair the reported Forms Library and CRM defects, then test related phone and desktop interactions.

Preserve existing persistence, audited writes, permissions, history and unrelated work. CRM implementation changes are authored in C:\crm and integrated by scoped patches. No redesign or replacement backend.

- [x] Reproduce form header scrolling and validation failures with focused regression tests.
- [x] Give filling dialogs a scrolling header; retain other dialog focus/close behavior.
- [x] Replace obsolete walk-in step validation with an accessible missing-field summary, highlights and focus/scroll.
- [x] Repair branch controls within existing server authority. Owner confirmed existing branch permissions on 2026-10-13.
- [x] Add department membership to audited staff sync and restrict CRM/Sales choices server-side, without changing login eligibility. Preserve the existing company-wide CRM team and branch-specific Sales choices.
- [x] Exercise phone widths 360/390/430 and desktop 1440; fix observed regressions, including FMS builder configuration reads and focused error-border priority.
- [x] Run focused and broader tests, typechecks/builds and local database authorization tests.
- [x] Independent code review and scoped diff review; report remaining release gates.

## Changes and compatibility

- `apps/web/src/components/ui.tsx`, `pages/FormsPage.tsx`: opt filling dialogs out of sticky headers; other dialogs retain their existing behavior, focus trap, Escape and safe areas.
- `packages/crm-ui/src/components/walk-in-form.tsx`, new `form-validation.tsx`, `phone-number-input.tsx`: validate all native required constraints, show a linked field summary, highlight errors, focus and scroll to the first; replace obsolete step-only feedback. Submission payload, required proof handling and audited transaction remain intact.
- `components/entry-queue.tsx`: operable selectors offer only the assigned branch to ordinary users; Super Admin can switch. Fix stale selected state and branch labels on existing rows.
- `src/app/globals.css` and generated scoped CSS: phone-sized inputs, containment and visible error borders even while focused. No new palette.
- `src/app/(crm)/visits/new/page.tsx`, `src/lib/supabase/crm-project.types.ts`: use the new department-filtered CRM roster RPC; retain the existing separate Sales RPC. Remove the fallback that put CRM people into Sales choices.
- JewelOS migration `0231`, CRM migration `20261013000100`: transmit private department selection metadata through existing staff sync; filter both readers and queue roster snapshots. CRM access grants/identity and audited writes stay unchanged. Historical allocations/submissions are preserved; current role-only CRM employees outside the CRM department intentionally leave intake choices.
- JewelOS migration `0232`: restore the missing SELECT grant for FMS default-assignee configuration, with tenant, active-profile and module permission policies. No direct write grant and no write-RPC change. Web/native builder consumers share this repair; assigned-work loaders do not read this table.
- No Storage change or work-item identifier/completion/notification change. New generated-type signature for the CRM roster RPC only; FMS table shape is unchanged.

## Local validation on 2026-10-13

- `pnpm.cmd --filter web test`: 461 tests passed.
- `pnpm.cmd --filter @jewelos/crm-ui test`: 191 tests passed.
- `pnpm.cmd --filter @jewelos/core test`: 820 tests passed.
- Final focused CRM command: `pnpm.cmd --filter @jewelos/crm-ui exec vitest run tests/walk-in-form.test.tsx tests/entry-queue.test.tsx tests/phone.test.ts`: 41 passed. CRM checkout focused tests: 32 passed.
- `pnpm.cmd --filter web exec vitest run src/components/ui.test.tsx src/features/forms/forms.test.tsx src/pages/FormsPage.delete.test.tsx`: 33 passed.
- CRM/web typechecks, CRM scoped CSS check and web production build passed; Vite reports its existing large-chunk warning.
- Local `psql -v ON_ERROR_STOP=1` executions of rollback-based pgTAP suites: JewelOS 0231 (13), 0232 (8), roster (20), existing FMS (11), permissions (53); CRM department choices (13), company-wide roster (17), workflow/branch-registration (22). All 157 assertions passed. Explicitly tested non-Sales direct API selection, inactive/anonymous reads, cross-tenant reads, denied FMS access and direct writes.
- Playwright, Browser plugin unavailable: real seeded local JewelOS, 13 sections at 360/390/430/1440 = 52 rendered checks; 10 additional drawer/composer/builder/search checks at phone/desktop widths. No overflow, runtime errors or framework overlay in the final runs. Local Edge Functions were started for login/recurring-task checks.
- Separate synthetic browser fixture exercises the actual CRM and form components at all four widths: branch selection, separate staff choices, invalid-field list, red focused border, field actually visible after scrolling, dialog title scrolling and Escape close. No mocked persistence was added to the application. The seeded library has drafts only, so long-form filling uses this test fixture.
- `git diff --check` passed. Independent review found a company-wide CRM regression in the first draft; it was corrected and regression-tested before handoff.

## Production release on 2026-10-13

Owner authorized migration deployment and a push to main. Release is based on current `origin/main` (`db9b8bb`), with only the reviewed repair commit cherry-picked (`be55593`); unrelated earlier task commits and the visual-refresh draft are excluded.

- Confirmed targets: JewelOS `jewelos-prod` (`yimafxhuwgfhvzczqqdd`), CRM `walk-in_crm` (`fsydcsyqnddacjfoutfe`). Migration lists and dry runs showed only 0231/0232 and CRM 20261013000100. All three applied successfully; subsequent dry runs were empty.
- Recovery: pre-change schema-only dumps and affected function definitions saved outside Git. Web rollback uses the previous compatible main deployment; database correction is forward-only. No customer records were migrated.
- Staff reconciliation returned HTTP 200: 82 snapshots, 35 active grants, 42 CRM roster rows, no ineligible active grants, no roster conflicts, no missing roster users, no absent-user deactivation. Selection metadata populated: 7 eligible CRM and 19 eligible Sales staff; remaining grants intentionally stay outside those choices. Staff outbox is fully delivered. One unmapped active branch remains reported by the existing sync health check; no branch mapping was changed in this repair.
- Counts and full-row digests matched before/after for clients (1587), visit forms (1995), documents (16), timeline (2184), and leads (9). Anonymous execute is denied for both staff-choice RPCs.
- Hosted verification exposed pre-existing broad table grants on FMS defaults from production default privileges. Forward migration 0233 explicitly revokes PUBLIC/anon/browser grants and grants only authenticated SELECT; existing RLS and audited SECURITY DEFINER writer remain unchanged. Four new privilege tests and eight FMS read/authorization checks passed locally after simulating those broad grants. The reviewed 0233 dry run contains only that migration.
- Integration on current main: CRM 191 tests and focused Forms 33 tests passed; web/CRM typechecks and web build passed. Existing large-chunk warning remains.

Publication and final hosted privilege checks follow this record. No Edge Function, secret, Storage, or native binary change. `adb devices -l` returned no devices; authenticated hosted intake/queue and physical-phone UX are not proven by the deployment checks. Existing branch permissions are preserved.
