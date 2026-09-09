# JewelOS Android (React Native) — Audit & Migration Plan

Status: **Phases 1-6 complete and verified; 7-11 implemented, pending device test.**
Progress and validation evidence are recorded in section 6.
Repository authority: `C:\jos` (moved from `C:\Users\MIS\Downloads\MKJewelOS\jewelos`; see the decisions below).

---

## 1. Audit of the existing application

### 1.1 Architecture as it actually stands

| Concern | Reality |
|---|---|
| Repo shape | pnpm workspace + Turborepo. `apps/web`, `apps/mobile`, `packages/{core,api-client,ui-tokens}` |
| Web framework | React **18.3.1** + Vite 8, TypeScript 5.9, Tailwind 3.4 |
| Routing | **No router library.** `usePathname()` in `App.tsx` over `window.history.pushState` + `popstate`; `getPageForPath()` in `@jewelos/core` maps path to `PageId` |
| State | Local `useState` per page + one `AuthContext` + one `ThemeContext`. No Redux/Zustand/React Query |
| Data fetching | Direct `supabase.*` calls in `apps/web/src/features/*/api.ts` (15 modules, ~1,400 lines). Refresh-on-demand via `useAsyncData` / manual `refresh()` callbacks |
| Backend | Supabase (Postgres + RLS + RPC + Storage + Edge Functions + Realtime). 147 migrations, 11 edge functions |
| Writes | Almost every mutation is an audited RPC (`*_with_audit`). The client never writes tables directly |
| Auth | Edge Function `username-password-login` (username or work email + password) returns `access_token`/`refresh_token`, then `supabase.auth.setSession()`. Profile loaded from `user_profiles`; sign-in blocked on `account_status`, `working_status`, `is_login_enabled` |
| Authorization | Server: RLS + RPC guards (authoritative). Client: `roleMenu.ts` (`canAccessPage`, `getMenuForRole`) + `taskCapabilities` / `deriveFmsTransitionCapability` — usability only |
| Forms | 100% data-driven. Definitions in DB (`form_templates` + `form_fields`), engine in `packages/core/src/forms/*` |
| Validation | `packages/core` (`validateCompleteForm`, `normalizeFormAnswers`, `visibleFormSections`, `resolveFormOptions`) — pure, zero DOM |
| FMS | Definitions in DB; **branch resolution and stage advancement happen server-side** inside RPCs. `packages/core/src/fms/engine.ts` covers authoring validation + capability derivation |
| File uploads | `supabase.storage` private buckets `form-uploads`, `fms-evidence`, `crm-documents`, task attachments; upload then `register_*` RPC, viewed through 60-second signed URLs |
| Notifications | In-app inbox (`notifications` table + Realtime); outbox processed by an edge function |
| Realtime | One tenant channel on `tenant_realtime_events`, topic-filtered (`tasks`, `fms`, `crm`, `forms`, `organization`, `settings`) |
| Local storage | Only Supabase's own session persistence (`localStorage` via the default web client) plus `document.documentElement.dataset` for table density |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` only. Read once in `packages/api-client/src/supabase.ts` |
| Offline | **None.** The application assumes connectivity throughout |
| Tests | Vitest: 40+ suites in `packages/core`, 30+ in `apps/web`; pgTAP in `supabase/tests` |

### 1.2 Module inventory (what is actually implemented)

`IMPLEMENTED_PAGES` in `apps/web/src/App.tsx` lists 15 routes. `meeting_ai`, `delegation_tasks`, and `task_evidence` are menu identifiers only, not routes.

