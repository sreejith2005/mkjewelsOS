                                                   # JewelOS mobile parity playbook

Read this before touching `apps/mobile`. Update the tracker at the end of every
session.

The web app is the approved product. The Android app must behave identically.
Only layout changes for a phone. Rules, permissions, validation, wording, and
server calls do not change.

Repository: `C:\Users\MIS\Downloads\MKJewelOS`. `C:\jos` is a stale clone. Ignore it.

---

## 1. Rules

1. Web first. A feature ships on web, then is ported here.
2. Shared decisions live in `packages/core` (pure rules) and `packages/data`
   (Supabase reads and audited RPC writes). Both apps consume them. Never
   reimplement a rule in `apps/mobile`.
3. If a rule sits inside a web component, move it into `packages/core` or
   `packages/data` first, point web at it, keep web tests green, then use it
   from mobile.
4. The database is the authority. Hiding a control is presentation. RLS, RPCs,
   and Edge Functions enforce access.
5. No Capacitor, no WebView, no mobile-only business rules, no mock data.
6. Same wording as web. Copy user-facing strings verbatim.
7. A failed write stays visible and retryable. Never fake success.

---

## 2. Map

| Concern | Location |
| --- | --- |
| Approved behaviour | `apps/web/src/pages`, `apps/web/src/features` |
| Pure shared rules | `packages/core/src` |
| Shared Supabase layer | `packages/data/src/<domain>/api.ts` |
| Design tokens | `packages/ui-tokens` (light + dark palettes) |
| Mobile screens | `apps/mobile/src/screens` |
| Mobile shared UI | `apps/mobile/src/ui`, `apps/mobile/src/forms` |
| Mobile feature ports | `apps/mobile/src/features` |
| Navigation | `apps/mobile/src/navigation` |
| Android project | `apps/mobile/android` |
| Session history | `docs/MOBILE_HANDOFF.md` |

Mobile routing, as `apps/mobile/src/navigation/AppTabs.tsx` builds it:

- **A compact bottom dock with two actions, Home and Tasks**
  (`components/shell/MobileBottomNav.tsx`, a verbatim port of the web
  component of the same name). It is not a four-action bar, and there are no
  "My Apps" or "More" actions — those were replaced by the drawer below.
- **A navigation drawer**, opened from the hamburger in `MobileHeader`, holding
  every destination the viewer may reach (`components/shell/MobileNavigationDrawer.tsx`).
  `buildLauncherItems(shellAccess)` fills it, and it also carries the branch
  name, the profile, the role label, and Log out.
- **Five registered tabs** behind that chrome: `Home`, `Tasks`, `Fms`, `Crm`,
  and `Section`. Everything that is not one of the first four is reached as a
  `Section` page or as a stack screen.

Menus, the drawer, and deep links all come from one decision:
`resolvePageAccess(access, sectionControls, page)` via
`apps/mobile/src/navigation/shellModel.ts`.

---

## 3. Porting procedure

Per web feature:

1. Read the web source end to end: page, its feature folder, its API calls,
   its tests. List every action, rule, validation, permission, and message.
2. Identify shared logic. If it is web-local and pure, move it to
   `packages/core`/`packages/data`, migrate web to the shared copy, and run web
   tests. Copy the web tests along with the code.
3. Confirm `packages/data` already exposes the RPCs. Add missing ones there,
   never in the app.
4. Build the screen with `apps/mobile/src/ui` components. Use the substitution
   table below. Keep every action, in the same order, with the same labels.
5. Gate with `hasPermission(access, "<key>")`, not role strings.
6. Register any new stack route in **both** `navigation/types.ts` and
   `navigation/RootNavigator.tsx`. A missing registration type-checks fine and
   crashes at run time.
7. Add or update tests. Run the full gate. Build, install, and test on device.
8. Update the tracker in this document.

### Web control → mobile control

