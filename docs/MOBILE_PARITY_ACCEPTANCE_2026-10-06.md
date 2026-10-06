# Three-surface parity: implementation and acceptance evidence

Full feature parity and production readiness are **not yet established**. This record separates implemented source, local checks, browser behavior, native runtime behavior and hosted verification.

## Implemented source

- Shared bounded refresh coordination, tenant subscription reconnect catch-up, browser focus/online/visibility wake-ups and native foreground/network/navigation lifecycle. Operational native screens use the existing shared data contracts.
- Inbox INSERT/UPDATE/DELETE refresh, preserving read history and server-derived work completion. Updates do not repeat assignment toasts.
- Settings draft preservation, branch identity isolation and optimistic version rebasing after an own save. Auth preference/access reads reject stale identity results.
- Exact assigned-work and nested native destinations, plus incoming scheme/trusted-origin parsing. Starter IDs and runtime instance/stage IDs stay intact.
- Form-selected assignee controls on both FMS builders using shared eligibility and existing assignment RPCs.
- Native Forms Library work/upload-form shortcut; shared audited installer; Dropdown Master creation/reference for all choice fields; stable option rename/reorder/add/delete; answer-to-question/section/end routing; section continuation; Shown/Editable; add-at-position, preview reset and invalid-field opening.
- Shared Forms Library lifecycle filtering fixes archived history under “All lifecycle.” Shared answer-route replacement removes an obsolete section jump when changed to a question.
- Web task attachment recovery retains the persisted task ID, allows a replacement file and explicit removal, and prevents another task creation on upload retry. Native already had same-ID recovery.
- Dropdown Master reads share one API and retain only requests in flight, enabling committed remote changes and retries after failed reads. Identity changes invalidate pending cache entries.
- Leave, reports, permissions, notification administration and daily checklist refresh integration. Checklist refresh preserves checked items for the same day/revision; an acknowledgement on another surface closes the gate. Initial offline native loads still attempt validation and show errors. Delayed acknowledgement results cannot close another profile/day's gate.
- Selected-user permission details catch up when administration context refreshes. Local authority and override edits survive; stale reads/saves cannot replace another selection or overwrite a successful save. Edits made during an own save remain pending.
- In the integrated CRM client, shared coordination catches up on focus, visible return, reconnect and a 60-second interval for active observers. Route and query refresh waits for the current loader; superseded loaders cannot release it early. Background read failures retain current drafts with retry, while authorization errors, genuine missing rows and successful no-profile responses retain their original paths. Client Profile starts a new edit from the latest committed prop and retains active edits. These CRM changes are integrated into the authoritative checkout on the main baseline; hosted runtime verification remains separate.

## Backend impact

`0197_mobile_parity_refresh_signals.sql` adds seven payload-free triggers for leave requests, starter assignments, exports, notification templates/rules and daily checklist definitions/acknowledgements. It reuses the existing tenant signal emitter. No RLS, grants, public RPC signatures, Storage policies or generated types change. Existing audited RPCs continue to authorize mutations and record their audit entries.

The new migration was exercised transactionally against the local database and rolled back. Local history remains through 0194; unrelated pending 0195/0196 and hosted history were not advanced. There was no hosted migration/function/web deployment, Git publish or Android release.

`0198_permission_role_metadata_scope.sql` changes only the permission-administration role metadata expression to the schema-qualified JewelOS enum. A reproduced collision with another schema's `user_role` previously produced duplicates and foreign role labels. The RPC's authorization, tenant scope, signature, grants and other response fields are retained; no generated-type update is needed. It was tested inside a rolled-back local transaction, without advancing migration history.

## Local evidence

