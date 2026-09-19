# Complete Native Mobile Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver every currently web-implemented JewelOS feature as a secure, responsive React Native Android workflow, beginning with the missing Create Task action and ending with an authenticated standalone APK walkthrough.

**Architecture:** Keep business decisions in `packages/core` and all Supabase access in `packages/data`; web and native presentation consume those shared contracts. Add dedicated native stack screens for complex authoring, imports, CRM, Forms review, and hierarchy views; retain sheets only for bounded edits. Every sensitive mutation continues through its existing audited RPC/Edge Function and RLS remains the authorization boundary.

**Tech Stack:** React Native 0.86, Expo SDK 57, React Navigation 7, TypeScript 5.9, Vitest 4, Supabase, `@jewelos/core`, `@jewelos/data`, `@jewelos/ui-tokens`, `expo-audio`, `expo-document-picker`, `expo-file-system`, Android Gradle.

**Spec:** `docs/superpowers/specs/2026-09-19-complete-native-mobile-parity-design.md`

## Global Constraints

- Android is the release target; no WebView, Capacitor, Cordova, Ionic, fake backend, demo fallback, or offline business-record database.
- Preserve all web behavior and all current native routes, exact record identifiers, permissions, deep links, theme, safe-area behavior, and server authorization.
- Use `hasPermission` for native affordances and existing audited RPC/Edge Function contracts for writes.
- Never expose voice audio/transcripts, workbook rows, PII, secrets, signed URLs, or credentials in logs, analytics, fixtures, terminal output, or commits.
- Validate upload/import MIME, extension, size, scope, cleanup, and retry behavior before bytes reach Storage or an Edge Function.
- Migrations are forward-only and require generated types plus pgTAP authorization coverage. No migration is planned unless a verified parity blocker requires an additive contract.
- Preserve unrelated dirty work in the main checkout. Work only on `feat/complete-native-parity` in `.worktrees/complete-native-parity` and stage named paths.
- Use `pnpm.cmd` for workspace packages and `npm.cmd --prefix apps/mobile` for the separately installed native app.
- Every behavior change follows RED -> GREEN -> refactor. Pure `.ts` tests do not replace installed-device proof for rendered native interactions.

## Review Focus

- A task whose initial attachment upload fails after creation must remain one created task with a retryable attachment failure, never a duplicate task.
- Voice permission denial, zero-byte recording, timeout, and interpretation failure must leave the manual composer usable and must not retain audio.
- Import identity must never be guessed from names, partial emails, spreadsheet fill-down, or previous rows; unresolved mappings remain blocked or Assigning Left.
- Historical form submissions must render their immutable submitted-time snapshots after template revision, archive, or deletion.
- Direct native navigation and every RPC mutation must remain denied for unauthorized, inactive, cross-tenant, and out-of-scope actors.

---

### Task 1: Shared Manual Task Draft Contract and Native Create Task

**Files:**
- Create: `packages/core/src/manualTaskDraft.ts`
- Create: `packages/core/src/manualTaskDraft.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/src/features/tasks/TaskComposer.tsx`
- Create: `apps/mobile/src/features/tasks/TaskComposerScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/TasksScreen.tsx`
- Test: `apps/mobile/src/navigation/shellModel.test.ts`

**Interfaces:**
- Consumes: `deriveTaskAuthoringCapability`, `normalizeTaskParticipants`, `TaskReferenceData`, `createDelegationTask`, `uploadTaskAttachment`, authenticated profile/access.
- Produces: `buildManualTaskCreateRequest(input): ManualTaskCreateRequest | { error: ManualTaskDraftError }`; native route `TaskComposer`; a visible Create Task action for every authenticated Tasks user.

- [x] **Step 1: Write failing core tests for the task payload and scope**

Add literal fixtures proving task/checklist payloads, one-doer normalization, watcher de-duplication, required form, selected doer organization IDs, due-date validation, checklist validation, and authoring scope. The central assertion is:

