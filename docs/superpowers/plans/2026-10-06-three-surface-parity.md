# Three-Surface Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Complete every working web workflow on phone web and Android and make committed changes visible across all three surfaces.

**Architecture:** Retain the existing responsive React web app and React Native Android app, with shared pure business rules in core and typed Supabase access in the API/data layers. Extend existing refresh and navigation contracts rather than adding another backend. Keep the approved CRM WebView and two-project architecture.

**Tech Stack:** TypeScript, React/Vite, Expo/React Native, React Navigation, Supabase, Vitest, pgTAP, existing shared packages and tokens.

**Spec:** `docs/superpowers/specs/2026-10-06-three-surface-parity-design.md` (approved).

**Status:** Approved for inline execution. Refresh, routing, assignment-field and draft-protection work is underway. Full action-level, rendered, device and production acceptance is still outstanding.

**Progress (2026-10-06):** Shared coordination and native operational refresh are implemented. Settings/inbox/auth/checklist protection, exact incoming paths, FMS assignment fields, native Forms authoring gaps, task upload recovery and Dropdown Master freshness are implemented and locally checked. Permission-editor refresh and stale-result protection are covered by six rendered tests; migration 0198 corrects a reproduced metadata enum collision without changing authorization. Task 7 has 70 authenticated route-width checks and a real local desktop/phone settings propagation scenario. CRM worktree is reconciled to committed client paging; Task 8 is in progress. Device/action-level/hosted/integration/release acceptance remains open. Exact evidence: `docs/MOBILE_PARITY_ACCEPTANCE_2026-10-06.md`.

**Scope clarification:** The demonstrated role-metadata collision is part of Task 3's permission parity. Extend the existing 0156 collision/authorization suite and replace only its RPC metadata expression in forward migration 0198; exercise it transactionally without applying unrelated pending migrations. Generated types and grants remain unchanged.

## Global Constraints

- Preserve existing functioning behavior, historical records, assigned-work IDs, pinned form versions and submitted-time snapshots.
- Keep each record in its home Supabase project. CRM contributions use the existing audited outbox/inbox protocol.
- Keep protected writes audited and server-authorized. Never weaken RLS or expose credentials/customer data in logs, fixtures, Git or chat.
- Keep reusable rules in `packages/core`; typed Supabase I/O stays in existing API/data layers.
- Use existing semantic tokens and components. CRM keeps its approved original presentation and embedded web route.
- Use 320, 360, 390 and 430 CSS pixels for phone-web inspection, plus compact height, keyboard and browser zoom.
- Preserve dirty drafts, scroll and selections during background refresh. Never equate a notification read action with completing work.
- Forward-only migrations require generated types and authorization tests. No schema change is initially needed for client refresh coordination.
- Preserve all concurrent changes. CRM edits follow `C:\crm` and its maintained production runbook.
- Run commands from the authoritative repository root; use `pnpm.cmd` and mobile's separate `npm.cmd --prefix apps/mobile` installation.
- Publish Android only through `scripts/release-mobile.ps1` after required gates; do not use `-Mandatory` without explicit approval.
- A slice passing tests does not complete this project. Every inventory row needs action-level and rendered evidence.

## Review Focus

1. A slow reload plus multiple signals must not launch overlapping background requests or lose a final refresh (Tasks 1-2).
2. Returning after missed events must catch up without overwriting a dirty editor or retaining another user's content (Tasks 2-3).
3. A cold-start assigned-work link must retain starter/stage identity and refuse unauthorized direct entry (Task 4).
4. Attachment failure after successful task creation must retry against the created task, and immutable submission history must survive template changes (Task 5).
5. CRM contributions may still be pending across projects; all surfaces must show truthful state rather than fabricate completion or write another project's records (Task 8).

## Task 1: Shared refresh coordination and reconnect transport

**Files:** Create `packages/core/src/realtime/refreshCoordinator.ts` and its `.test.ts`; export through `packages/core/src/index.ts`. Modify `packages/data/src/realtime/api.ts`, its test, `apps/web/src/features/realtime/api.ts`, its test, and `apps/web/src/features/realtime/useTenantRealtimeRefresh.ts` and its test.