| Page | Route | Principal files | Character |
|---|---|---|---|
| Home | `/` | `features/home/HomeView.tsx` | Read-only action feed (`get_home_summary` RPC) |
| Dashboard | `/dashboard` | `features/analytics/*` | Analytics (`get_dashboard_metrics`) |
| Tasks | `/tasks` | `pages/TasksPage.tsx`, `features/tasks/*` (~1,300 lines) | My Tasks / Delegated split, complete, delegate, revise, attach, required forms |
| Task bulk import | `/tasks/import` | `features/tasks/import/*` (~1,200 lines, `xlsx`) | Desktop-only workflow |
| Assigning-left | `/tasks/assigning-left` | `features/tasks/import/AssigningLeftPanel` | Desktop admin |
| Recurring / To-Do | `/recurring-todo` | `pages/RecurringTodoPage.tsx` (919 lines) | Schedules, verification, coverage |
| Task Control | `/task-templates` | `features/taskControl/*` | Manager overview, dense tables |
| FMS | `/fms` | `features/fms/FmsFlowBuilder`, `FmsGraphCanvas` (343-line canvas) | **Drag-and-drop graph authoring** |
| FMS Tasks | `/tasks/fms` | `pages/FMSTasksPage.tsx`, `FmsStageRunner.tsx` | **Live execution — the critical flow** |
| Forms Library | `/forms` | `features/forms/FormBuilder` (530 lines), `FormRenderer` (121 lines) | Authoring, rendering, submissions |
| Dropdown Master | `/dropdown-master` | `pages/DropdownMasterPage.tsx` | Central option lists |
| CRM | `/crm` | `features/crm/*` | Clients, walk-ins, interactions, follow-ups, merge, documents |
| Notifications | `/notifications` | `features/notifications/*` | Inbox plus admin rule/template builders |
| Users | `/users` | `TeamDirectoryPage`, `UserManagementPage` (1,084 lines) | Roster plus administration |
| Availability | `/availability` | `pages/AvailabilityPage.tsx` | Daily status |
| Reports | `/reports` | `features/reports/*` | Fixed reports plus CSV export jobs |
| Settings | `/settings` | `features/settings/*` plus the Daily Checklist manager | Preferences, org defaults, purge |

---

## 2. Migration map

Legend: **Reuse** = imported unchanged · **Lift** = moved into a shared package, web keeps a re-export shim · **Rebuild** = new native UI · **Web-only** = stays on desktop

### 2.1 Layer map

```
                     packages/core            <- REUSE VERBATIM (pure TS, no DOM)
                     forms engine, fms engine, sla, taskFeed, taskCapabilities,
                     roleMenu, recurrence, analytics, reports, settings, crm rules
                              |
              +---------------+---------------+
              |                               |
      packages/data (NEW)              packages/api-client (REFACTOR)
      lifted from apps/web/src/         createJewelosClient(config, storage)
      features/*/api.ts                 plus .web.ts / .native.ts entrypoints
              |                               |
      +-------+--------+              +-------+--------+
      |                |              |                |
  apps/web         apps/mobile     localStorage    expo-secure-store
  (UI unchanged)   (NEW native UI)
```

### 2.2 Screen-by-screen map

