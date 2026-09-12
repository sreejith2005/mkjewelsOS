# In-Place Form Edits Design

## Goal

Allow a published form to be edited in place without changing its ID, preserving every Task and FMS reference while each completed submission remains readable against the definition shown at submission time.

## Current Failure

`save_published_form_with_audit` rejects templates with submissions or active FMS work. The revision route creates v2, but publishing it must archive v1; active FMS stages pin v1, so that archive is rejected.

## Data Contract

- Every `form_submissions` row stores `{ template, fields }` in `template_snapshot` in the same transaction that records answers.
- Existing submissions with a live template are backfilled once. Existing non-null snapshots are never overwritten.
- Submission views prefer `template_snapshot`; a later edit cannot alter historical question labels, fields, options, routing, or sections.
- Form IDs and all Task, Task Template, FMS Stage, starter-assignment, and live-instance references remain unchanged.

## Write Contract

- A forward migration redefines `save_published_form_with_audit` without only its submission and active-FMS rejection checks, retaining authorization, validation, grant, audited write, and published-edit trigger guard.
- A forward migration redefines `submit_form_with_audit` to persist the form snapshot with new submissions.
- The Forms Library sends Edit directly to the original published bundle rather than creating a revision.
- The existing v2 draft is left untouched; its deletion is separate user-directed work.

## Verification

- pgTAP: authorized in-place edit after submission and active FMS work; snapshot persists original definition; current denial cases remain denied.
- Vitest: published Edit opens the original bundle and does not call the revision API.
- Run local db tests, focused web tests, typecheck/build, then linked migration dry-run before a hosted apply.