**Interfaces:** Preserve `subscribeToTenantRealtime(tenantId: string, topics: readonly TenantRealtimeTopic[], listener: () => void): () => void`. Add `createRefreshCoordinator(refresh: () => Promise<void> | void, debounceMs = 350): { request: () => void; dispose: () => void }` in core. Supabase subscription status is a catch-up signal, never authorization or record data.

- [ ] Write fake-timer tests asserting a burst produces one reload; a burst during an unresolved reload produces exactly one follow-up; rejected reloads permit later retries; dispose cancels pending work and prevents queued follow-ups. Include `expect(refresh).toHaveBeenCalledTimes(1)` before resolving the first request and `2` after advancing the follow-up timer.
- [ ] Run `pnpm.cmd --filter @jewelos/core exec vitest run src/realtime/refreshCoordinator.test.ts`; expect RED because the coordinator does not exist.
- [ ] Implement the coordinator with one in-flight request and one queued follow-up, bounded debounce, rejection containment and disposal. Do not cancel a committed mutation or store business records.
- [ ] Add data transport tests: matching topics only, isolated tenants, successful resubscription notifies registered observers, removed listeners stay removed, malformed payloads ignored and last observer removal tears down the channel. Run `pnpm.cmd --filter @jewelos/data exec vitest run src/realtime/api.test.ts`; new reconnect assertion must fail first.
- [ ] Add the status callback to the existing shared transport. Replace the web transport duplication with a thin re-export of the shared API; update the web API tests to exercise the shared client initialization boundary. Keep its existing import path compatible.
- [ ] Refactor the web refresh hook onto the coordinator and add focus, visible-document and online wake-ups; preserve effect cleanup and the latest callback reference. Add hook tests for each wake-up, unmount and tenant change. A hidden tab should catch up on visibility restoration.
- [ ] Run focused core/data/web tests and `pnpm.cmd --filter @jewelos/data typecheck`, `pnpm.cmd --filter web typecheck`; expect all PASS. Inspect shared transport consumers before committing only named paths.

## Task 2: Native refresh lifecycle and operational screens

**Files:** Create `apps/mobile/src/lib/useTenantRealtimeRefresh.ts` and a pure `refreshLifecycle.ts` adapter with `.test.ts`. Modify native screens `HomeScreen`, `DashboardScreen`, `TasksScreen`, `TaskDetailScreen`, `FmsScreen`, `FmsTasksScreen`, `FmsInstanceScreen`, `FmsStageScreen`, `FormsLibraryScreen`, `FormSubmissionsScreen`, `FormSubmissionScreen`, `RecurringTodoScreen`, `TaskControlScreen`, `AvailabilityScreen`, `UsersScreen`, `DropdownMasterScreen`, `AssigningLeftScreen`, and `navigation/AppTabs.tsx` where existing subscriptions can use the same lifecycle.

**Interfaces:** Native hook matches the web hook's `{ tenantId, topics, refresh, debounceMs? }` options and returns `void`. Pure adapter takes injected subscribe/focus/foreground/connectivity registrations and a coordinator, returning a single cleanup. Use existing `useAsyncData.refresh`, not its initial-load `reload`, for background invalidation.

- [ ] Write adapter tests with fake event registrations proving foreground and reconnect catch-up, inactive-route deferral, route return, burst coalescing through Task 1, and removal of all listeners. Run `npm.cmd --prefix apps/mobile run test -- src/lib/refreshLifecycle.test.ts`; expect RED.
- [ ] Implement the adapter and native hook using existing React Navigation focus, `AppState` and NetInfo capabilities. Avoid duplicating app-level connectivity registrations per row; subscriptions are owned by screens/hooks, not rendered items. Resume refresh only for still-authorized mounted screens.
- [ ] Wire FMS screens to FMS/forms/organization, task/recurring/control screens to tasks/forms/organization, form screens to forms/tasks/FMS as needed, and Availability to organization/tasks. Verify each topic against actual mutation triggers, including `0102_tenant_realtime_refresh.sql` and later migrations.
- [ ] Replace existing direct native screen subscriptions with the shared hook where safe. Keep Task Detail remarks and attachments refreshed together; keep FMS console return-from-builder behavior and eliminate redundant initial refreshes.
- [ ] Extend adapter tests for profile/tenant replacement and cleanup during an active request. Run mobile tests/typecheck and shared realtime tests; expect PASS. Verify loaders still use existing RLS/RPC APIs and commit named paths.