| Check | Result | Scope/limit |
| --- | --- | --- |
| `pnpm.cmd --filter @jewelos/core test` | 63 files / 780 tests passed | Shared rules and existing regressions. |
| `pnpm.cmd --filter @jewelos/data test` | 14 files / 90 tests passed | Includes installation failures and settled/rejected/invalidated master-option reads. |
| `pnpm.cmd --filter web exec vitest run --maxWorkers=1` | 81 files / 392 tests passed | Full suite; later cache re-export also passed 33 focused Forms tests. Latest attachment replacement passed the six-test composer suite. |
| `npm.cmd --prefix apps/mobile test -- --maxWorkers=1` | 22 files / 119 tests passed | Pure/native-adapter tests; does not mount native feature screens. |
| `pnpm.cmd exec turbo run typecheck --force --concurrency=1` | 6 packages passed | Native has its separate check. |
| `npm.cmd --prefix apps/mobile run typecheck` | Passed | Repeated after native builder changes. |
| `pnpm.cmd exec turbo run build --force --concurrency=1` | 6 packages passed | Runtime/device/hosted behavior remains separate. |
| Local transactional 0197 pgTAP | 21 assertions passed | Trigger emission, tenant visibility, inactive/anon/service restrictions. |
| Related transactional pgTAP | 7 files / 201 assertions passed | Settings, checklists, signals, leave and FMS assignment regressions. |
| `supabase.cmd test db supabase/tests/0113_form_sections_branching_and_dropdown_references.test.sql` | 27 assertions passed | Existing Forms/Dropdown Master authorized contracts. |
| Transactional 0198 with extended 0156 permission suite | 53 assertions passed | Collision assertion failed before the migration; existing permission denials, authority, audited writes and section enforcement remain covered. |
| Focused permission editor, synced-draft and composer tests | 17 tests passed | Seven rendered permission cases, four draft binding cases and six composer cases; native UI rendering is still pending. |
| Expo Android export | Passed | Repeated after the final permission-editor changes; Hermes bundle produced. Not a signed APK or device validation. |
| CRM full `vitest run --maxWorkers=1` in `C:\crm` | 24 files / 106 tests passed | Later queue/count error guards also passed 2 files / 6 focused tests and final typecheck. Does not establish two-project hosted or Android WebView behavior. |
| CRM typecheck/build and copied shared coordinator tests | Passed / CSS current / 5 tests passed | CRM changes were integrated from the reviewed worktree onto the current main baseline; the independent Sheet-sync commit is excluded. |
| Scoped `git diff --check` | Passed | No staging or commit performed. |

An initial concurrent test run timed out in two web FMS cases and the native listener test. All three passed in isolation; the complete web/native suites passed with one worker without changing application code or increasing test timeouts.

## Browser evidence

The browser plugin runtime was unavailable, so the approved Playwright fallback was used. Local Supabase REST/API containers were restarted without resetting the database. The maintained local seed restored documented synthetic accounts; no production target or exported auth state was used.

- Login rendered at 320/360/390/430/1440 pixels without page errors or document overflow.
- Fourteen authenticated internal routes at those five widths: 70 page visits, no login fallbacks, page errors or document overflow. This is route-level layout evidence, not every action or modal.
- At 1440 and 320 pixels, a desktop preferences save reached phone web through live refresh. A dirty phone draft survived; explicit discard adopted the committed values. A phone preferences save then reached desktop. Original synthetic preferences were restored through the audited RPC.
- Settings and Forms 320px screenshots were visually inspected. Compact height, zoom, keyboard, all dialogs and interaction flows remain pending.
- Authentication for these browser scenarios used local Supabase password auth and its real session. The username-login Edge Function was not exercised.

Scratch screenshots/logs/scripts stay under ignored `.superpowers/sdd/2026-10-06-three-surface-parity/`; they are local evidence, not release assets.

## Outstanding acceptance and release gates

- No connected Android device or configured emulator. Native cold/warm/signed-out links, WebView bridge/back navigation, keyboard, large text, TalkBack, touch canvas, files/voice and upload failure interactions are unverified.
- The action inventory remains open. Every section needs its success/denial/direct-entry scenarios across the three surfaces; the page-width pass cannot substitute for these.
- CRM catch-up source and failure/draft tests are now integrated on the 9edf6f0 main baseline, preserving committed client paging. The independent Sheet-sync branch is excluded. Original-screen phone/embed actions, two-project sync and hosted cutover need the maintained owner-run runbook.
- Migrations 0197 and 0198 are not hosted. Neither the new signals nor the corrected permission metadata can be claimed live in production.
- Integrate reviewed scoped changes on main without publishing the concurrent CRM transition branch wholesale. Then run all required release gates and the official `scripts/release-mobile.ps1`; verify public `latest.json`, APK identity and signature. No mandatory update is authorized.

No section is certified production-ready by these local checks alone.

## Authorized release execution (2026-10-06)

The owner explicitly authorized deploying necessary migrations and publishing to main. The release is scoped to this parity implementation, based on main 9edf6f0; independent CRM Sheet-sync commit 7a99c54 is excluded. The linked JewelOS project is confirmed as jewelos-prod (yimafxhuwgfhvzczqqdd), ap-south-1. The dry run lists exactly migrations 0197 and 0198; existing hosted history is through 0196.

Fresh integrated checks: core 780 tests; data 90; CRM 108; native 119; six monorepo typechecks; native typecheck; six package builds; local transactional database 74 assertions. All passed. The final web suite is recorded separately when complete.

Recovery: these compatible migrations add payload-free signals and qualify existing role metadata; no customer records are migrated. Preserve historical records and use a forward correction migration for database recovery. Web can roll back to the previous verified Vercel build. Android releases require a new higher versionCode for recovery; never downgrade or reuse codes. No mandatory update is authorized.

Hosted application, Git publication, web deployment and signed APK results must be recorded after execution. Full action-level parity and phone acceptance remain open; release does not certify all remaining scenarios.

Final integrated web suite: 82 files / 399 tests passed. Independent release review found no blockers. Staged whitespace and credential-pattern checks passed.