```ts
expect(buildManualTaskCreateRequest(validInput)).toEqual({
  payload: {
    title: "Photograph the counter",
    description: "Before opening",
    planned_datetime: "2026-09-20T03:30:00.000Z",
    priority: "high",
    branch_id: "branch-1",
    department_id: "department-1",
    task_type: "delegation",
    requires_upload: true,
    requires_remark: false,
    requires_form: false,
    form_template_id: "",
  },
  doerIds: ["doer-1"],
  watcherIds: ["watcher-1"],
  checklist: [],
});
```

- [x] **Step 2: Run RED**

Run: `pnpm.cmd --filter @jewelos/core exec vitest run src/manualTaskDraft.test.ts --reporter=verbose`

Expected: FAIL because `manualTaskDraft.ts` does not exist.

- [x] **Step 3: Implement and export the shared builder**

Define strict input/output types. Reject blank title, missing doer, invalid/ineligible selected doer, missing/invalid due instant, checklist mode with no non-empty items, and a watcher equal to the doer. Use the selected doer's branch and department; never trust caller-entered organization IDs.

- [x] **Step 4: Refactor web TaskComposer onto the shared builder**

Replace its inline payload construction with `buildManualTaskCreateRequest`. Preserve web copy, voice prefill, toast, attachment behavior, and current RPC call. Run the existing composer suite.

Run: `pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposer.test.tsx src/features/tasks/TaskComposerVoice.test.tsx --reporter=verbose`

Expected: PASS with the existing web behavior unchanged.

- [x] **Step 5: Add native route/navigation RED test**

Extend the navigation test so the registered Tasks action resolves to `TaskComposer` and the route parameter contract has no client-controlled role/scope parameter.

Run: `npm.cmd --prefix apps/mobile run test -- src/navigation/shellModel.test.ts`

Expected: FAIL because `TaskComposer` is not registered.

- [x] **Step 6: Build the native composer**

Use `Screen scroll`, `TextField`, `OptionPicker`, `DateField`, `ToggleField`, and `pickFileFromChooser`. Load `loadTaskAuthoringReferenceData`, compute eligible people with `deriveTaskAuthoringCapability`, and submit the shared request through `createDelegationTask`. If optional attachment upload fails after creation, keep the returned task ID in state and show `Retry attachment`; retry only `uploadTaskAttachment(taskId, file)`.

- [x] **Step 7: Add Tasks entry and background refresh**

Add a safe-area-aware Create Task floating action, navigate to the composer, refresh on route return, and subscribe to `tasks`, `forms`, and `organization` tenant topics without clearing existing data during background refresh.

- [x] **Step 8: Verify and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposer.test.tsx src/features/tasks/TaskComposerVoice.test.tsx
npm.cmd --prefix apps/mobile run test
npm.cmd --prefix apps/mobile run typecheck
git diff --check
```

Expected: all commands exit 0.

Commit: `feat(mobile): add complete native task creation`

---

### Task 2: Native Voice Task Capture

**Files:**
- Create: `packages/data/src/tasks/voice.ts`
- Create: `packages/data/src/tasks/voice.test.ts`
- Modify: `packages/data/src/tasks/index.ts`
- Modify: `apps/web/src/features/tasks/voiceApi.ts`
- Create: `apps/mobile/src/features/tasks/VoiceTaskCapture.tsx`
- Create: `apps/mobile/src/features/tasks/voiceCaptureModel.ts`
- Create: `apps/mobile/src/features/tasks/voiceCaptureModel.test.ts`
- Modify: `apps/mobile/src/features/tasks/TaskComposerScreen.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `VoiceTaskDraft`, `VoiceDraftGap`, `getSupabase`, `expo-audio` recorder/permission APIs, `pickFile` byte conversion pattern.
- Produces: `interpretTaskVoiceNote(file: UploadSource): Promise<VoiceTaskInterpretation>` shared by web/native; native capture states `idle | recording | interpreting | error`.

- [x] **Step 1: Write shared interpretation RED tests**

Test valid response parsing, malformed response rejection, and extraction of the Edge Function's safe body error. The API accepts `UploadSource`, builds multipart data with the file name/type, invokes `interpret-task-voice`, and never logs content.

Run: `pnpm.cmd --filter @jewelos/data exec vitest run src/tasks/voice.test.ts --reporter=verbose`

Expected: FAIL because the shared module does not exist.

- [x] **Step 2: Implement shared API and refactor web shim**