## Task 3: Settings, permissions, notifications, exports and draft safety

**Files:** Native `SettingsScreen.tsx`, `PermissionManagementScreen.tsx`, `ReportsScreen.tsx`, `NotificationsScreen.tsx`, `features/notifications/NotificationAdmin.tsx`, `features/availability/LeaveApplications.tsx`, `auth/AuthProvider.tsx`; corresponding web settings/reports/notifications/leave views and `auth/AuthContext.tsx`; existing `packages/data/src/notifications/api.ts`, reports, settings and leave APIs/tests.

**Interfaces:** Preserve specialized inbox subscriptions and export progress polling. Use Task 2's hook for applicable tenant topics; add lifecycle catch-up for sources not covered by tenant topics. Preference refresh remains separate from access refresh. Editor draft values and optimistic versions remain owned by the editor.

- [ ] Inventory these loaders, subscriptions and server signals; record actual table/RPC/topic links in the audit. Read corresponding API tests and migrations before changing any interface.
- [ ] Add failing tests proving a preference change on another surface is reloaded, a background inbox catches up, and export history picks up a completed job after foreground return. Reuse existing injected lifecycle tests for the wake-up mechanism; do not claim they render native screens.
- [ ] Add draft tests proving remote refresh preserves unsaved values and surfaces existing optimistic-version conflicts. For settings, replace unconditional data-to-draft resetting only where it would erase an active edit.
- [ ] Implement lifecycle catch-up with the existing authorized loaders. Keep old inbox and export behavior, do not add unsupported tenant topic names, and do not reload full permission editors over dirty values.
- [ ] Run existing notification/settings/report/leave focused tests, mobile tests and affected typechecks. Render settings and leave in both web viewports; native verification is recorded separately. Commit scoped paths.

## Task 4: Incoming URLs and exact assigned-work routing

**Files:** Native `navigation/RootNavigator.tsx`, `navigation/types.ts`, `navigation/shellModel.ts` and tests, `features/fms/assignedWorkNavigation.ts` and tests, `app.json`, and `features/crm/CrmWebViewScreen.tsx` / bridge tests only if needed. Core assigned-work paths remain authoritative; create a native incoming-link adapter and pure tests alongside navigation.

**Interfaces:** Parse supported incoming web/native URLs into existing typed native destinations. Use `parseFmsAssignedWorkPath` followed by `fmsAssignedWorkRoute`; do not invent a second FMS parser. Ordinary links use the existing shell path/permission resolver. Unknown origins and malformed identities are rejected. CRM links must retain their path in the approved embed.

- [ ] Trace manifest intent filters, configured scheme (`jewelos`), public web origin and native routes. Establish which URLs are already supported and avoid intercepting arbitrary HTTPS hosts.
- [ ] Write RED tests for starter, stage form, stage and task identities; malformed/foreign URLs; same form backing two assignments; signed-out pending link; warm/cold launch and denied section entry. Include exact starter and instance-stage IDs in assertions.
- [ ] Wire cold/warm URL handling through the existing navigator, deferring protected dispatch until session restoration and access resolution. Clear pending links on user switch/logout. Do not expose session tokens in URLs.
- [ ] Run shell/assigned-work/bridge tests plus `FmsAssignedWorkPage` and core path tests. Verify every supporting screen loads authorized records and handles missing records without falling back to another user's work. Commit reviewed paths; test installed Android dispatch in Task 9.

## Task 5: Tasks, recurring work, FMS, Forms and submission parity

**Files:** Current web task/composer/import/recurring/control/FMS/Forms pages and components; their mapped native screens in the audit; `packages/core/src/fms/engine.ts`, forms/assignment/path/card/import rules; `packages/data/src/fms/api.ts`, forms/tasks/import APIs and corresponding tests. Add core FMS assignment-field selection helpers and tests only if not already present.

**Interfaces:** Retain current audited mutation payloads and typed results. Expose `sla.assignmentFieldKey` through both FMS stage editors, using required, shown, unconditional `user_dropdown` fields from the selected linked form. Explicit stage assignees override form-selected defaults under migration 0193. Preserve transactional form submission/progression.