| Web page | Mobile disposition | Screen(s) | Logic reused | Data source |
|---|---|---|---|---|
| Login | Rebuild | `LoginScreen` | `usernameLoginFunctionError` (lift) | `username-password-login` function |
| Home | Rebuild | `HomeScreen` (ScrollView of cards) | — | `get_home_summary`, `get_my_fms_starter_assignments` |
| Tasks | Rebuild | `TasksScreen` (FlatList, My/Delegated tabs) then `TaskDetailScreen` | `splitAssignedTaskFeed`, `taskMatchesStatus`, `isTaskFeedItemOverdue`, `deriveTaskMutationCapability`, `calculateSla`, `kolkataDateKey` | `loadTaskFeed`, `updateTask`, `delegateTask`, `reviseTask` |
| Tasks → required form | Rebuild | `FormScreen` (stack screen) | `resolveFormOptions`, `visibleFormSections`, `validateCompleteForm`, `normalizeFormAnswers` | `submit_form_with_audit` |
| FMS Tasks | Rebuild | `FmsTasksScreen` → `FmsInstanceScreen` → `FmsStageScreen` | `filterFmsInstances` (lift), `calculateFmsProgress`, `deriveFmsTransitionCapability`, `runtimeDecisionOptions` (lift), `shouldOpenInitialFmsForm` (lift) | `loadFmsRuntime`, claim/complete/review/reassign RPCs, **`submit_fms_form_and_progress_with_audit`** |
| Forms Library | Rebuild (fill and read only) | `FormsScreen` | forms engine | `loadForms`, `submitForm`, `startFmsFromFormSubmission` |
| Dropdown Master | Reuse data only | no screen — consumed by `FormScreen` | `resolveFormOptions` | `loadMasterOptions` (cached) |
| CRM | Rebuild | `CrmScreen` (search FlatList) → `ClientDetailScreen`, `WalkinScreen`, `FollowupsScreen` | `crm/phone`, `crm/search`, `crm/capabilities` | `search_crm_clients`, `record_crm_walkin`, follow-up RPCs |
| Notifications | Rebuild (inbox only) | `NotificationsScreen` | `notifications/*` formatting | `loadInbox`, `markNotification` |
| Availability | Rebuild | `AvailabilityScreen` | `availability/dateRange` (lift) | `recordAvailability` |
| Dashboard | Rebuild (condensed) | `DashboardScreen` — stat cards, no desktop charts | `analytics/metrics`, `analytics/chart` | `get_dashboard_metrics` |
| Settings / Profile | Rebuild | `MoreScreen` → `ProfileScreen`, `SettingsScreen` | `settings/*` | `user_preferences` |
| Users | Rebuild (directory only) | `TeamDirectoryScreen` | — | `user_profiles` |
| Recurring / To-Do | Phase 12 | `RecurringScreen` | `recurrence`, `dailyChecklist` | recurringTodo api |
| Daily Checklist gate | Rebuild | modal on app open | `dailyChecklist` | daily-checklists api |
| **FMS Builder** | Rebuild (phase 17) | `FmsFlowsScreen` → `FmsFlowEditorScreen` → `FmsStageEditorScreen` | `normalizeFmsDefinition`, `validateFmsDefinition`, `fmsOutgoingStageKeys`, `hasFmsStageRouting` | `loadFmsBuilderData`, `saveFmsDraft`, `publishFmsFlow` |
| **Form Builder** | Rebuild (phase 16) | `FormEditorScreen` → `FieldEditorScreen`, `OptionListScreen`, `RuleEditorScreen` | `normalizeFormDefinition`, `guidedConditions`, `routingMap`, `publishability` | `saveDraft`, `publishForm`, `reviseForm` |
| **Task bulk import** | Rebuild (phase 19) | `ImportScreen` — pick file, review, assign, run | `taskImport`, `normalizeRows`, `identityMappings`, `chunkRunner`, `correctionReport` | import api; `xlsx` replaced by a CSV-first path plus `expo-document-picker` |
| **Task Control** | Rebuild (phase 18) | `TaskControlScreen` (Overview / Tasks / People / Templates as tabs of card lists) | `taskControl/filters`, `taskAuthoringCapabilities` | taskControl api |
| **User Management** | Rebuild (phase 18) | `UserAdminScreen` → `UserEditScreen` | `userCredentials`, `identity`, `buddyEligibility` | user admin RPCs, `invite-user`, `reset-user-password`, `delete-user` |
| **Notification rules / templates / logs** | Rebuild (phase 18) | `NotificationAdminScreen` (Rules / Templates / Delivery tabs) | `notifications/{rules,conditions,template,delivery}` | notifications api |
| **Reports export jobs** | Rebuild (phase 18) | `ReportsScreen` — run, then share the CSV through the native share sheet | `reports/{catalog,filters,csv}` | reports api plus `expo-sharing` |

**Full parity is the agreed target.** Two surfaces cannot be mirrored literally and are being reinterpreted rather than shrunk:

- **FMS graph canvas.** A pan-and-zoom SVG graph with drag-to-connect is not workable on a phone. The mobile editor presents the same `FmsFlowDefinition` as an ordered stage list, with each stage's routes edited through a destination picker. It reads and writes the identical definition, passes the identical `validateFmsDefinition`, and stays interoperable with a flow authored on the web.
- **Bulk import.** `xlsx` is a 400 KB parser and the desktop flow spans four reconciliation panels. Mobile accepts CSV through `expo-document-picker` and walks the same normalise → confirm identities → assign → run pipeline as a four-step wizard, reusing `chunkRunner` unchanged.

### 2.3 Browser dependencies that must be replaced

| Web API | Where | Native replacement |
|---|---|---|
| `import.meta.env` | `packages/api-client/src/supabase.ts` | configuration object injected per platform (`.web.ts` / `.native.ts`) |
| `localStorage` (Supabase session) | Supabase default | `expo-secure-store` adapter, `detectSessionInUrl: false`, `AppState`-driven `startAutoRefresh` |
| `crypto.randomUUID()` | fms/api, forms/api, crm/api, `FmsStageRunner` | `expo-crypto` `randomUUID()` behind a shared `newRequestKey()` in `packages/data` |
| `<input type="file">`, `File` | forms, FMS evidence, CRM documents, task attachments | `expo-image-picker` plus `expo-document-picker`; upload an `ArrayBuffer` to `supabase.storage` |
| `window.open(signedUrl)` | evidence and document viewing | `expo-web-browser` `openBrowserAsync` |
| `window.prompt` / `window.confirm` | `FMSTasksPage` status actions | native modal sheet / `Alert.alert` |
| `window.history` / `popstate` | `App.tsx` routing | React Navigation native stack plus tabs, Android hardware back |
| `document.documentElement.dataset` | table density | not applicable |
| `xlsx` | bulk import | excluded from the mobile bundle |
| `requestAnimationFrame` plus `.focus()` | `FormRenderer` error focus | `ScrollView.scrollTo` plus `TextInput.focus()` through a ref map |

