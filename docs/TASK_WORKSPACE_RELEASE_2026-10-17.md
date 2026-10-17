# Task workspace release - 2026-10-17

Owner authorization: "deploy necessary migrations and push to main".

Release baseline: origin/main `0e78370`. Prepared in isolated
`.worktrees/task-workspace-release-20261017`; original dirty feature checkout
and unrelated edits are preserved.

Target: JewelOS production Supabase `yimafxhuwgfhvzczqqdd` and `origin/main`.
The task migration is `0286_task_workspace_visibility.sql`; the original local
0263 development filename is not a production release input. Production was
confirmed through0285 before preparation. Read-only dry-run lists exactly0286,
with no seeds or roles. Hosted pre-apply SQL lint reports zero errors.

## Scope and compatibility

- Subsection counts load on Tasks entry, refresh with persisted work changes,
  and refresh after recurring catch-up; obsolete requests cannot overwrite them.
- Complete opens/focuses a required remark rather than remaining disabled.
  Upload/form requirements and audited server completion are retained.
- A SELECT policy allows authorized persisted FMS work to read its pinned flow
  definition after archival or cross-branch assignment. Page counts exclude
  unassigned runtime placeholders and starter rows unavailable to their author.
- Existing video evidence, styling, work identifiers, audit and Storage behavior
  remain intact. RPC signatures and generated types do not change; no customer
  data is moved or rewritten.
- Tasks help in Ask Kiara describes the current controls and remark behavior.
  No new read tool is needed: existing task read/completion contracts are used.
- Current main's Android app is a WebView shell. This web release updates the
  employee Tasks screen on reload. No retired native screens, Android source,
  version bump, or APK is included.

## Safety and recovery

Seven completed physical backups confirmed. Latest backup:
`2026-10-16T20:24:16.702Z` (2026-10-17 01:54 IST); PITR disabled. No restore
was attempted. Database recovery remains a reviewed forward correction.
The previous web baseline `0e78370` stays compatible with this additive read
policy and unchanged RPC output. No secrets/configuration/functions changed.

## Validation and outcome

- Independent main-based release review: no blockers; video support/styling retained.
- Explicit local Docker container `supabase_db_jewelos-fms-contract`: release
  visibility test17/17 passed. The migration body matches the locally applied
  development repair. Related prior assigned-work/task-management tests105/105 passed.
- Named staged paths and whitespace check pass; credential-literal scan has
  zero matches and zero forbidden paths.
- Main-based core:90 files /987 tests passed; data:29 files /183 tests passed.
- All six workspace package typechecks and the web production build passed.
  Build emits size/plugin-timing warnings, with no compile errors.
- Task card/paging and FMS builder retry:48/48 passed with one worker and a
  20-second test timeout. The broad web run encountered two five-second FMS
  timeouts during concurrent checks; both pass in this retry. Its remaining
  results are recorded below when complete.
- Exact release source browser:390x844 and1440x1000, all subsection counts on
  entry, archived/cross-branch runtime cards, remark focus, and two persisted
  checklist completions passed. Local recurrence Edge Runtime is absent and
  emits expected non-2xx preparation errors; generation is covered by unit
  tests, not this browser run. Initial browser navigation timed out under
  concurrent load; retry with a longer navigation allowance passed.
- Pre-apply hosted anonymous probes of task page, feed and flow definitions all
  reject access with HTTP401 /SQLSTATE42501. No protected records were read.
- Hosted application and Git publication are recorded below when complete.

No signed-in production employee flow or physical Android behavior is asserted
from local checks, migration ledger, Git push, or web-host status alone.
