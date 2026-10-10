# Task Scale and Management Implementation Plan

> Use executing-plans to implement each task with failing and passing checks.

**Goal:** Make tasks scale and give administrators audited management while
enforcing proof for imported Tasks on web and Android.

**Architecture:** A narrow server page returns task IDs and complete counts;
existing bounded detail hydration supplies at most 50 cards. Audited task RPCs
use the existing permission resolver and tombstones preserve evidence/history.

**Tech stack:** PostgreSQL/Supabase, pgTAP, TypeScript, React, Expo, Vitest.

**Spec:** ../specs/2026-10-10-task-scale-and-management-design.md

## Global constraints

Work in the authoritative checkout; preserve concurrent edits. Forward-only
migrations 0208, 0210 and 0211 (0209 belongs to concurrent dashboard work). Keep watcher-only completion restrictions, FMS assignment
identity, private Storage, existing imports/fingerprints and historical records.
Use `tasks.view_all` for admin management; never accept client-supplied roles.

## Review focus

Test multi-assignee duplicates across page boundaries, FMS with no/future date,
staff requesting All Tasks, an exact retry after series deletion, and a direct
completion write without proof. Test stale client responses after switching tabs.

## Task 1: Database contracts

- [x] Add pgTAP tests for page/count authorization, deletion/editing, imports,
  Storage proof and re-import, and run them before adding migrations 0208, 0210 and 0211 (0209 belongs to concurrent dashboard work).
- [x] Add `task_feed_page(p_view,p_status,p_offset,p_limit)` returning JSON IDs,
  counts and total; selected view and status are validated and actor resolved
  once. Page size maximum 50; return unique IDs with deadline/id ordering.
- [x] Add `admin_edit_task_with_audit(uuid,jsonb)` and
  `admin_delete_task_with_audit(uuid,boolean,text)`, tombstones and audit entries.
- [x] Enforce imported proof on writes, repair unfinished import records,
  preserve row fingerprints, and retire deleted retry identities with originals.
- [x] Apply locally, run focused pgTAP, regenerate both database type files.

## Task 2: Typed shared page access

- [x] Test strict page response validation, bounded hydration, complete counts
  and empty pages in core/data/web tests.
- [x] Add shared page types/decoder to core; add typed `loadTaskPage` and admin
  mutation methods to both API layers. Existing loadTaskFeed remains compatible
  and gains a bounded `recordIds` option for hydration.
- [x] Run focused core/data/web tests and typecheck.

## Task 3: Web and native clients

- [x] Test selected-tab page loading and management UI, no whole-board details
  lookup, and late response isolation.
- [x] Load only the selected tab/status; use server totals and Previous/Next
  controls, retaining retry/realtime refresh. Add All Tasks for admins.
- [x] Load form definitions on demand. Add shared-field task edit/delete
  controls and explicit series confirmation on web and native.
- [x] Native details load only their persisted identity. Background recurring
  preparation refreshes a page only when it creates records.
- [ ] Run core/web/mobile tests, typechecks, build, database contracts and
  rendered desktop/phone QA. Record evidence and limitations.
  Automated tests/typechecks/build passed; browser/device gates remain open.

## Task 4: Review and release

- [x] Inspect scoped diffs and credential-safe scan; run regression checks.
- [ ] Follow production playbook and Android guide; stop at a failed required
  gate. Do not publish an unverified APK or overwrite concurrent branch work.

## Execution ledger

Owner approved the design and authorized implementation. Execute inline in the
required repository directory. The initial dirty changes were committed by
concurrent work before this execution; current branch is ahead of its remote.


Implementation notes:

- Admin deletion uses durable tombstones; single occurrence deletion keeps its
  schedule usable. Completed series history, private objects and import originals
  are retained. SQL guards enforce proof and prevent deleted work from changing.
- 0210 filters operational definer reads; 0211 skips tombstones in coverage,
  schedule edits and import repair, and acknowledges later CRM sync events.
- Independent review found schedule/coverage/CRM mutation callers that needed
  tombstone handling. These findings were fixed and tested. The reviewer could
  not finish its remaining review because its session usage limit was reached.
- Generated task columns, RPC/helper signatures and live views were merged into
  both type files without replacing unrelated newer baseline types.
- Local timing: ten page queries over 10,121 pending synthetic tasks averaged
  74.92 ms in the isolated database. This is SQL timing, not hosted/render timing.
- Remaining gates: real rendered desktop/narrow-width browser QA (browser execution
  tool is unavailable), visual Android phone QA (adb lists no devices), staging
  migration/web verification, main integration and signed APK publication.
  Current branch is feat/department-section-access; no hosted writes or release.

Validation evidence is recorded in docs/TASK_SCALE_VALIDATION_2026-10-10.md.

## Authorized Task Control follow-up

Owner requested adding/editing/deleting work from the filtered Task Control
workspace, particularly after selecting an employee. This bounded extension
reuses the existing creator forms and audited admin task RPCs:

- Add a management action on each non-FMS assigned task; load just its persisted
  instance when selected and reuse TaskAdminControls inside a dialog/sheet.
- Gate the action with the central tasks.view_all permission; keep server
  authorization, whole-series deletion and completed history behavior unchanged.
- Prefill new-task assignee from the selected employee without changing editing
  defaults or existing callers. Keep scope filters after save/delete and reload
  totals, templates and task rows; reset pagination to the first page.
- Cover selected-ID reads, late responses, unavailable records, action visibility,
  employee prefilling and existing confirmation behavior. Check web/native types,
  builds and related tests; leave concurrent FMS work untouched.
- No schema, generated type, RPC, RLS, Storage or audit changes. Signed Android
  publication still requires the phone gate; adb currently lists no devices.
