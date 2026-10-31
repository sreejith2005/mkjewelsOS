# Task assignment release evidence

Published source: `5071db016893e3f85dbee03f80d8f7243d63e1a6`, `origin/main`.
Production: existing JewelOS project `yimafxhuwgfhvzczqqdd`, explicitly selected by the owner; no separate staging project was used.
Web: https://mkjewels-os.vercel.app — Vercel production READY, alias metadata confirms this exact source SHA. Both connected Vercel projects reported successful builds.

## Changed behavior and files

- Task composers and shared task API use authenticated `list_task_assignment_users()` instead of directory reads. Ordinary Managers see eligible branch peers; Admin/Super Admin and active Process Coordinators have company scope; other accounts retain department scope. Process Coordinator designation retains company scope with Manager authority too.
- Permission catalog, resolver and Settings expose `tasks.assign_others` for roles, designations, departments and individuals. Department choices are Inherit/Allow/Deny. Super Admin retains its bypass; existing individual > department > designation > role precedence is preserved. Section visibility and management authority remain separate.
- Migrations 0221–0226 enforce assignment permission/scope on audited creation, transfer, assignment reconciliation, initial bulk imports, templates and manual recurring runs. Automatic generation and historical assignments remain unchanged. The narrow roster has no contact fields. Directory RLS was not widened; private helper grants remain blocked. Existing write signatures/audits/alerts are preserved; Storage and CRM were not changed. Both database type files include the five new functions.
- Native source parity is prepared in the composer and department permission tab. Owner explicitly deferred device testing and APK publication until the final batch of web features; no APK was built or released.

## Validation

- Before integration, full core/data/web/mobile tests passed: 818 / 114 / 458 / 127 assertions. Commands and warnings are recorded in [the approved plan](superpowers/plans/2026-10-12-task-assignment-permissions.md).
- After integration with current main, focused permission/core catalog, task data and web composer/permission tests passed: 40 / 16 / 16 assertions.
- `pnpm.cmd --dir .worktrees/task-assignment-release exec turbo run typecheck build --force --concurrency=1`: 12 tasks passed. Existing bundle-size/CRM output warnings remain.
- Isolated local database rebuilt the migration chain through 0225; 0226 was then applied with `supabase.cmd db push --local --yes`. `supabase.cmd test db` passed 129 files / 3,548 assertions after the correction. Focused task hardening, exact privilege inventory, permission resolution, assignment and import denial passed 317 assertions.
- Local authenticated Playwright desktop and phone-width QA passed with the integrated frontend: Manager picked seven branch peers, assigned an actual task to another department, department Deny persisted after reload and restricted the picker to self, and Inherit was restored. No runtime errors. These were synthetic local accounts, not production test writes.
- Hosted dry run contained exactly 0221–0226; all six applied successfully. Metadata query confirmed catalog/action, department resolution, designation priority, creation/transfer/import/schedule guards, authenticated-only roster and private helpers. Subsequent dry run reported no pending migrations. No hosted customer/employee records were created for testing.
- Remote main hash matched the published SHA. Public HTTPS `/tasks` and `/settings/permissions` returned 200; deployed JavaScript contains both the permission and roster RPC. Authenticated production account behavior was not separately exercised.

## Handoff

No remaining web/server blocker. Android runtime validation and signed release remain deferred by owner.
Rollback uses the preceding compatible web build and a reviewed forward database correction; never rewrite applied migration history.

Release work was isolated here to preserve concurrent task-control edits in the original checkout. That checkout remains on its older development branch with the original, unpublished task-migration numbering. Use current main/release history for subsequent releases; do not publish those old task migration numbers over Ask Kiara history.

This local evidence record is deliberately outside the published commit; the approved plan and implementation are published.
