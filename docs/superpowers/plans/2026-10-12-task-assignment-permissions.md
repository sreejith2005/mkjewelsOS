# Task assignment permissions and roster

Approved in chat on 2026-10-12. Extend the existing permission system only.

1. Add `tasks.assign_others` as a configurable action, defaulting to allowed for all roles to preserve existing department assignment behavior. Keep team management, dashboard authority and section access separate. Resolve individual > active department > active designation > effective role/default; Super Admin retains its bypass. Department actions remain restricted to this one approved key.
2. Add an authenticated, Tasks-gated, narrow assignee RPC that reads eligible active/invited working profiles within the actor's tenant. Managers see their branch without requiring a reporting-tree link; Admin/Super Admin and Process Coordinator retain company scope; other users retain department scope. Denied users see themselves. Return no contact fields. Do not widen user-directory RLS or availability queries.
3. Enforce the same permission and scope on audited task creation, transfers and assignment changes. Preserve validation, audit, notifications, completion, historical assignments and existing function signatures. Denial applies to assigning another doer; watchers retain authorized scope and do not become doers.
4. Use the RPC in web and shared native task authoring. Remove redundant base-role filtering in both composers so effective server authority is honored. Expose Inherit/Allow/Deny in all relevant Settings tabs, including Departments.
5. Write failing regression tests first, run focused and broader core/data/web/mobile tests, local pgTAP allowed/denied and scope checks, typechecks/builds, and rendered desktop/phone-width QA. Regenerate database types.
6. Review only named files. Follow production playbook for hosted changes and the standing Android release instruction. No connected Android phone was present at initial preflight; device proof is a publication gate, not replaced by tests/builds. No production data mutation for testing.

Compatibility: additive permission/RPC and forward migration; existing clients retain RPC signatures. An explicit denial is enforced server-side even for older clients. No CRM/schema/Storage changes and no historical data retargeting.

## Validation and release decisions

- Forward migrations 0213-0217 preserve the existing validation messages, guard imports and manual recurring runs, and leave automatic generation unchanged. Five new generated RPC declarations are included in both existing database type files; four helpers remain private, one narrow roster is authenticated-only.
- `supabase.cmd test db`: final full run passed 122 files and 3,025 assertions, including concurrent task-control regression tests. Focused permission/assignment tests include actual persisted tasks, audits, assignment alerts, denials and historical assignment preservation.
- `pnpm.cmd --filter @jewelos/core test --maxWorkers=1`: 818 passed.
- `pnpm.cmd --filter @jewelos/data test --maxWorkers=1`: 114 passed.
- `pnpm.cmd --filter web exec vitest run --maxWorkers=1 --testTimeout=15000`: 458 passed. Earlier runs timed out in FMS and permission UI tests under machine load; the unchanged failed cases and then the full suite passed with the stated timeout.
- `npm.cmd --prefix apps/mobile run test -- --maxWorkers=1`: 127 passed; `npm.cmd --prefix apps/mobile run typecheck` passed. Source parity is prepared; no native runtime or APK claim.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1` and `pnpm.cmd exec turbo run build --force --concurrency=1`: all six workspace packages passed. Existing large web bundle and CRM build-output warnings remain.
- `supabase.cmd db lint --local --schema public --level warning`: no findings in changed contracts. Existing warnings in form file IDs, the legacy CRM branch wrapper and FMS due-date volatility remain. All-schema lint additionally reports pgTAP extension temporary-table/type issues; these are not new application errors.
- Local Playwright at `http://127.0.0.1:5187`, desktop 1365x900 and responsive 390x844: real synthetic Manager login; seven branch peers visible although directory has one visible profile; a task assigned to another department saved to the exact selected profile. Super Admin saved department assignment denial, reloaded to verify persistence, confirmed Manager picker self-only, then restored synthetic Inherit. No page runtime errors. Browser plugin runtime was unavailable; used installed Playwright. Evidence lives outside the repository in the task's temporary files.
- Independent code review found that legacy initial import creation writes work directly. A regression proved denied Admin could still import another doer (six failing assertions). Migration 0217 guards the canonically resolved doer within the existing per-row transaction. All ten new assertions and the affected legacy/current import and assignment suites passed (168 assertions). Self and unresolved imports remain allowed. Review found no remaining important issue after correction.
- Owner explicitly chose existing production JewelOS project `yimafxhuwgfhvzczqqdd` and instructed not to create a new project. Production dry run contains exactly 0213, 0214, 0215, 0216 and 0217; no CRM-project changes, data moves, secrets or Edge Function deployments are required.
- Owner connected a phone, then explicitly deferred Android updates until the final batch of web features. Do not build or publish an APK for this task. Keep the prepared parity source for that batch.

Rollback: revert the web commit to the preceding compatible build if needed; correct database changes with a forward migration. These migrations add one permission and one narrow read, retain all installed-client write signatures, and do not retarget or delete historical data.