Move response parsing and invocation into `packages/data`. Keep the web file as a re-export plus the browser `File` call site. Confirm existing web voice tests remain green.

- [x] **Step 3: Write native state-machine RED tests**

Cover 60-second ceiling, permission denial, zero-byte result, stop/interruption, interpretation success, and retry. Test pure transitions rather than mocking a rendered native control.

Run: `npm.cmd --prefix apps/mobile run test -- src/features/tasks/voiceCaptureModel.test.ts`

Expected: FAIL because the model does not exist.

- [x] **Step 4: Install and configure Expo audio**

Run from `apps/mobile`: `npx expo install expo-audio`.

Configure the plugin with a JewelOS-specific microphone explanation, remove `android.permission.RECORD_AUDIO` from `blockedPermissions`, add it to `permissions`, and ensure the generated Android manifest no longer removes it. Use the Expo SDK 57-compatible version selected by `expo install`.

- [x] **Step 5: Implement native capture**

Use `requestRecordingPermissionsAsync`, `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })`, `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, and `useAudioRecorderState`. Stop at 60 seconds, read the cache URI into an `UploadableFile`, invoke the shared interpreter, delete the temporary recording in `finally`, then set audio mode back to non-recording. Do not enable background recording.

- [x] **Step 6: Apply interpretation to the composer**

Use the same field-prefill semantics and gap messages as web: supplied values update fields, corrected manual values are not blanked, missing title/assignee/due/checklist stays blocking, and the author reviews everything before `createDelegationTask`.

- [x] **Step 7: Verify native dependency and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposerVoice.test.tsx
npm.cmd --prefix apps/mobile run test
npm.cmd --prefix apps/mobile run typecheck
npm.cmd --prefix apps/mobile exec expo config --type public
git diff --check
```

Expected: tests/typechecks exit 0 and public config includes microphone permission without secrets.

Commit: `feat(mobile): add secure voice task capture`

---

### Task 3: Shared Task Import Engine and Native Import Workspace

**Files:**
- Move to core: `apps/web/src/features/tasks/import/{parseCsv,normalizeRows,legacySheet,identityMappings,correctionReport,outcomeMessage,workbook}.ts` and tests into `packages/core/src/taskImport/`
- Move to data: `apps/web/src/features/tasks/import/{api,chunkRunner}.ts` and tests into `packages/data/src/tasks/import/`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/data/package.json`
- Modify: web import modules into re-export shims
- Create: `apps/mobile/src/screens/TaskImportScreen.tsx`
- Create: `apps/mobile/src/features/taskImport/importSession.ts`
- Create: `apps/mobile/src/features/taskImport/importSession.test.ts`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/TasksScreen.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`

**Interfaces:**
- Consumes: existing web import normalization/identity/chunk behavior, audited import RPCs, `expo-document-picker`, `expo-file-system`, and an Expo-compatible XLSX reader selected as a direct mobile dependency.
- Produces: shared import domain/data modules plus native steps `select -> validate -> map -> review -> run -> result`.

- [x] **Step 1: Move tests first and verify RED imports**

Copy the existing behavior tests into the shared packages with imports pointed at the intended new modules. Add an XLSX ArrayBuffer parsing test and a 1 MiB/500-row rejection test.

Run:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/taskImport --reporter=verbose
pnpm.cmd --filter @jewelos/data exec vitest run src/tasks/import --reporter=verbose
```

Expected: FAIL because shared modules are absent.

- [x] **Step 2: Extract shared import code and keep web shims**

Move platform-independent normalization/hash/report logic to core and Supabase calls/chunk runner to data. Parameterize file-byte decoding so browser `File` and native `ArrayBuffer` feed the same workbook normalization. Keep web files as exports/adapters and run all existing web import tests.

- [x] **Step 3: Write native session RED tests**

Test legal state transitions, unresolved identity blocking, no inferred mappings, interrupted chunk resume coordinates, idempotent replay display, and clearing raw bytes after validation.

- [x] **Step 4: Implement the native import stack screen**

Accept `.csv`, `.xlsx`, and `.xls` through the document picker. Enforce extension, MIME, byte, and row limits before parsing. Present structural issues, explicit identity matching, correction export/share, review totals, bounded chunk progress, history, and an Assigning Left link. Keep raw file bytes and rows in memory only; persist no PII.

- [x] **Step 5: Register guarded navigation**

Show Bulk Import only when the same permission/capability as web allows it. Direct native navigation still loads the screen, checks access, and shows Access denied without invoking loaders when denied.

- [x] **Step 6: Verify and commit**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
npm.cmd --prefix apps/mobile run test
npm.cmd --prefix apps/mobile run typecheck
git diff --check
```

