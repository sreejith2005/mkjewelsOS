# Department and individual section access acceptance

Implemented locally on `feat/department-section-access`, 2026-10-07. This is not a hosted deployment or Android publication.

## Behavior

Users contains a Section access action for each employee. Settings > Permission management > Departments controls an entire department, with branch context to distinguish names. Both web and native offer Inherit, Enable and Disable for implemented sections, and show the effective result/source. Individual overrides take priority over department, designation and role defaults. Department rules affect section access only. Existing action permissions, data scopes, dashboard authority, protected keys and Super Admin access remain intact. The existing self-edit safeguard remains.

CRM eligibility uses the resulting `crm.view` permission. Department changes, moves and deactivation queue existing staff sync. Eligible ordinary employee roles map to CRM salesperson; existing manager/admin mappings remain. No historical customer record is changed. Already issued CRM tokens retain the existing expiry/revocation boundary; this change does not promise immediate invalidation of a token already issued.

## Changed contracts and files

- `packages/core/src/permissions/`: shared resolution, explanations, section editor model and tests. `packages/core/src/database.types.ts`: regenerated changed table/RPC entries from the clean local schema.
- `packages/data/src/permissions/`: department context parsing and narrowly scoped saves. Web reuses this API.
- `apps/web/src/features/permissions/`, `pages/TeamDirectoryPage.tsx` and tests: Users modal, Settings department tab, stale-response protection, source captions and phone layout. Existing Settings description updated.
- `apps/mobile/src/features/users/`, `features/settings/DepartmentPermissionsTab.tsx`, Users/PermissionManagement/Settings screens and tests: equivalent controls using shared contracts.
- Migration `0199_department_section_access.sql`: module-only tenant/department overrides with RLS, minimum grants, validation, realtime refresh and resolver/context extensions. Audited `save_department_permissions_with_audit` and `save_user_section_access_with_audit` RPCs. The individual RPC preserves stored authority under a row lock and reuses the existing audited contract. Department configuration is retained by the existing retirement manifest.
- Migration `0200_department_crm_staff_access.sql`: staff snapshot mapping and department/profile sync events. Authored in the required CRM worktree; only the new migration/test copied into this checkout, preserving unrelated CRM edits.
- New pgTAP tests and an exact update to `0006_restrict_function_execution.test.sql`: only the two new audited RPCs are granted to authenticated callers; internal triggers remain unavailable to API roles. No Storage changes.
- Approved design and implementation plan in `docs/superpowers/`.

## Local evidence

| Command/check | Result |
| --- | --- |
| `supabase.cmd db reset --local` | Clean migration rebuild passed |
| `supabase.cmd test db` | 110 files, 2,670 assertions passed |
| `supabase.cmd db lint --local --level warning` | Exit 0; six existing function warning groups, none in new permission functions |
| `pnpm.cmd --filter @jewelos/core test` | 64 files, 789 tests passed |
| `pnpm.cmd --filter @jewelos/data test` | 15 files, 94 tests passed |
| `pnpm.cmd --filter web test` | 85 files, 409 tests passed |
| `npm.cmd --prefix apps/mobile run test` | 23 files, 121 tests passed |
| `pnpm.cmd exec turbo run typecheck --force --concurrency=1` | Six workspace tasks passed |
| `pnpm.cmd exec turbo run build --force --concurrency=1` | Six workspace tasks passed |
| `npm.cmd --prefix apps/mobile run typecheck` | Passed |
| Android Expo export | Passed; bundle export is not native runtime evidence |
| Deno CRM staff sync/session exchange worker tests, each using its function deno.json | 11 + 9 tests passed |
| Final full web test rerun and web build after responsive card adjustment | Passed |
| Whitespace and staged credential scan | Passed before local commit |

Local synthetic pgTAP covers allowed/denied resolution, precedence, protected/action isolation, authority preservation, audited rollback, direct grants, inactive/unauthenticated/cross-tenant access, module disabling, department changes and CRM sync. Existing regression suite passed. Independent review identified a stale parent-context response race; a failing regression was reproduced and fixed on both clients with request epochs.

Playwright with Edge tested actual local Supabase persistence: individual CRM enable/disable/inherit through Users, authority preservation, department CRM enable through Settings and the ordinary employee CRM menu. Desktop 1440px and phone 390px layouts fit their viewports; no browser errors. The new directory action uses its own row to preserve employee identity space. Authentication used valid synthetic sessions injected into browser storage; the login screen itself was not tested. Screenshots and the QA script are outside Git under `%TEMP%/jewelos-section-access-qa/`. Test choices were restored after the run.

Existing lint warnings: `crm.save_referral_followup`, `crm.submit_walkin_visit`, `public.submit_form_locked_with_audit`, `public.assert_crm_branch_user`, `public.is_valid_fms_due_date` and `public.import_delegation_tasks_with_audit`.

## Release gates still open

No physical Android device was connected (`adb devices -l` had no devices), and no emulator executable was available. The mobile release guide requires running visual changes on a phone before publication. Therefore the release stopped before APK publication, merge/push, hosted migrations or hosted department configuration.

Next: verify Users and Departments on a phone, then follow the production playbook for hosted staging and production, checking linked project/migration history and dry-run before applying forward migrations. Verify two-project staff sync and CRM session behavior with eligible ordinary employees. Initialize CRM access for the actual Sales and CRM departments using verified tenant/department IDs through the audited RPC, preserving explicit individual denies. No name-based automatic grant or production data mutation was performed. Publish the reviewed Android update only after all required gates pass, using `scripts/release-mobile.ps1`, then verify public manifest/APK. Do not use `-Mandatory` without explicit approval.

## Implementation decisions

Owner approval authorized implementation without another approval round. Work stayed on a feature branch in the authoritative checkout rather than a second checkout. The existing resolver, authority-safe audited user write and retirement manifest were extended rather than introducing competing systems. These decisions preserve current contracts and unrelated work.