- [ ] Compare every action in the Tasks/Recurring/Task Control/FMS/Forms audit rows. Record each field/filter/action and its existing web/native handler, shared rule and server RPC. A discovered behavioral mismatch must have a reproducible scenario before its scoped fix.
- [ ] Add RED tests for assignment-field eligibility, round-trip preservation on both builders, form switch leaving an invalid selection actionable, and publish errors focusing the affected control. Assert optional/hidden/conditional/non-User fields are not eligible. Extend existing web editor tests and native pure builder/controller tests.
- [ ] Add both builder controls using one shared eligibility rule. Preserve stored invalid values for explicit correction rather than silently retargeting work. Validate with current core and server checks. Run existing 0193 pgTAP when local DB is available; confirm hosted migration state separately before rollout.
- [ ] For each other discovered omission, extend the existing shared rule/API and native/web presentation narrowly. Add a failing behavior test before changing it. Cover task creation attachment retry without duplicate creation, voice ambiguity, watcher access, open FMS feed visibility, immutable/deleted form snapshots and explicit form-version selection.
- [ ] Run the applicable existing suites plus full core/data/mobile tests and web task/FMS/forms tests. Inspect desktop and all four phone widths; run the touch canvas, form keyboard and assigned-work walkthrough in Task 9. Commit each independently verified feature slice.

## Task 6: Remaining administration and reporting parity

**Files:** Native/web Users and hierarchy, Availability/leave, Reports, Dropdown Master, Settings/permission management, daily-checklist and profile components; current core permission/leave/settings/report contracts and data APIs/tests. Relevant pgTAP suites remain authoritative for direct-access denial.

**Interfaces:** Every current web action must have the same native permitted operation and server contract. Do not replace centralized `hasPermission` resolution with new role sets. Office leave visibility and review authority stay separate; no identity retirements or destructive roster reconciliation are authorized here.

- [ ] Complete an action comparison for each remaining inventory row, including direct entry, overrides, settings versions, account status, hierarchy filters, leave handover/half-days, report retry/cancel/download, dropdown dependencies and checklist gate/back behavior.
- [ ] For every confirmed omission, add the failing existing-suite case first, implement the smallest missing control/handler using its current audited API, and run focused success/denial checks. Existing matched actions need regression evidence rather than a second implementation.
- [ ] Perform role/override direct-API checks with corresponding local pgTAP suites where contracts are touched; test user-visible denied states separately. Preserve contact/history and immutable leave evidence.
- [ ] Run relevant broader suites/typechecks and render phone/native controls. Record action-level results and commit reviewed paths. Do not label a section complete when its device checks remain pending.

## Task 7: Phone web and native interaction verification

**Files:** Existing web shell/dialog/picker/table/Form/FMS components and native `ui/Screen.tsx`, `ui/ListScreen.tsx`, sheets/fields/pickers and affected feature components. Create `docs/MOBILE_PARITY_ACCEPTANCE_2026-10-06.md` for synthetic scenario results and evidence references.

**Interfaces:** Preserve features and tokens. Fix demonstrated clipping, scroll, keyboard, back/history and accessibility problems in existing primitives only after inventorying their consumers. No visual redesign or arbitrary new design system.

- [ ] Use the available browser-control skill/tool if present; otherwise follow the frontend-testing fallback. Inspect authenticated synthetic routes at desktop and 320/360/390/430 pixels, landscape/compact height, zoom, light/dark and keyboard open. Record overflow and inaccessible-action reproductions.
- [ ] Test native large fonts, TalkBack labels, safe areas, Android back and keyboard, virtualized directories, canvas/touch interactions and nested sheets on the designated emulator/device. Attachments/voice/import need permission-denial and interruption scenarios.
- [ ] Add focused regression tests for demonstrated shared-component problems where they can assert meaningful behavior; make scoped fixes and rerun all affected consumer suites. Record manual-only evidence for gestures and OS behavior.
- [ ] Fill the acceptance record with per-scenario status: source, automated, browser, device and hosted. Leave unsupported evidence explicitly pending; never substitute a test count for rendered results.

## Task 8: CRM parity and two-project freshness

