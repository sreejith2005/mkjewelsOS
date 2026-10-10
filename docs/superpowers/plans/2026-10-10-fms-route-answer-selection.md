# Multiple answers for one FMS route

Owner request: selecting any of several linked-form answer options must use the
same route and destination. Preserve first-match order and fallback behavior.

1. Add regression coverage for selecting and deselecting answers without modifier
   keys, including stable values and compatibility with existing equals routes.
2. Reuse the existing equals/in persistence and server evaluator. Centralize
   selection-to-condition conversion in core; use checkboxes on web and the
   existing multiple OptionPicker on native. Leave other operators unchanged.
3. Run focused editor, core, persistence and native tests, typechecks, web build,
   and whitespace checks. No migration, grants, RPC, Storage or generated-type
   changes are needed.
4. Verify rendered phone-width and native behavior before release. A connected
   phone is required for Android publication; stop publication if unavailable.

## Validation results

- `pnpm.cmd --filter web exec vitest run src/features/fms`: 89 tests passed.
- `pnpm.cmd --filter @jewelos/core exec vitest run src/fms`: 107 tests passed.
- `pnpm.cmd --dir apps/mobile test`: 126 tests passed (pure modules; no native
  component rendering).
- `supabase.cmd test db supabase/tests/0123_fms_stage_conditional_routing.test.sql supabase/tests/0142_fms_form_branching_safety.test.sql`:
  38 local database assertions passed, including direct resolver grant checks.
- Web/core/mobile typechecks passed; `pnpm.cmd --filter web build` passed with
  the existing large-chunk warning. `git diff --check` passed.
- Selection tests cover stable option values, selecting/deselecting without
  modifier keys, restored selections, removed options, and unchanged is-not
  conditions. Existing persistence tests cover JSON-array reload.
- The core `in` evaluator now matches any element of a multi-select form answer,
  aligning it with the existing database evaluator; scalar matching is unchanged.

No schema, RPC, RLS, grants, audit, Storage or generated-type changes. Existing
workflows are not rewritten. All writes continue through the existing audited
save/publish contracts.

Release remains pending: `adb devices -l` showed no connected phone. Browser
tools and the required Node REPL tool are unavailable in this session, so no
rendered desktop/phone-width browser check was performed. No hosted writes,
commit, push or Android publication were performed. Complete rendered and
physical-device checks before the standing Android release procedure.

## Publication (2026-10-10)

Focused core/web/mobile tests, typechecks, the two pgTAP files and
`git diff --check` were re-run and passed. `supabase.cmd db push --linked --dry-run`
against JewelOS production reported the remote database up to date: this change
has no migration to apply. Committed and pushed to `origin/main`. The Android
update remains pending the connected-phone validation gate.