Expected: all commands exit 0.

Commit: `feat(mobile): port complete task bulk import`

---

### Task 4: Complete Native CRM

**Files:**
- Create: `packages/core/src/crmWorkspace.ts`
- Create: `packages/core/src/crmWorkspace.test.ts`
- Modify: `packages/core/src/index.ts`
- Create/modify: `apps/mobile/src/features/crm/ClientEditor.tsx`
- Create: `apps/mobile/src/features/crm/CrmFilterSheet.tsx`
- Create: `apps/mobile/src/features/crm/FollowupActionSheet.tsx`
- Create: `apps/mobile/src/screens/CrmFollowupsScreen.tsx`
- Create: `apps/mobile/src/screens/CrmMergeScreen.tsx`
- Modify: `apps/mobile/src/screens/CrmScreen.tsx`
- Modify: `apps/mobile/src/screens/ClientDetailScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: every export from `@jewelos/data/crm/api`, `deriveCrmCapability`, native picker/browser, shared CRM types/view model.
- Produces: complete directory filters/pagination; create/edit/merge; interaction/follow-up/reassign; document upload/view/remove.

- [ ] **Step 1: Add shared workspace RED tests**

Test literal filter payloads, action availability for active same-branch/assigned actors, stale-version messaging, merge confirmation, follow-up validation, and document metadata validation.

- [ ] **Step 2: Implement shared CRM workspace decisions**

Centralize filter construction and form validation without moving authorization out of the server. Refactor web consumers where they currently own those decisions and run CRM web tests.

- [ ] **Step 3: Implement directory and client editing**

Add every web directory filter and server pagination. Add new/edit client forms with phone duplicate check, validation, dirty guard, exact `record_version`, and safe error text.

- [ ] **Step 4: Implement detail actions**

Add tabs for timeline, walk-ins, follow-ups, documents, and links. Wire interaction logging, follow-up creation/actions, ownership reassignment, private document upload/signed viewing/removal, and refresh after confirmed server success.

- [ ] **Step 5: Implement merge**

Search/select an authorized duplicate, display survivor/duplicate facts, require the shared typed confirmation, call `mergeClients`, and navigate to the survivor after success.

- [ ] **Step 6: Verify and commit**

Run core/data/web CRM tests, complete mobile tests/typecheck, workspace typecheck, and `git diff --check`.

Expected: all commands exit 0.

Commit: `feat(mobile): complete native crm workflows`

---

### Task 5: Complete Native Forms Library and Submission Review

**Files:**
- Create: `packages/core/src/forms/submissionPresentation.ts`
- Create: `packages/core/src/forms/submissionPresentation.test.ts`
- Modify: `packages/core/src/forms/index.ts`
- Modify: `apps/web/src/pages/FormsPage.tsx`
- Create: `apps/mobile/src/screens/FormSubmissionsScreen.tsx`
- Create: `apps/mobile/src/screens/FormSubmissionScreen.tsx`
- Create: `apps/mobile/src/features/forms/FormLifecycleActions.tsx`
- Modify: `apps/mobile/src/screens/FormsLibraryScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `loadForms`, `loadFormDynamicOptions`, `deletedFormBundle`, `reviewSubmission`, `formDeletionImpact`, `deleteForm`, `publishAsNewForm`, existing form builder/fill screens.
- Produces: lifecycle-equivalent Forms Library and snapshot-safe submissions/review screens.

- [ ] **Step 1: Write snapshot presentation RED tests**

Test current template, deleted-template snapshot, missing inaccessible snapshot, option/master display, file answer identity, review state, and grouping by form family/version.

- [ ] **Step 2: Implement shared presentation and refactor web**

Move answer/grouping derivation out of `FormsPage` into core and prove the web Forms tests remain green.

