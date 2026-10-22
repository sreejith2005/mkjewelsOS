# Company-wide FMS handoffs - 2026-10-22

The owner reported "Employee is outside your permitted FMS handoff scope" and
approved all active users, including management, across branches/departments.
This follows the owner's instruction to deploy necessary migrations and push main.

## Cause and bounded change

Both `list_fms_handoff_recipients` and `assert_fms_handoff_recipient` reused
ordinary task-assignment permission, department scope and protected-role rules.
A company user visible in a form could therefore fail during preview/submission.

0318 removes those Tasks restrictions from runtime FMS handoffs and their picker.
The existing exact-work actor authorization, destination/route check, immutable
fixed owner, active login-enabled recipient, tenant isolation and availability
coverage still run. Form-selected, manual and starter handoffs share the existing
server transaction and durable ownership decisions. Ordinary Tasks rules do not
change. The form user dropdown already reads the tenant-wide directory.

Independent review found that publication validators also called the same helper.
0319 preserves their prior Tasks restrictions through a private publication
validator. Only the two existing publication-validation bodies use that wrapper;
runtime callers retain company-wide handoffs. No published definition, historical
submission or employee record is rewritten. No table, RLS policy, Storage,
Edge Function, function argument/result shape or generated type changes. The new
publication helper is private. No APK is needed for this database/web-shell fix.

Kiara's FMS help explains **Assign to a Different Employee** and company-wide
recipient eligibility. No new Kiara read tool is needed; this documents existing
protected actions and Kiara remains read-only.

## Validation and release

The new local test reproduced the exact scope exception before implementation.
Post-change evidence, review disposition, linked preflight and publication are
recorded below as completed. The original workspace release's full-suite baseline
failures and unrelated Windows port restoration limitation remain documented
separately; this change does not claim to resolve them.

- Before 0318, the new test failed with the reported scope exception during
  `list_fms_handoff_recipients`. The publication-preservation test also reproduced
  three missing denials before 0319. Its draft fixture was corrected to respect
  immutable published definitions.
- Final focused local database gate: 9 files / 113 assertions passed. This includes
  actual form submission to a manager in another branch, explicit administrator
  handoff, durable successor ownership, no Tasks assignment capability, department
  selection/search, foreign/disabled recipients and actors, locked targets,
  private grants, publication scope, starter handoffs, coverage and authorization.
- Broad local run: 48 files / 476 assertions executed; 46 files passed. The two
  existing workspace search-budget files 0293/0312 timed out under the restored
  shared Docker load. This is not a passing full database gate.
- Core app help and system prompt: 2 files / 14 tests passed. Existing rendered
  handoff dialog: 4 tests passed. All six package typechecks passed. No picker
  markup or layout changed; no new rendered browser/device claim is made.
- Independent read-only review identified the shared publication-validator scope
  expansion. The 0319 separation and tests resolved it; re-review found no blockers.
- Linked preflight confirms `jewelos-prod` (`yimafxhuwgfhvzczqqdd`) through 0317.
  Dry run lists exactly 0318 and 0319, no seeds or roles. Latest physical backup
  remains COMPLETED at 2026-10-21T20:25:01.144Z (22 October, 01:55 IST), with
  seven daily backups and PITR disabled. No restore was attempted. Recovery is
  reviewed forward correction; neither migration rewrites operational records.
- Serial retry of both search-budget files passed 2 files / 19 assertions after
  the broader run. All failed cases from that run passed on retry; it does not
  replace the original full-suite baseline limitation. Local and hosted pre-apply
  lint at error level both returned no errors. Named staging, whitespace and
  credential-safe scans passed with 10 reviewed paths and zero findings.

## Hosted outcome

Implementation `3706d01` was fast-forwarded into local main. The owner-authorized
linked push successfully applied exactly 0318 and 0319 to `jewelos-prod`.
Post-apply dry run reports up to date with nothing pending. Hosted error-level
lint returns no errors. Read-only metadata confirms both ledger versions,
the absence of Tasks scope checks in the runtime guard/picker, the retained
publication guard and denied anon/authenticated/service-role execution of the
private publication helper. The anonymous handoff-picker HTTP probe returns
401 / SQLSTATE 42501. No customer records or credentials were printed.

The matching code and this release evidence are published to main; publication
is verified against the remote SHA. Hosted signed-in employee behavior remains
unverified: successful persisted cross-branch/management handoffs were tested
with synthetic local users. No production test work item or employee data was
created. The database fix takes effect for existing deployed clients, and a
refresh/retry reloads the employee choices. Automated CI/web-host results are
reported separately at handoff.
