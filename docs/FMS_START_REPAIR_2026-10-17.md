# FMS form start repair and simpler assignment

Target: jewelos-prod (`yimafxhuwgfhvzczqqdd`). Owner authorized this production
project only and publication to main. Scope is web; no Android package release.

## Changes

- `0287_fms_exact_start_visibility.sql`: the common `flow_form` transaction
  previously joined `fms_instances` to a mutating starter function in the same
  statement. Its snapshot could not see the inserted instance, raising the exact
  reported error and rolling back the submission. Read the returned instance ID
  first, then load the instance in a separate statement. Keep atomicity, actor
  authorization, audit and durable idempotency unchanged.
- `0288_fms_simple_form_assignment.sql`: private shared form-chain resolver;
  candidate preview, initial preview and execution use the nearest human visit
  on the causal path. A User question named/keyed Assigned To (or the existing
  explicitly designated assignment question) selects the next owner. Without
  that question, keep the previous visit's assigned employee. An administrator
  completing on someone else's behalf does not become the owner. Ambiguous
  multiple questions/owners and existing unanswered/hidden questions require
  correction or an explicit advanced rule. Recipient policy and absence coverage
  still run on the server. Stale inferred source pins are not used by this mode.
- New steps default to this rule. Assignment and advanced controls are collapsed.
  Existing custom steps can opt in with **Use form assignment** in a draft
  revision and then publish. Existing published/running/fixed rules remain
  unchanged. Legacy upgrade preserves existing explicit source behavior.
- Core authoring, validation, simulation and optional assignment configuration
  mirror the server rule. Only the nearest causal source forms needed by simple destinations are required; unrelated optional forms stay optional.
  Builder validation opens disclosure ancestors before focusing an error.

No tables, RLS policies, Storage rules, public RPC signatures, Edge Functions,
secrets or production data are changed. The private helper has no API grants;
generated browser database types continue to expose the existing RPC surface.

## Validation

- Exact SQL reproduction failed with the reported exception before the repair;
  repaired pgTAP test passes 6 assertions, including selected owner and replay.
- Simple-chain pgTAP: 13 assertions pass, including A -> B -> B -> C,
  preview/execution agreement, administrator-on-behalf continuity, unanswered
  question refusal, multiple-owner refusal, private helper denials, and draft
  publication without obsolete source mappings.
- Parallel merge regressions: 12 assertions pass, including a nested split with one human branch; simple assignment requires an explicit advanced rule across merged human branches, in preview and execution.
- Existing FMS pgTAP files 0239-0267 pass (215 assertions); four new regression files add 31 assertions on the dedicated local container.
  This is an incremental database check, not a clean full migration replay.
  An accidental broad sweep selected the unrelated task-video test; its fixture
  failed because that migration is absent from this older local stack. The
  corrected sweep includes only FMS tests. Production already has task video.
- Core FMS: 143 tests pass. Web builder: 26 tests pass; editor: 4 pass.
  Related Forms and assigned-work checks: 54 tests passed in the first web run.
  The first builder run timed out at 5 seconds; rerun with 20 seconds passed.
- Data/API regression suite: 70 tests pass.
- Independent bounded review: no remaining critical or important findings after both review regressions were fixed.
- Web TypeScript and production build pass (2201 modules); standalone e2e script
  syntax check passes. Existing large-bundle warning remains.
- Real local Supabase/browser check at 390x844 and 1440x900 passes: assignment
  disclosures, guided builder/canvas, private file upload/sign/download, preview
  without writes, cancel preserves answers, eligible replacement, atomic
  successor, three concurrent retries, simulation without writes, no other-owner
  redirect, no horizontal overflow or browser runtime errors. Browser connector
  initialization failed with missing kernel assets; repository Playwright was
  used as the fallback. Test fixtures were local and synthetic only.

## Release preflight

Hosted ledger now includes the concurrently released task-workspace migration 0286. The unapplied FMS files were renumbered to 0287 and 0288 without changing their SQL bodies. Dry run must select exactly those two files, no seeds or
roles. Baseline hosted public-schema lint reports zero errors. Backup metadata
confirms COMPLETED daily backup at 2026-10-16T20:24:16.702Z; no restore was run.
No separate staging target was used, following the owner's explicit instruction.
Production apply, publication and post-release evidence are recorded in the
release handoff; signed-in production use still needs the owner's smoke check.