- [ ] **Step 3: Implement library lifecycle parity**

Add every lifecycle filter plus publish-as-new, guarded delete impact/result, archive, duplicate, revise/edit, new form, fill, and submission count behavior. Preserve exact IDs and published-version protections.

- [ ] **Step 4: Implement submissions and review**

Render grouped history and exact immutable snapshots. Open native signed URLs for uploaded answers. Authorized reviewers can approve/reject with optional notes and explicit confirmation; other users receive read-only history.

- [ ] **Step 5: Verify and commit**

Run focused core Forms tests, `packages/data` Forms tests, web Forms tests, mobile tests/typecheck, full workspace typecheck, and `git diff --check`.

Expected: all commands exit 0.

Commit: `feat(mobile): complete forms lifecycle and review parity`

---

### Task 6: Dropdown Master, User Hierarchy, and Remaining Admin Gaps

**Files:**
- Modify: `apps/mobile/src/screens/DropdownMasterScreen.tsx`
- Create: `apps/mobile/src/features/users/OrganizationTree.tsx`
- Create: `apps/mobile/src/features/users/organizationTreeModel.ts`
- Create: `apps/mobile/src/features/users/organizationTreeModel.test.ts`
- Modify: `apps/mobile/src/screens/UsersScreen.tsx`
- Audit and modify when a RED test proves a gap: `apps/mobile/src/screens/NotificationsScreen.tsx`, `apps/mobile/src/features/notifications/NotificationAdmin.tsx`, `apps/mobile/src/screens/ReportsScreen.tsx`, `apps/mobile/src/screens/SettingsScreen.tsx`, `apps/mobile/src/screens/PermissionManagementScreen.tsx`, `apps/mobile/src/features/daily-checklists/DailyChecklistGate.tsx`, `apps/mobile/src/features/daily-checklists/DailyChecklistManager.tsx`, and their existing matching modules under `packages/core/src` and `packages/data/src`.
- Modify: `docs/MOBILE_PARITY_PLAYBOOK.md`

**Interfaces:**
- Consumes: `filterDropdownMasterItems`, dropdown audited mutation, user directory reporting IDs, existing admin permissions.
- Produces: status-filter/delete parity and a filtered, cycle-safe native organization hierarchy.

- [ ] **Step 1: Add Dropdown status/delete RED tests**

Test all/active/inactive filtering through the real shared filter and the delete/deactivate mutation boundary for allowed/denied users.

- [ ] **Step 2: Implement Dropdown parity**

Add the status picker and the same guarded delete behavior/copy as web. Preserve stable values and user-safe constraint errors.

- [ ] **Step 3: Write organization tree RED tests**

Test multiple roots, missing manager, filtered manager, cycle detection, stable ordering, and descendant counts with literal user fixtures.

- [ ] **Step 4: Implement native hierarchy view**

Add List/Organization tabs, reuse current search/status/branch/department filters, render virtualized expandable tree rows, and retain edit actions where permitted.

- [ ] **Step 5: Audit remaining admin screens against current web**

Use an explicit parity matrix of tabs, filters, reads, mutations, denied states, and exports for Notifications, Reports, Settings, permissions, and daily checklists. For every discovered behavioral gap, add a failing focused test before the narrow fix. Record each closed row in `MOBILE_PARITY_PLAYBOOK.md` with source paths and validation evidence.

- [ ] **Step 6: Verify and commit**

Run affected core/data/web/mobile tests, complete typechecks, web build, and `git diff --check`.

Expected: all commands exit 0.

Commit: `feat(mobile): close native administration parity gaps`

---

### Task 7: Cross-Surface Parity, Realtime, Responsiveness, and Accessibility

**Files:**
- Create: `docs/MOBILE_PARITY_MATRIX.md`
- Audit and modify only after a RED test or recorded rendered defect: the current files under `apps/mobile/src/screens/`, `apps/mobile/src/features/`, `apps/mobile/src/ui/`, and `apps/mobile/src/navigation/`, plus the exact matching consumer under `apps/web/src/`, `packages/core/src/`, or `packages/data/src/`.
- Modify: `docs/REGRESSION_CHECKLIST.md`

