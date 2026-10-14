# Leave summary deletion web release

Scope: approved Super Admin individual and bulk deletion on desktop and mobile web only. No Android update. The owner explicitly selected jewelos-prod instead of a separate staging project.

The web summary uses one audited deletion RPC, protected by availability.delete_leave. Batches contain 1 to 500 IDs and fail atomically for inaccessible records. Leave history/totals are refreshed after success. Request snapshots and private approval images remain audit evidence. Only availability attributable to deleted approvals is reconciled; manual overrides, overlapping approvals and completed work are preserved. Applicant locks serialize concurrent overlapping deletions.

Schema: forward migration 0234_leave_summary_deletion.sql adds the protected permission, deletion and restoration functions, retained-evidence lookup, three partial audit indexes, and updates private Storage read/cleanup policies. No new columns, secrets, functions deployment or data move. Both database type copies include the new function signatures.

Local validation before publication:
- pnpm.cmd exec turbo run typecheck --force --concurrency=1: six packages passed.
- pnpm.cmd exec turbo run build --force --concurrency=1: six packages passed.
- Core Vitest: 936 passed; data: 154 passed; web with --maxWorkers=1: 507 passed. An earlier parallel web run had two unrelated FMS timing failures; the serial run passed.
- Clean Supabase rebuild succeeded. Full database run: 135 files, 3680 assertions; three existing CRM failures in 0195/0202 independently reproduced with the new leave contract removed. A grant matrix ordering assertion was corrected and rerun.
- Focused database regression run: 8 files, 278 assertions passed (0006, 0156, 0174, 0176, 0177, 0178, 0181, 0234). New leave deletion pgTAP suite: 55 assertions covering success, denied access, tenant isolation, atomicity, retained evidence, availability and unfinished work restoration.
- Desktop 1440x900 and phone-width 390x844 browser checks on persisted local data: individual delete, cancel, bulk delete, empty history/totals, no horizontal overflow or page errors.
- Two-connection concurrency test passed: the second overlapping deletion waited and original manual availability was restored.
- Modified database functions have no lint findings. Existing public-function warnings and pgTAP-extension lint noise remain outside this change.
- Independent final code review reported no critical or important findings.

Target: Supabase jewelos-prod (yimafxhuwgfhvzczqqdd), Vercel mk-jewels2/mkjewels-os. Production data is never seeded or used for deletion tests. No employee leave records are removed by deployment.

Recovery: retain the previous compatible web deployment for rollback. Schema corrections use a forward migration. Deleted records retain complete audit snapshots and private image references for an authorized recovery procedure; deployment itself does not delete records. No database backup/export is copied into source.

Publication and hosted verification are recorded in the task handoff. Authenticated hosted deletion requires the owner to exercise the new controls on records they choose to remove; local synthetic deletion is the behavioral proof.
