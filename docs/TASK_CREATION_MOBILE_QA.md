# Task creation improvements — 2026-10-22

The owner approved a bounded update to the existing Create Task flow, then
added the request to simplify the voice speaking guide.

## Scope and implementation

- TaskComposer, TasksPage and GlobalVoiceTaskComposer offer recurring/as-needed
  creation to active task authors. Existing assignment permissions, recipient
  scope and protected management accounts still apply in Postgres.
- Migration 0341 expands creation of named-user schedules through the existing
  audited save functions. Editing existing templates and creating role-wide
  templates retain their previous management restriction. Both creation entry
  points assert the catalog-backed Tasks page (`checklist_tasks`). There are no
  table, RLS, Storage, RPC-signature or generated-type changes. Audit writes and
  first-occurrence creation remain in the existing save transaction.
- Create Task uses an opt-in full-screen mobile Modal with visualViewport
  resize/scroll handling. Other Modal consumers keep their existing layout.
  Height changes do not animate: scrolling the focused field is deferred until
  the resized layout applies, with room for the sticky header and actions.
  The task form no longer opens the keyboard automatically on entry.
- Due Date has Today/Tomorrow, separate date/time controls and Done. Users has
  search, selected names/removal controls and Done. Selector panels no longer
  introduce an additional enclosing scroll region.
- ScheduleFields is shared with Task Control. Repeats is Daily, Weekly,
  Monthly, Quarterly, Annually or Custom. Simple choices follow the start date;
  custom and unrecognized stored rules retain their explicit configuration.
  End schedule and upcoming dates are expandable. Existing schedules/history
  are not migrated or rewritten.
- Voice guidance retains the ordered headings, Required/Optional labels and
  the example, with larger text and without the per-field explanations.
- Kiara's app help and review checklist describe the exact controls. No new
  Kiara read tool is needed: these are authoring controls for existing data.

## Local evidence

- `pnpm.cmd --filter @jewelos/core test`: 97 files / 1,144 tests passed.
- `pnpm.cmd --filter web exec vitest run --maxWorkers=2`: 123 files / 606 tests
  passed. An earlier run caught the changed title placeholder; its original
  placeholder was restored and the full suite rerun successfully.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1`: six packages passed.
- `pnpm.cmd exec turbo run build --force --concurrency=1`: six packages passed.
  Existing chunk-size and CRM Turbo-output warnings remain.
- Focused Modal/composer/schedule/voice/API tests cover viewport resizing and
  panning, staff creation controls, date/time selection with explicit Done,
  weekly/quarterly/annual/custom patterns, retries, voice interpretation and
  avoiding the management-only materialization request after an atomic save.
- Database suites 0341, 0340 and 0228 ran against local
  `supabase_db_jewelos-fms-workspace` using `psql -v ON_ERROR_STOP=1 -At`.
  Each run began a transaction, applied 0340 and 0341 to the existing 0319
  schema, ran the named pgTAP file, and rolled back. No linked command or
  permanent local migration application was used. These tests cover active
  staff/HR/CRM/doer/housekeeping creation, admin/manager compatibility,
  permissions, management recipients, cross-tenant/department/branch denial,
  direct lower-level RPC denial, inactive/anonymous/service callers, preserved
  template-edit restrictions, audits and atomic first occurrences: 28 + 42 + 18
  assertions passed (88 total).
- Playwright used the actual `/tasks` route on `http://127.0.0.1:5187`, real
  local Supabase authentication and temporary synthetic admin/staff accounts.
  Browser plugin unavailable. Checked 320×844, 390×844, 430×844 and 1440×1000:
  nonblank page, no framework overlay, user/date Done interactions, quarterly,
  weekly, annual and custom controls, selected names and protected-user hiding.
  A simulated keyboard resize to 390×420 retained the draft, kept the form
  inside the viewport, and kept the focused title visible at y=279–323 (clear
  of the header and bottom actions). No form-rendering exceptions occurred. The local stack has no
  running Edge Function/realtime services; recurring-preparation promise rejections and 403/503/WebSocket diagnostics
  were observed separately from the form checks. Browser QA did not submit
  work; persistence/authorization evidence is from pgTAP.
- Temporary browser accounts, their tenant and automatically seeded settings
  were removed after QA; zero fixture tenants/auth users remain. Tenant-delete
  realtime emission references its deleted parent, so the tenant's realtime
  trigger was disabled and restored within the single local cleanup transaction.
  Its enabled state was verified afterward. No hosted account/data was touched.
- `adb devices`: no connected devices. Physical Android keyboard behavior is
  not proven by browser resizing or jsdom visualViewport tests.

## Release boundary

No commit, GitHub push, hosted migration or web deployment was performed.
Apply forward migration 0341 with the reviewed web release, following the
production playbook and linked-ledger preflight. Web/shared changes reach the
Android web shell through that web deployment; no APK change is required.