### 2.4 Interaction translations

| Desktop | Android |
|---|---|
| Sidebar plus app launcher | Bottom tabs (5) plus a More screen |
| Dense task table | `FlatList` of expandable `TaskCard`s |
| Modal dialogs | Native stack screens or bottom sheets |
| `<select>` | Bottom-sheet option picker, searchable above 8 options |
| `<select multiple>` | Checkbox list in a sheet |
| `<input type="date">` | `@react-native-community/datetimepicker` |
| Star rating hover | Pressable star row |
| Hover reveal | Always visible, or a long-press action sheet |
| FMS graph canvas | Vertical stage timeline (read-only) |

---

## 3. Decisions

1. **Project structure: Option B, already present.** No monorepo needs introducing — `packages/core` and `packages/api-client` exist and `apps/mobile` is already a workspace member. The one addition is `packages/data`.
2. **Framework: Expo SDK 57 / React Native 0.86** (already pinned in `apps/mobile/package.json`) with **`expo prebuild`** to generate and commit a real `android/` project. Not Expo Go: the application needs `expo-secure-store` and a signed release APK. This is genuine React Native — Expo is the toolchain, never a WebView.
3. **Navigation: React Navigation** — native stack plus bottom tabs. Android hardware back is handled by the native stack, with a `useFocusEffect` plus `BackHandler` guard on form screens holding unsaved answers.
4. **Data layer: lift, never duplicate.** `apps/web/src/features/*/api.ts` moves to `packages/data/src/<module>.ts`, and each web file becomes `export * from "@jewelos/data/<module>";`. This satisfies `AGENTS.md` rule 5 and keeps every existing web import byte-identical.
5. **No offline synchronisation.** The system is online-only. Mobile detects connectivity loss (`@react-native-community/netinfo`), blocks submissions behind a clear banner, and preserves in-progress form answers in memory plus a draft cache keyed by stage id. No background sync queue, so no synchronisation bugs.
6. **The server stays authoritative.** No backend changes are planned. FMS branching, deadlines and TAT, and permissions are already computed server-side.

### Risks

- The `packages/data` extraction touches roughly 40 web files (import paths only). Mitigated by re-export shims plus a full web typecheck, test, and build gate immediately after the lift.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled repository-wide; new mobile code must meet that standard from the first line.
- `@supabase/supabase-js` Realtime on React Native needs the `react-native-url-polyfill` and `base-64` polyfills. This must be verified on a device early, not at the end.

---

## 4. Execution phases

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | Audit plus this map | complete |
| 2 | `packages/api-client` factory refactor; mobile Expo scaffold, `expo prebuild`, `android/` committed, debug APK on device | app boots on the phone over USB |
| 3 | `packages/data` lift plus web shims | web typecheck, `pnpm --filter web test`, and `vite build` all green |
| 4 | Auth: `LoginScreen`, SecureStore session, `AuthProvider`, blocked-account states, logout | real login on device |
| 5 | Navigation shell: tabs, More, role-aware menu through `getMenuForRole`, back handling | — |
| 6 | Design system: `MobileScreen`, `Header`, `Card`, `StatusBadge`, `LoadingState`, `ErrorState`, `EmptyState`, `Sheet`, `Field`, `Button` over `@jewelos/ui-tokens` | — |
| 7 | Home plus Tasks (`FlatList`, detail, complete/delegate/revise) | — |
| 8 | **Native FormRenderer** — all 19 field types, keyboard handling, sections | — |
| 9 | **Conditional logic** driven by `visibleFormSections` and the rule tree | — |
| 10 | **FMS execution** — instances, stages, claim/complete/decision/remark/checklist | — |
| 11 | **FMS branching** through `submit_fms_form_and_progress_with_audit` | **critical-flow test on a physical device** |
| 12 | CRM, notifications inbox, availability, dashboard, profile/settings, recurring | — |
| 13 | Camera, gallery, and document upload; signed-URL viewing; permissions | — |
| 14 | Performance, accessibility, error boundaries, log hygiene | — |
| 15 | Release keystore (untracked), `versionCode` / `versionName`, release APK, documentation | signed APK installs and logs in |
| 16 | Form Builder — draft, fields, options, visibility rules, section routing, publish | a form authored on the phone renders identically on web |
| 17 | FMS Builder — flows, stage list editor, assignees, timing, decisions, routes, publish | a flow authored on the phone passes `validateFmsDefinition` and runs on web |
| 18 | Task Control, User Management, Notification administration, Reports with native sharing | — |
| 19 | Bulk import wizard (CSV), assigning-left, remaining administration | — |

