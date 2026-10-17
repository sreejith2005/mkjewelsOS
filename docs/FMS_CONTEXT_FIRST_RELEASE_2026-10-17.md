# FMS previous-form context release

FMS task details now show saved questions and answers from the original initial
form and causal preceding stage visits. Each group identifies the stage, visit,
filler and submission time. Details open before the current stage form from Tasks,
Home, Notifications, direct work links and the FMS workspace. Employees explicitly
continue after context loads. Starter forms retain their initial-start behavior.

## Scope and compatibility

- Web context component, context-first wrapper, Task card and two runtime pages;
  shared checked data parser and answer formatting; generated RPC type mirrors.
- Migration `0289_fms_previous_form_context.sql`: paginated exact-visit authorized
  RPC, private causal/snapshot helpers and submission lookup index. No data move,
  table grant expansion, ordinary form-submission RLS change or workflow mutation.
- Full saved field definitions drive historical labels, visibility and section
  routing, including forms edited in place after submission. Legacy submissions
  without a snapshot use the available current definition.
- Private attachments use the same causal projection for signing and audited
  opens (`fms_context_file_accessed`). Paths are absent from context responses.
- Existing batched task summaries remain bounded. Full forms load only on opened
  details; older form groups and workflow history paginate independently.
- Canonical assignment/visit links, atomic completion and notification completion
  contracts are unchanged. No Android release, per the owner's web-only scope.

## Local evidence

- Dedicated synthetic Docker stack `jewelos-fms-contract`; 34 FMS pgTAP files,
  266 assertions passed. Includes current RPC pagination, visibility, historical
  sections/options, causal attachment signing/open, next-stage answers and denied
  forged identity, unrelated employee, inactive employee, cross-tenant admin,
  anonymous and service-role paths. Existing loop/parallel/handoff suites pass.
- Core: `pnpm.cmd --filter @jewelos/core exec vitest run src/fms src/notifications
  --maxWorkers=1`: 181 passed.
- Data: `pnpm.cmd --filter @jewelos/data exec vitest run src/fms --maxWorkers=1`:
  60 passed.
- Web: focused context, assigned page, FMS page, task card, Home and Notifications
  Vitest files: 52 passed (20-second per-test timeout, one worker).
- Web/core/data typechecks, web production build and standalone E2E syntax check
  passed. New/changed PL/pgSQL functions have no plpgsql_check diagnostics.
- `node scripts/fms-operational-e2e.mjs`: actual Task, Home, Notification and direct
  links show previous answers before the current form; phone 390x844 and desktop
  1440x900 rendering; private file upload/sign/download; cancel, handoff and
  concurrent idempotent retry; builder/canvas and non-writing simulation passed.
  Browser connector failed to initialize (missing kernel-assets path), so the
  repository Playwright workflow provided rendered evidence instead.
- Independent read-only review: no remaining critical or important findings.

## Authorized hosted release

Owner authorized main publication and necessary migrations, and explicitly chose
only production `jewelos-prod` (`yimafxhuwgfhvzczqqdd`) instead of separate staging.
Preflight found production through 0288 and only 0289 pending; no seeds or roles.
Latest physical backup confirmed COMPLETED at 2026-10-16T20:24:16.702Z.
No synthetic fixtures, production form submissions or customer data are used for
hosted verification. Signed-in production staff retry remains an owner check.

Rollback: previous compatible web build at 95b9235; database fixes are forward-only.
The migration preserves existing stored data and adds the new read contract before
web publication. Hosted ledger, CI and Vercel outcomes are recorded separately in
ignored release evidence; Git publication alone does not prove hosted delivery.