**Interfaces:**
- Consumes: all prior tasks and every current `IMPLEMENTED_PAGES`/menu destination.
- Produces: a zero-open-gap matrix for screens, actions, permission states, realtime topics, deep links, upload paths, and responsive/accessibility checks.

- [ ] **Step 1: Build the executable parity matrix**

For every web route and supporting workflow, list web source, native source, shared core/data contract, reads, writes, filters/tabs, deep links, realtime topics, allowed/denied roles, upload behavior, and device test. Mark a row closed only from source plus test/device evidence.

- [ ] **Step 2: Add a navigation coverage RED test**

Assert every current implemented menu ID resolves to a non-placeholder native destination and every nested path used by Home/Notifications/Tasks/FMS has an exact typed target.

- [ ] **Step 3: Reconcile realtime and deep links**

Add missing topic subscriptions through the shared realtime API, preserving data during refresh. Exercise exact FMS starter/stage, form submission, CRM client, notification, and task IDs across entry surfaces.

- [ ] **Step 4: Run responsive/accessibility audit and fix findings by TDD**

Check portrait, landscape, compact height, keyboard open, font scale, light/dark, safe areas, sheets, long lists, touch targets, labels/roles/state, error focus, and Android back/dirty guards. Add a focused test for each logic/navigation defect before its fix; record rendered-only findings with screenshots/device evidence.

- [ ] **Step 5: Complete the matrix and regression checklist**

Every web feature must be Closed or explicitly blocked by an external service/device state. A code gap cannot be labeled external.

- [ ] **Step 6: Verify and commit**

Run all core/data/web/mobile tests, all typechecks, web build, Expo Android export, and `git diff --check`.

Expected: all available automated gates exit 0; any unavailable rendered/device gate is named precisely and keeps release incomplete.

Commit: `test(mobile): prove complete cross-surface parity`

---

### Task 8: Android Release and Authenticated Device Gate

**Files:**
- Modify: `apps/mobile/app.json`
- Modify only if release tooling requires: `apps/mobile/android/**` safe configuration files
- Modify: `docs/MOBILE_HANDOFF.md`
- Modify: `docs/MOBILE_RELEASE_GUIDE.md`
- Modify: `docs/MOBILE_PARITY_PLAYBOOK.md`

**Interfaces:**
- Consumes: completed parity matrix, maintained `scripts/release-mobile.ps1`, untracked production signing configuration, connected authorized Android device.
- Produces: versioned signed APK, `latest.json`, signature/install proof, and authenticated role-based walkthrough record.

- [ ] **Step 1: Run the complete pre-release gate**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
npm.cmd --prefix apps/mobile run test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
npm.cmd --prefix apps/mobile run typecheck
pnpm.cmd --filter web build
git diff --check
```

Expected: all commands exit 0 with exact counts recorded.

- [ ] **Step 2: Run database gates only if this branch adds a migration**

Use local Supabase reset, focused and full pgTAP, and local lint. Do not run a linked push without a separate approved release action.

- [ ] **Step 3: Produce release through the maintained script**

Increment `versionCode`/version, then use `scripts/release-mobile.ps1`. Do not hand-roll the release or expose keystore properties. Verify APK contains `assets/index.android.bundle`, application ID is `com.jewelos.mobile`, and signature/certificate matches the established release key.

- [ ] **Step 4: Install and run standalone**

Confirm `adb devices -l`, install with `adb install -r` when signatures match or perform the explicitly documented clean-install path when they do not, launch without Metro, and inspect fatal React Native/Android logs.

- [ ] **Step 5: Execute authenticated role walkthrough**

For representative ordinary, Manager/Process Coordinator, Admin, and Super Admin accounts, verify every permitted section, Create Task/manual/voice/import, completion/forms/FMS deep links, CRM, administration, denied routes, theme, back behavior, background/resume, upload, and sign-out. Use only synthetic or approved test records and remove them through normal audited operations.

- [ ] **Step 6: Record evidence and commit**

Document exact APK/manifest paths, version, hash, signature fingerprint, commands, test counts, device/build identity, walkthrough results, and any external blocker. Keep automated, local database, hosted, Git, release, and device evidence separate.

Commit: `release(mobile): ship complete native parity`