Phases 8 to 11 are the architecture proof and are not to be deferred behind dashboard polish. Phases 16 to 19 carry the authoring surfaces that complete full parity; they depend on the form and FMS renderers proven in phases 8 to 11, so they deliberately come last.

---

## 5. Android build and device workflow (target state)

```powershell
# Host toolchain already present on this machine:
#   ANDROID_HOME = C:\Android  (build-tools 34/35/36, platforms android-34 and android-36, NDK 27.1.12297006)
#   JDK 17 (Temurin 17.0.19)
#   Node 24.17.0, pnpm 11.20.0

pnpm.cmd install                 # workspace: web and packages/*
pnpm.cmd run mobile:install      # apps/mobile installs separately
pnpm.cmd --dir apps/mobile exec expo prebuild --platform android

# Device over USB-C: enable Developer options, then USB debugging, then accept the RSA prompt.
adb devices                                # must list the device, not "unauthorized"
pnpm.cmd --dir apps/mobile run android       # builds, installs, and starts Metro
adb logcat -s ReactNativeJS:V              # JavaScript logs
# Reload: press R twice in Metro, or `adb shell input keyevent 82` for the dev menu.
# After a native or dependency change: re-run `run android`, not just a Metro reload.
```

The release APK, its signing, and environment configuration are specified in phase 15 and will be documented in `apps/mobile/README.md`. A release build embeds the JavaScript bundle and never contacts Metro. The keystore and its passwords belong in `~/.gradle/gradle.properties` (untracked) and never in the repository.

Versioning: `versionName` comes from `app.json` `expo.version` and `versionCode` from `expo.android.versionCode`, incremented on every release, starting at `1.0.0` / `1`. Direct APK installation does not update itself; a distribution and update mechanism is deliberately left for a later, separate decision.


---

## 6. Progress

### Verified

| Phase | State | Evidence |
|---|---|---|
| 1 Audit and map | done | this document |
| 2 Native project | done | `expo prebuild` generates `android/`; compiles through resource linking and C++ codegen |
| 3 Shared data layer | done | `packages/data` holds 15 lifted modules; web keeps re-export shims |
| 4 Authentication | done | `packages/data/src/auth/session.ts` is shared; **`apps/web` now uses it too**, so both clients run one sign-in path |
| 5 Navigation shell | automated gate passed; device gate pending | approved Home / Tasks / My Apps / More shell; shared role-aware launcher; themed header and navigation; Android bundle exported |
| 6 Design system | automated gate passed; device gate pending | all existing primitives consume the active light/dark theme; static-theme import guard passes |
| 7 Home and Tasks | done | `HomeScreen`, `TasksScreen` (FlatList, windowed), `TaskDetailScreen` |
| 8 Form renderer | done | all 19 field types, native controls, keyboard handling, scroll-to-error |
| 9 Conditional logic | done | driven entirely by `visibleFormSections` and `validateCompleteForm` |
| 10 FMS execution | done | `FmsTasksScreen`, `FmsInstanceScreen`, `FmsStageScreen` — claim, checklist, decision, remark, evidence, approve/reject |
| 11 FMS branching | done | `FmsStageFormScreen` calls `submit_fms_form_and_progress_with_audit`; the server resolves the route |
| 13 Files and images | partial | camera, gallery, and document picking; signed-URL viewing; permissions requested at point of use |

**Validation run after every change:**

```text
turbo run typecheck --force     6/6 packages pass
@jewelos/core test              23 files, 303 tests pass
@jewelos/data test               7 files,  39 tests pass
mobile test                      2 files,  10 tests pass
web test                        59 files, 273 tests pass
web build                       succeeds
```