| Web | Mobile |
| --- | --- |
| `<select>` | `OptionPicker` (`multiple` for multi-select) |
| `<input type="text/number/email">` | `TextField` |
| `<input type="checkbox">` | `ToggleField` |
| `<input type="date/time">` | `DateField` (`mode="date" \| "datetime" \| "time"`) |
| `<input type="file">` | `pickFileFromChooser()` / `chooseSource()` |
| Tabs, filter chips | `SegmentedControl` |
| Modal, dialog | `Sheet` (`tall` for long content) |
| Table | `Card` + `CardRow` list |
| `window.confirm` | `Alert.alert` wrapped in a promise |
| Toast, inline notice | `Banner` |
| Blocking dialog | `Modal` with `onRequestClose` held (see `DailyChecklistGate`) |

---

## 4. Verification gate

Run all of it before claiming a feature is done.

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS
pnpm turbo run typecheck                  # core, data, api-client, ui-tokens, web
npm --prefix apps/mobile run typecheck
pnpm --dir packages\core test
pnpm --dir packages\data test
pnpm --dir apps\web test
npm --prefix apps/mobile run test
```

Baseline as of 2026-09-12, end of day: core 449, data 68, web 310, mobile 47,
5 workspace typechecks plus mobile — all green.

**A second session was editing this tree at the same time** (the FMS
assigned-work contract: `features/fms/assignedWorkNavigation.*`,
`features/home/HomeView.*`, `roleMenu.ts`, `analytics/*`, plus the untracked
`0160` migration). Its tests are included in those totals. The Task Control
session alone ended at core 442 / web 308 / mobile 38. If a typecheck fails
once and passes on a re-run, suspect a half-written file from the other
session rather than a real break.

The previous baseline read core 422 / data 61 / mobile 35. The rises are new
tests, not moved ones: `dropdownMaster` (9) and `taskControlView` (11) in core,
`writeErrors` in data (7), and `requiredMark` in mobile (3).

The earlier baseline read core 366 / web 317. The rise in core and the fall in
web are the same tests moving: the Recurring / To-Do rules and the three pure
Forms-builder modules were extracted into `packages/core` and their tests went
with them, as rule 3 requires.

Web tests can fail spuriously under Gradle load (timing tests such as
`FmsFlowBuilder`, `DataPurgeCard`). Re-run the file alone before believing a
failure.

---

## 5. Build, install, device QA

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS\apps\mobile\android
.\gradlew.bat assembleRelease --no-daemon --max-workers=2
```

Output: `apps\mobile\android\app\build\outputs\apk\release\app-release.apk`
(~37 MB, arm64-v8a only, JS bundle embedded, runs without Metro).

Signing: the upgrade key is read from the properties file named by
`JEWELOS_KEYSTORE_PROPERTIES` in `%USERPROFILE%\.gradle\gradle.properties`,
pointing at `C:\Users\MIS\Downloads\safety-keys-passwords-impt\keystore.properties`.
Key is outside Git. Write that properties file **without a BOM** — a BOM renames
the property, and the build silently falls back to the debug key, which cannot
update an installed release.

Verify and install:

```powershell
$adb='C:\Android\platform-tools\adb.exe'
& C:\Android\build-tools\36.0.0\apksigner.bat verify --print-certs <apk>   # expect CN=MK Jewels
& $adb -s RZCY40K24SD install -r <apk>                                     # keeps data
& $adb -s RZCY40K24SD logcat -d --pid=$(& $adb -s RZCY40K24SD shell pidof com.jewelos.mobile)
& $adb -s RZCY40K24SD shell dumpsys dropbox --print data_app_anr           # freeze records
```

Device: Samsung SM-A556E, `RZCY40K24SD`, Android 16. It drops off USB often;
re-arm waits rather than assuming failure. Filter logcat by the app's pid — an
unfiltered grep is drowned by other apps. Do not script taps while the user
holds the phone; taps land in whatever is in front.

Disk: native builds need 2–3 GB free. Keep an eye on `C:`.

---

## 6. Traps

Each cost real time. Do not rediscover them.

1. **NativeWind drops a function-form `style` on `Pressable`** (v4.2.6 /
   RN 0.86). Controls lose their background and become invisible. Always import
   `Pressable` from `@/ui/Pressable`, never from `react-native`, when `style`
   is a function.
2. **NativeWind's dark mode ignores a `dark` class on a parent view.** It reads
   its own colour-scheme state, which defaults to the phone's system setting.
   `ThemeProvider` calls `colorScheme.set(name)`. Keep that.
3. **`expo-file-system` 57 legacy methods throw at run time.**
   `readAsStringAsync` and friends only exist in `expo-file-system/legacy`. Read
   files with `new File(uri).arrayBuffer()`.
4. **Upload names must match their bytes.** A gallery photo re-encoded to JPEG
   can keep a `.HEIC` name; the server rejects the mismatch. `pickFile`
   normalises the extension.
5. **`exactOptionalPropertyTypes` is on.** Never pass `undefined` to an optional
   prop. Spread it conditionally: `{...(x ? { prop: x } : {})}`.
6. **PowerShell patching:** in `@('a', 'b' + "\`n" + 'c')` the comma binds
   tighter than `+`, so everything after the newline is lost silently. Build
   replacement strings in variables, verify match counts, and re-read the file.
   Prefer the Edit tool.
7. **File encoding:** write UTF-8 without BOM. `Set-Content -Encoding utf8`
   adds a BOM and `Get-Content` without `-Encoding` mangles non-ASCII. Web has
   an encoding test that fails on double-encoded characters.
8. **Hermes has no `crypto.randomUUID`.** Use `newRequestKey()` from
   `@jewelos/data/runtime`, or `randomUUID` from `expo-crypto`.
9. **A long list must not be `.map()`ed into `Screen scroll`.** That mounts and
   lays out every row before the screen can paint, which is what made Task
   Control stall on a tab whose data was already in memory. Use
   `ui/ListScreen.tsx` — a `FlatList` in the same frame, with everything that
   is not a row in its `header` prop so the page stays one scroll surface.
10. **A closed `Sheet` used to stay in the tree.** `Modal visible={false}`
   draws nothing, but its children are still built on every render of the
   owner — and a sheet is usually owned by a row, so `OptionPicker` and
   `PromptSheet` meant one modal per list item. `Sheet` now unmounts when
   closed. A sheet that owns a `FlatList` must pass `scrollable={false}`, or
   the sheet's own `ScrollView` stops it virtualising.
11. **React Native has no `hidden` prop.** To hide a view without unmounting
   it, add `display: "none"` to its style.
12. **Do not append a `*` to a label that already ends in one.** Several
   labels are copied verbatim from web, where the asterisk is part of the
   string ("Core Task *"). Use `ui/requiredMark.ts`.

---

## 7. Parity tracker

Status as of 2026-09-12. Verify before trusting; update after every session.

### Done — behaviour matches web

| Section | Mobile | Notes |
| --- | --- | --- |
| Shell, navigation, theme | `navigation/`, `theme/` | Home/Tasks dock, hamburger navigation drawer, persisted light/dark |
| Permissions, Developer Mode | `AuthProvider`, `shellModel`, `SectionMaintenanceNotice` | `get_my_access_context`, effective role, section gating, maintenance notice |
| Permission management | `PermissionManagementScreen` | Roles, designations, users, dashboard authority |
| Home | `HomeScreen` | |
| Tasks feed | `TasksScreen`, `features/tasks/TaskCard` | `deriveTaskCardState` shared; checklist vs task rules |
| Task detail | `TaskDetailScreen` | Complete, revise, checklist, evidence, attachments |
| Dashboard | `DashboardScreen` | Ranges, metrics, comparisons |
| Notifications | `NotificationsScreen`, `features/notifications` | Inbox plus templates, rules, delivery logs, provider status |
| Availability | `AvailabilityScreen` | Coverage chain, audited RPC |
| Reports | `ReportsScreen` | Preview, export, history, `reports.export` |
| Settings | `SettingsScreen` | Org, branch, Developer Mode, permissions entry, purge card, daily checklists |
| Daily checklist gate | `features/daily-checklists/DailyChecklistGate` | Blocking, back button held |
| Users | `UsersScreen` | Directory, add, edit, buddies, week off, delete, password |
| FMS console | `FmsScreen`, `FmsTasksScreen` | Single section per `d76c1a5` |
| FMS builder | `FmsBuilderScreen`, `features/fms/*` | Canvas, step editor, assignees, publish |
| Forms fill | `FormFillScreen`, `forms/` | |
| Assigning Left | `AssigningLeftScreen` | |
| Uploads | `lib/pickFile.ts` | Camera, gallery, files |

### Partial — thin against web

| Section | Web | Mobile | Missing |
| --- | --- | --- | --- |
| Recurring / To-Do | `RecurringTodoPage.tsx` (919) | `RecurringTodoScreen.tsx` + `features/recurringTodo/*` | Feature-complete against web. Two defects reported from the device on 2026-09-12 are fixed (slow load, unscrollable sheet). **Still not exercised on the phone by a person.** |
| Task Control | `TaskTemplatesPage.tsx` + `features/taskControl` | `TaskControlScreen.tsx` + `features/taskControl/*` | **Full parity as of 2026-09-12, but never used on the phone by a person.** Filter sheet, all four tabs, seven view chips, server pagination, signed-URL evidence, all four template actions. Decisions in `packages/core/src/taskControlView.ts`; web consumes the same functions. |
| Dropdown Master | `DropdownMasterPage.tsx` | `DropdownMasterScreen.tsx` | Total / Active / Inactive tiles added 2026-09-12 from shared `dropdownMasterCounts`. **Still missing the all/active/inactive status filter web has**; mobile always filters as "all". |
| CRM | `CRMPage.tsx` + `features/crm` (10 files) | `CrmScreen`, `ClientDetailScreen`, `WalkinScreen` | Verify merge dialog, follow-ups panel, document upload against web. |
| Forms library | `FormsPage.tsx` + `features/forms` (11 files) | `FormsLibraryScreen.tsx` (73) | Publish/revise/archive/duplicate only. **No form builder** (`FormBuilder.tsx`, 530 lines), no submission review, no dropdown-source or routing editors. |
| Users | `UserManagementPage.tsx` (1084) | `UsersScreen.tsx` (561) | Directory and editors ported. Check org-chart/hierarchy views. |

### Not ported — deliberate

| Feature | Reason |
| --- | --- |
| Task bulk import (`/tasks/import`) | Spreadsheet workflow; desktop only. Assigning Left is ported. |
| Meeting AI | Not implemented on web either. |

### Known divergences and defects

1. ~~**`packages/core/src/roleMenu.ts` has two `/tasks/fms` rules.**~~ **Fixed
   2026-09-12.** The stale `→ fms_tasks` line is removed, so `/tasks/fms` now
   resolves to `fms_builder`, the single FMS section that actually has a route.
   `fms_tasks` has neither a menu path nor a web render branch, which is why the
   link used to reach the fallback page. Mobile routes both ids to the FMS tab
   and is unaffected. Core and both clients' tests are green.
2. **Duplicated API copies.** Partly addressed.
   - `features/forms/{fieldTypes,guidedConditions,routingMap}.ts` moved into
     `packages/core/src/forms/` on 2026-09-12; the web files are now one-line
     re-export shims and the tests moved with the code.
   - Still outstanding: `apps/web/src/features/daily-checklists/api.ts` and
     `features/notifications/viewModel.ts` duplicate `packages/data` copies.
     These differ only in the client accessor (`supabase` vs `getSupabase()`),
     so they are a straight swap once web depends on `@jewelos/data`.
   - **`features/fms/{definition,graph}.ts` have diverged from their
     `packages/data/src/fms/` copies** (51 vs 57 and 88 vs 93 lines). They are
     *not* interchangeable. Diff them and reconcile deliberately before deleting
     either side — a blind delete would change behaviour on one client.
3. **Dropdown Master's three tiles do not sum, on both clients.** `Total` and
   `Inactive` count the whole category and ignore the search box and the status
   filter, while `Active` counts only the visible rows. So a search matching
   nothing shows Total 12 / Active 0 / Inactive 3. This is the approved web
   page's own behaviour; `dropdownMasterCounts` in `packages/core` reproduces it
   deliberately and says so. Changing it is a product decision, and it would
   change web.
4. **"JewelOS isn't responding" freezes — confirmed under real use, and there
   are two distinct causes.** A third record appeared at `2026-09-12 13:20:46`,
   during real use of the pre-fix build. Unlike the 11 Sept one it is **not**
   memory pressure: RSS 785 MB, heap not pinned, 98% *user* CPU, main thread
   `state=R`, and its stack is `ReactScrollView.draw` walking `drawChild` over
   every child. That is an unvirtualised `Screen scroll` blowing through the
   10-second input deadline — root cause A, caught in the act, and what
   `ui/ListScreen.tsx` exists to fix.

   The 11 Sept memory-pressure record (heap 252/256 MB, RSS ~2 GB, `kswapd0` at
   34%) is a **separate** failure and is **not** addressed by the list work.
   `loadFmsRuntime()` remains its suspect. Do not treat one fix as closing both.

   Baseline for the next session: three records, newest `2026-09-12 13:20:46`,
   all older than the 2026-09-12 14:33 install.

   **Update, later the same day:** the recurring workspace RPC was measured
   against production and returns a **12 MB JSON payload** (10.5 MB of
   instances, 1.9 MB of templates) in 1.5 s. A 12 MB document parsed into a JS
   object graph by Hermes is more than enough to pin a 256 MB Java heap, so the
   memory-pressure record and the recurring slowness are very likely **the same
   defect**. `loadFmsRuntime()` is no longer the leading suspect for it. See the
   handoff entry and `0159_recurring_workspace_submissions_scan.sql`.

5. **APK is arm64-v8a only.** Covers current phones; not x86 emulators.
6. **`get_recurring_todo_workspace` returns 12 MB.** Measured on production:
   5,672 instances and 1,456 templates, every call, unpaginated, with
   `to_jsonb(v)` emitting every column whether a client reads it or not. The
   query itself is 1.5 s against an 8 s `statement_timeout`; the payload is what
   makes the screen take a minute on a phone. Fixing it means paginating or
   selecting columns, both of which change `parseRecurringWorkspace` and so
   change web too. **Needs agreement before anyone starts.**
7. **Migration `0159` is written but NOT applied**, and
   `0160_fms_assigned_work_contract.sql` is untracked and was written outside
   this session. `supabase db push` applies *all* pending migrations — decide
   about 0160 deliberately before pushing 0159.
8. **Nothing from these sessions is committed.** The working tree holds the
   whole mobile app plus shared changes.
9. **Native component tests cannot run.** `apps/mobile/vitest.config.ts`
   includes only `src/**/*.test.ts` and the app carries no React Native
   rendering preset, so anything ending `.test.tsx` is neither collected nor
   runnable. Adding `@testing-library/react-native` plus a transform and mocks
   for Reanimated, Gesture Handler and `react-native-svg` is a prerequisite for
   testing the FMS canvas or a native Forms Builder. **Needs agreement before
   anyone starts** — it is a dependency decision, not a refactor.
10. **Migration `0160` is now applied locally and covered** by
   `supabase/tests/0160_fms_assigned_work_contract.test.sql` (28 assertions,
   including tenant isolation and notification closure). It remains untracked
   along with `0159`; the push decision in item 7 still stands.

---

## 8. Session protocol

1. Read this document and `docs/MOBILE_HANDOFF.md`.
2. Ask which web feature changed, or diff `apps/web` and `packages` against the
   last ported commit.
3. Port with the procedure in section 3.
4. Run the gate in section 4.
5. Build, install, and verify on the device.
6. Update the tracker in section 7 and append findings to the handoff document.