**Files:** In the required CRM worktree, `packages/crm-ui/src` route/loaders, existing `packages/crm-ui/tests`, CRM sync tests/functions/migrations only if a verified missing signal requires them. Native embed/bridge files belong to the app integration. Preserve concurrent client paging changes.

**Interfaces:** Retain approved original CRM parity and the login bridge; CRM-project records are authoritative. Trace each query/mutation's invalidation and reconnect behavior. Reuse existing audited sync event IDs, delivery/retry and idempotency contracts.

- [ ] Verify CRM transition state with the maintained design/runbook and current source before editing. Compare all CRM routes at desktop, phone width and the embed, including clients/leads/families/referrals/queue/visits/follow-ups/documents, exact destinations, back and login expiry.
- [ ] Add RED tests for query catch-up after a remote CRM mutation, dirty-form preservation, and pending/failed walk-in-to-task contributions using synthetic records. Assert retries reuse the current event identity and cannot create duplicate JewelOS work.
- [ ] Implement scoped CRM freshness using the existing CRM client/authorization boundary. If a server signal is needed, specify its minimal grants, RLS, audit and generated-type impact in a new reviewed forward migration; never add new features to JewelOS's retired CRM schema.
- [ ] Run CRM focused/full tests, relevant sync function tests and both projects' applicable local authorization suites. Perform owner-present hosted checks only under the runbook. Integration/release must respect its ordered cutover; record any remaining external dependency rather than merging that branch early.

## Task 9: Cross-surface acceptance, review and Android release

**Files:** Acceptance record, audit/matrix, release evidence and official release script outputs. Stage only the implemented named paths and documents; leave unrelated CRM changes untouched.

**Interfaces:** One persisted work item must be reachable from Home, Notifications, Tasks and direct URL on each surface. Completion is durable server state and notification closure is server-derived. Release preserves package `com.jewelos.mobile`, signer and monotonically increasing versionCode.

- [ ] For each mutable workflow, write the same synthetic scenario on desktop, phone web and Android in turn. Observe exact IDs/status/history/attachments/counts on the other two. Repeat with background/offline observer, concurrent edit and duplicate-tap retry. Verify unauthorized actors cannot bypass restrictions through direct URL/API/native entry.
- [ ] Run required gates: core/data/web/mobile tests; `pnpm.cmd exec turbo run typecheck --force --concurrency=1`; `npm.cmd --prefix apps/mobile run typecheck`; `pnpm.cmd exec turbo run build --force --concurrency=1`; relevant Android bundle/build; pgTAP/lint for backend changes; scoped whitespace and credential-safe scans. Read every result. Do not reset or seed a hosted project.
- [ ] Review the complete diff against the approved design, action matrix and protected workflows. Follow the chosen execution method's whole-branch review; fix material findings with failing tests and rerun affected gates.
- [ ] Read the full production playbook and mobile release guide; confirm Git root, branch/worktree and compatible production integration. Commit only reviewed named paths. Do not release from an unmerged CRM transition branch or silently publish concurrent work.
- [ ] Once all required gates and integration conditions pass, run `scripts/release-mobile.ps1` from the repository root, push the reviewed release commit to `origin/main`, and verify public `latest.json` plus APK identity/signature/package/version/checksum. Do not ask again for routine release approval; stop on a failed required gate.
- [ ] Record local, browser, device and hosted evidence separately. Update the parity matrix only for proven actions. Report exact remaining blockers if a required device/hosted gate is unavailable; the full parity project stays incomplete.

## Self-review and dependencies

- Tasks 1-3 implement refresh/catch-up/draft safety; Task 4 owns exact incoming identity; Tasks 5-6 cover all functional inventory rows; Task 7 covers responsive/device behavior; Task 8 preserves CRM authority; Task 9 owns live propagation, authorization and release evidence.
- Task 2 consumes Task 1's coordinator and existing transport. Tasks 3/5/6 consume Task 2's native hook. Task 4 retains existing shared path types. No new mutation signature is prescribed without its source contract.
- Initial source findings are actionable now. Later action comparisons deliberately select changes from reproduced gaps; they do not assume the entire native app is absent or preauthorize adjacent features.
- The user approved this plan and chose inline execution. Implementation/evidence is tracked above and in the acceptance record; unfinished action-level, device, hosted and release gates remain open.