Latest parity-foundation validation (2026-09-09): core 321 tests, data 39,
web 276, mobile 27, all five workspace typechecks, mobile typecheck, web build,
and a 6.7 MB Hermes Android export passed. Physical-device QA remains pending
because no USB device was attached; the available emulator is x86_64 and the
existing debug APK is arm64-v8a only.

The web app is unchanged in behaviour. Its imports were not touched: every
lifted module left a one-line re-export shim behind.

### Deliberate decisions taken during implementation

- **The workspace keeps pnpm `isolated`; `apps/mobile` left the workspace and
  installs with npm.** React Native's Android C++ build put object paths at 442
  characters against Windows' 260-character limit. Hoisting the whole workspace
  was tried and reverted — two React majors here means two copies of React 18 on
  disk and a null hook dispatcher in all 90 web render tests. `nodeLinker:
  hoisted` for the mobile app alone was also insufficient, because pnpm keeps
  peer-resolved packages (`react-native` among them) under `.pnpm/`. Moving the
  checkout to `C:\jos` **and** installing the mobile app with npm brings the
  same path to 214 characters. Both were required; neither alone sufficed.
- **A build-directory relocation plugin was written and then removed.** It
  shortened paths by moving each Gradle subproject's build directory, but React
  Native's autolinking CMake requires generated code at the hardcoded
  `<package>/android/build/generated/source/codegen/jni/`, so it broke the
  configure step outright. What survives is `withAndroidBuildBudget.js`, which
  only bounds ABIs and build memory — that part was correct and is what let the
  build finish on a 16 GB host.
- **`@jewelos/api-client` gained a factory and a registry.** `createJewelosClient`
  builds a client from explicit configuration, and `getSupabase()` is what the
  shared data layer reads. The browser singleton registers itself on import, so
  no web file changed; the native app registers a client backed by encrypted
  storage before the first screen renders.
- **A latent web type error was fixed.** `ComponentType<{ className?: string }>`
  is too narrow for a lucide icon under `exactOptionalPropertyTypes`. It had
  been masked by which `@types/react` happened to win at the workspace root.
- **`expo-secure-store` is chunked.** A Supabase session exceeds Android's ~2 KB
  keystore value limit, so the adapter splits it and refuses to return a
  partially recovered session.

### One API limitation worth a backend change

`loadFmsRuntime()` is a single call that fetches up to 200 instances, 1,500
instance stages, 1,000 stage definitions, 300 flows, 2,000 checklist items,
1,000 evidence rows, 3,000 logs, and 500 users — for the whole tenant. The web
app calls it once and filters client-side, which is reasonable over an office
connection. On a phone it is not: opening one workflow step downloads the entire
FMS estate.

Everything else was narrowed without touching the backend — the form screens now
call `loadTaskForms([id], [])` for the one template they render rather than
`loadForms()` for the whole library. This one cannot be fixed client-side.

**Proposed smallest change:** a `get_fms_instance_detail(p_instance_id)` RPC
returning one instance with its stages, definitions, checklist, evidence, and
the eligible assignee roster. It duplicates no business rule — the same rows,
scoped to one instance — and it is additive, so nothing on the web changes. This
is deliberately *not* implemented yet: it is a schema change, and per the brief
the backend is not to be altered without agreement.

### Outstanding

| Phase | Work |
|---|---|
| 12 | CRM follow-ups screen, notifications inbox, availability, dashboard, recurring/to-do, settings |
| 13 | Task attachment listing and viewing; CRM document upload |
| 14 | Performance pass on the largest feeds; accessibility audit on a real device |
| 15 | Release keystore, signing config, signed APK |
| 16-19 | Form Builder, FMS Builder, Task Control, User Management, notification administration, reports, bulk import |

Sections reached from **More** that are not yet built show a screen naming the
section and saying it is available on the web in the meantime, rather than an
empty view.

### Not yet proven

The debug APK builds and installs, and a Galaxy A55 (`SM_A556E`) is authorized
over ADB. What is still unconfirmed is the application actually running. The critical flow —
login, home, task, FMS task, form, conditional questions, submit, branch
evaluation, next node — is implemented against the same RPCs the web uses, but
it is **unverified until it runs on the phone**. That test is the next step and
is what phase 11's gate requires.
