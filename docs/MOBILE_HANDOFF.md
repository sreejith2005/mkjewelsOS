# JewelOS Mobile — Handoff for a fresh session

**Decision made: React Native only. No Capacitor, no WebView, no third-party
wrapper. The native app must reach parity with the approved web app.**

Repository: `C:\jos` (moved this session from `C:\Users\MIS\Downloads\MKJewelOS\jewelos`).

---

## 1. What happened, and the standard to build to

An earlier session was briefed to build a native app that deliberately did *not*
resemble the web app. It did exactly that, and on-device testing found the
result unusable as a product:

> "The app felt completely different from the web app… we have gotten the web
> app approved from management after a lot of back and forth. I wanted the web
> app to be just packaged as the app, with just better mobile responsiveness…
> we had optimized everything for mobile as well."

Capacitor was proposed and **rejected**. The direction is now:

> "Do it the best way possible using React Native only."

So the standard is: **a real React Native app that a user cannot distinguish
from the approved web app opened on a phone** — same sections, same rules, same
colours, same theme switch, same density.

### The one thing that must not be repeated

The mobile app diverged because **behaviour and appearance lived in web-only
places**: decision logic inside React DOM components, and the palette inside a
stylesheet. Anything reimplemented by hand drifts.

**The rule for all remaining work:** if a behaviour or a value is shared, it
moves into `packages/core`, `packages/data`, or `packages/ui-tokens` and *both*
clients consume it. Nothing is transcribed by eye.

---

## 2. What was completed this session (verified, all green)

### 2.1 The palette is now one source of truth

The web app's real colours live in `apps/web/src/index.css` as CSS variables,
and **light is the default theme** — `--color-obsidian` is `#F8FAFC`, near-white.
`packages/ui-tokens` previously carried an unrelated dark-only palette, which the
mobile app used. That alone explains why the app looked like a different product.

- Both palettes (19 colours each) were extracted **from that CSS** — not
  transcribed — into `packages/ui-tokens/src/tokens.json` under `themes`.
- `packages/ui-tokens/src/index.ts` exports `themes`, `palette(name)`,
  `ThemeName`, `ThemePalette`.
- `apps/web/src/theme/tokens.test.ts` parses `index.css` and **fails the build**
  if the CSS and the tokens ever disagree. `index.css` stays the source; the test
  makes drift impossible to miss.

### 2.2 The mobile theme system is correct and complete

- `apps/mobile/src/theme/theme.ts` — rebuilt on the shared palettes. Exposes both
  the web's own names (`taskBg`, `taskAccent`, `champagne`, …) so a colour can be
  traced to the stylesheet, and semantic names (`background`, `surface`, `text`,
  `primary`, …) for everyday use. Light and dark both built.
- `apps/mobile/src/theme/ThemeProvider.tsx` — context, persisted to
  AsyncStorage under `jewelos-theme` (the same key the web uses), default light,
  with `setTheme` / `toggleTheme`.
- `apps/mobile/src/theme/makeStyles.ts` — the migration helper. A module-level
  `StyleSheet.create` captures one palette forever, which is why a toggle appears
  to do nothing; `makeStyles` turns the same object into a hook.

### 2.3 Verification at the time of writing

```
pnpm exec turbo run typecheck --force     5/5 packages pass
pnpm --filter web test                    60 files, 276 tests pass
pnpm --filter @jewelos/core test          23 files, 303 tests pass
pnpm --filter @jewelos/data test           7 files,  39 tests pass
npm --prefix apps/mobile run typecheck    clean
npm --prefix apps/mobile run test          2 files,  10 tests pass
```

The web app's behaviour is unchanged throughout.

---

## 3. The four gaps, and exactly how to close each

### 3.1 Every section except Home and Tasks says "coming soon"

`apps/mobile/src/screens/SectionScreen.tsx` is the placeholder. The web app has
**15 implemented routes** (`IMPLEMENTED_PAGES` in `apps/web/src/App.tsx`):

home · dashboard · crm · checklist_tasks · recurring_todo · task_templates ·
fms_tasks · fms_builder · forms_library · notifications · users · availability ·
reports · dropdown_master · settings

Built so far: home, checklist_tasks, fms_tasks, crm (partial), plus the form
renderer and FMS execution.

**How to close it.** For each remaining section, in this order — Settings (small,
proves the theme toggle), Notifications, Availability, Dashboard, Forms Library,
Recurring/To-Do, Dropdown Master, Users, Reports, Task Control, then the two
builders and bulk import last:

1. Read the web page and identify every *decision* it makes (what is shown, what
   is enabled, what an action does).
2. Move those decisions into `packages/core` as pure functions with tests.
3. Refactor **the web page** to call them. Web tests must stay green — this
   proves the extraction is faithful.
4. Build the RN screen from the same functions.

Step 3 is what makes this different from the first attempt. Do not skip it.

### 3.2 Task logic is wrong — no task/checklist differentiation

`apps/web/src/features/tasks/TaskCard.tsx` holds rules refined over a lot of
testing:

- `task_type` changes behaviour — `fms` stages are read-only in the feed,
  `delegation` tasks expose a revise-date form, checklist tasks differ again;
- `requires_upload` withholds completion until an attachment exists;
- `requires_form` withholds completion until a form submission exists;
- checklist items show progress via `calculateTaskChecklistProgress`, are
  individually toggleable, and mark required items;
- an outstanding checklist deliberately does **not** block completion — the
  server closes the remainder (migrations 0142/0143);
- a `formOnlyAction` mode changes the entire card.

`apps/mobile/src/screens/TaskDetailScreen.tsx` has a flattened version and is
wrong.

**How to close it.** Add to `packages/core` — for example
`packages/core/src/taskCardState.ts`:

```ts
export function deriveTaskCardState(input: {
  task: TaskFeedLike & { task_type, requires_upload, requires_form, ... };
  checklists: readonly TaskChecklistLike[];
  capability: TaskMutationCapability;
}): {
  readOnly: boolean;
  formOnlyAction: boolean;
  canComplete: boolean;
  blockedReason: string | null;
  showDirectUpload: boolean;
  showReviseForm: boolean;
  checklistProgress: { completedItems: number; totalItems: number; displayPercent: number };
};
```

Cover every branch with tests, refactor `TaskCard.tsx` onto it (web tests green),
then build the RN card from the same function. After this the two cannot
disagree.

### 3.3 No light/dark switch

The system is built (§2.2) but **not yet wired**. Remaining:

1. Mount `ThemeProvider` in `apps/mobile/App.tsx`, outside `AuthProvider`.
2. Migrate the 31 files that still `import { theme } from "@/theme/theme"` onto
   `makeStyles` + `useAppTheme()`. Until this is done a toggle would appear to do
   nothing, so **do not ship a toggle before the migration**.
3. Add the toggle to `MoreScreen`, mirroring `apps/web/src/components/ThemeToggle.tsx`.
4. Drive React Navigation's own chrome from the theme in `RootNavigator.tsx`
   (it currently hard-codes a dark navigation theme).
5. Set the Android status bar per theme via `expo-status-bar`.

The mechanical part of step 2, per file:

```diff
-import { theme } from "@/theme/theme";
+import { makeStyles } from "@/theme/makeStyles";
+import { useAppTheme } from "@/theme/ThemeProvider";

 export function Thing() {
+  const theme = useAppTheme();   // only if theme is used outside StyleSheet
+  const styles = useStyles();
   ...
 }

-const styles = StyleSheet.create({ … theme.colors.x … });
+const useStyles = makeStyles((theme) => StyleSheet.create({ … theme.colors.x … }));
```

Do it in batches with `npm --prefix apps/mobile run typecheck` after each. The
list of 31 files: `grep -rl 'from "@/theme/theme"' apps/mobile/src`.

### 3.4 The view feels bloated and unlike the web

Partly fixed already — the palette is now correct, which is most of it. What
remains is density and layout. Match these against the web:

- **Spacing.** The RN app uses its own scale. The web's mobile padding is
  `p-4` (16px) on `ApplicationShell`, with `gap-3`/`gap-4` between cards.
- **Type.** The web's card title is `text-[15px]` with `leading-snug`; the RN
  `Text` ramp was invented independently and should be checked against
  `index.css` and the Tailwind config.
- **Bottom navigation.** Mirror `apps/web/src/components/shell/MobileBottomNav.tsx`
  — same items, order, and labels — rather than the ad-hoc five in `AppTabs.tsx`.
  Note `AppTabs.tsx` currently uses text glyphs (`◆ ✓ ⇄ ☺ ⋯`) as icons; the web
  uses lucide icons. `lucide-react-native` gives the identical icon set.
- **Header.** Mirror `ApplicationShell.tsx`'s mobile header.
- **Cards.** `TaskCard` on the web is a white surface, `taskBorder` hairline,
  `rounded-xl`, with a specific internal rhythm. Match it.

Read the web component and match it deliberately. Do not design.

---

## 4. Everything else worth knowing

### 4.1 Architecture already in place — keep and use it

| Piece | What it gives you |
|---|---|
| `packages/core` | Pure business rules: forms engine, FMS engine, SLA, task feed, RBAC (`getMenuForRole`, `canAccessPage`), recurrence. Zero DOM. Already shared. |
| `packages/data` (51 files) | The whole Supabase data layer, lifted out of `apps/web/src/features/*/api.ts`. Web reaches it through 15 one-line re-export shims, so no web import changed. **Both clients already share this.** |
| `packages/api-client` | `createJewelosClient(config)` + `getSupabase()` registry. Web registers its browser singleton on import; mobile registers one backed by encrypted storage. |
| `packages/data/src/auth/session.ts` | Sign-in and profile-gate logic. `apps/web/src/auth/AuthContext.tsx` was refactored onto it, so there is one sign-in path. |
| `packages/ui-tokens` | Palette (both themes), spacing, radii, type scale, touch target. |

**Server-side truth that removes whole classes of risk:** FMS branch resolution
and stage advancement happen inside `submit_fms_form_and_progress_with_audit`
and `complete_fms_stage_with_audit`. The client only reports answers. A phone and
a browser cannot send a workflow down different paths.

### 4.2 Mobile app structure

```
apps/mobile/
  App.tsx                  registers the UUID source, mounts providers
  index.js                 Expo entry
  plugins/withAndroidBuildBudget.js   ABI + build-memory limits (see 4.4)
  src/
    auth/AuthProvider.tsx  session restore, sign-in, blocked-account states
    config/env.ts          the only reader of EXPO_PUBLIC_*
    forms/                 data-driven form renderer, all 19 field types
    fms/decisions.ts       decision options read from stage config
    lib/                   supabase client, secure storage, pickers, formatting
    navigation/            tabs + native stack
    screens/               one file per screen
    theme/                 palette, provider, makeStyles
    ui/                    shared component vocabulary
```

The form renderer and FMS execution are the parts most worth keeping — they are
already fully data-driven (visibility and validation come from `@jewelos/core`;
branches are decided by the server) and contain no hardcoded questions.

### 4.3 Build and run

`apps/mobile` is **not** a pnpm workspace member — it installs with **npm**.
`pnpm --filter mobile` will not find it.

```powershell
cd C:\jos
pnpm.cmd install                 # workspace: web + packages/*
npm --prefix apps/mobile install # the mobile app

# device (Galaxy A55 SM_A556E, serial RZCY40K24SD, already authorised)
adb devices                      # must read "device", not "unauthorized"
adb install -r "C:\jos\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
adb reverse tcp:8081 tcp:8081    # re-run after every replug
cd apps\mobile && npx expo start --dev-client
adb logcat -s ReactNativeJS:V ReactNative:V
```

Rebuild the APK (~22 min) only after a native or dependency change:
`cd apps\mobile\android && .\gradlew.bat assembleDebug --no-daemon --max-workers=1`

Last build: `BUILD SUCCESSFUL in 22m 39s`, 56 MB, `com.jewelos.mobile`
v1.0.0 (versionCode 1), arm64-v8a, targetSdk 36.

### 4.4 Environment constraints — do not rediscover these

- Host: Windows 11, 16 GB RAM, 4 cores, ~4 GB typically free. JDK Temurin 17,
  `ANDROID_HOME=C:\Android`, build-tools 36.0.0, platform android-36,
  NDK 27.1.12297006. Node 24.17.0, pnpm 11.20.0, npm 11.13.0.
- **Windows 260-character path limit.** RN compiles third-party C++ and CMake
  names object files after the full source path. Measured for one file:

  | Checkout | node_modules | Length | |
  |---|---|---|---|
  | old path | pnpm isolated | 442 | fails |
  | old path | flat | 282 | fails |
  | `C:\jos` | pnpm isolated | 374 | fails |
  | `C:\jos` | flat (npm) | **214** | builds |

  Both the move and npm were required. `LongPathsEnabled` is already 1 and does
  **not** help — the NDK's `ninja.exe` is not long-path aware. **Do not move the
  repo back, and do not put `apps/mobile` back under pnpm.**
- **Memory.** A stock Expo build (Gradle JVM + Kotlin daemon + four ABI
  toolchains) is OOM-killed here. `withAndroidBuildBudget.js` bounds all three:
  arm64 only, in-process Kotlin, `-Xmx1536m`, no parallel. A release for wider
  distribution widens ABIs at the command line:
  `.\gradlew.bat assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a`
- **`tsconfig.json#paths` is read by Expo's Metro for runtime resolution**, not
  just types. Mapping `react` to `@types/react` for the type-checker produced
  `Unable to resolve "react" from "App.tsx"`. Keep `paths` to real source
  aliases such as `@/*`.
- A build-directory relocation plugin was written and **removed**: RN's
  autolinking CMake requires generated code at the hardcoded
  `<package>/android/build/generated/source/codegen/jni/`.

### 4.5 Known bugs, independent of the mobile work

**`ensure-my-recurring-tasks` Edge Function returns non-2xx.** Seen on every
device load:

```
[jewelos:api] recurring preparation error
[Error: Prepare recurring tasks: Edge Function returned a non-2xx status code]
```

The client swallows it deliberately, but it is failing. **Check whether it also
fails on web** — if so, recurring task occurrences may not be materialising for
anyone, which is a production issue unrelated to mobile. Look at
`supabase/functions/ensure-my-recurring-tasks/` and the Supabase function logs.

**`loadFmsRuntime()` fetches the whole tenant** — up to 200 instances, 1,500
stages, 3,000 logs and more, to render one step. Affects web too. A
`get_fms_instance_detail(p_instance_id)` RPC would fix it; not implemented
because it is a schema change and was not agreed.

### 4.6 Deliberately not done

- `react-native@0.86.2` vs Expo's expected `0.86.3`; `typescript@5.9.3` vs
  expected `~6.0.3`. The workspace pins TS 5.9.3 everywhere, and an RN patch bump
  forces a 22-minute native rebuild.
- No backend changes; no migrations written.

---

## 5. Recommended order of work

1. **Wire the theme** (§3.3) — provider, 31-file migration, toggle. Smallest
   change with the most visible effect, and it validates `makeStyles`.
2. **Lift task logic** (§3.2) — `deriveTaskCardState` in core, web refactored
   onto it, then the RN card. This is the template for everything else.
3. **Match the shell** (§3.4) — bottom nav, header, card rhythm, and
   `lucide-react-native` icons.
4. **Sections, smallest first** (§3.1) — Settings, Notifications, Availability,
   Dashboard, Forms Library, Recurring/To-Do, Dropdown Master, Users, Reports,
   Task Control, then FMS Builder, Form Builder, bulk import.
5. **Release** — keystore outside the repo, `versionCode` increment per release,
   signed APK.

Two surfaces deserve a conversation before being built rather than a guess:
**FMS Builder** (a drag-and-drop graph canvas) and **bulk import** (a four-panel
`xlsx` reconciliation). Both are genuinely desktop-shaped. Ask how they should
behave on a phone before implementing.

---

## 6. What NOT to do

- Do not hand-transcribe a rule or a colour from a web component. Extract it to a
  shared package and refactor the web onto it first — that is the whole lesson.
- Do not delete `packages/data` or the `apps/web/src/features/*/api.ts` shims;
  the web app imports through them.
- Do not move the repository, and do not put `apps/mobile` back under pnpm (§4.4).
- Do not ship the theme toggle before the 31-file migration; it would do nothing.
- Do not add a WebView or Capacitor. That direction was considered and rejected.

---

## 7. 2026-09-09 parity-foundation checkpoint

Implemented the first approved Android parity slice:

- replaced duplicated web/mobile navigation metadata with shared `@jewelos/core` implemented-page and launcher selectors;
- fixed `/tasks/fms` so the shared path resolver reaches `fms_tasks`;
- migrated every existing native component away from module-level static theme capture;
- added a source guard that fails if a static palette import returns;
- added the approved phone header with light/dark logo, theme control, notifications action, and profile initials;
- replaced the invented five visible tabs with Home, Tasks, My Apps, and More;
- kept CRM, FMS Tasks, and unported section content inside the persistent native shell;
- removed the standalone More screen because More is an action sheet in the approved web application.

Fresh automated evidence:

```text
@jewelos/core test          24 files, 321 tests passed
@jewelos/data test           7 files,  39 tests passed
web test                    60 files, 276 tests passed
turbo typecheck              5 packages passed
mobile test                  4 files,  27 tests passed
mobile typecheck             passed
web production build         passed, 1,849 modules transformed
Android Expo export          passed, 3,510 modules, 6.7 MB Hermes bundle
```

Android export: `C:\jos\artifacts\foundation-export-20260909`.

Physical-device QA is still pending. `adb devices -l` found no USB device. The
available `mkjewels_test` emulator is x86_64, while the existing 73,835,650-byte
debug APK is arm64-v8a only, so that APK cannot provide emulator evidence. Plug
in the authorized Android phone before claiming this slice is device-verified.

---

## Session 2026-09-10/11 — parity completion (authoritative repo)

The authoritative repository is now `C:\Users\MIS\Downloads\MKJewelOS`, not
`C:\jos`. `C:\jos` is a stale clone; do not continue work there.

Every launcher destination now opens a real, data-backed native screen. The
only menu id without one is `meeting_ai`, which the web app does not
implement either.

Gaps closed this session:

- **Daily checklist gate** (`apps/mobile/src/features/daily-checklists/DailyChecklistGate.tsx`):
  the blocking daily routine acknowledgement every employee sees on web was
  missing entirely. It uses the same RPCs and core progress rule, and swallows the
  Android back button the way the web dialog swallows Escape.
- **Daily checklist authoring** in Settings for `super_admin`/`hr`, including the
  paste-SOP-lines shortcut.
- **Users** now matches the web Employee Directory: Add user (`invite-user`),
  branch/department filters, designation and mobile numbers, and super-admin
  password reset (`reset-user-password`). `inviteUser`/`resetUserPassword` live
  in `packages/data/src/users/api.ts` and refresh the session first.
- **Assigning Left** (`AssigningLeftScreen`), reached from Tasks for admins.
  Shared contract: `packages/data/src/taskImport/api.ts`.
- `eligibleBuddies` moved from web into `@jewelos/core`, and the web app now
  consumes it from there.

Intentionally not ported: spreadsheet bulk import (`/tasks/import`) and the
FMS graph canvas. Both are desktop tools; mobile keeps the FMS flow library
(publish/revise/activate).

Known duplicate: `apps/web/src/features/daily-checklists/api.ts` matches
`packages/data/src/dailyChecklists/api.ts` apart from the client accessor. Web
does not depend on `@jewelos/data` yet; add that dependency and delete the web
copy in a later slice.

Release signing: `android/app/build.gradle` reads the upgrade key from the
properties file named by `JEWELOS_KEYSTORE_PROPERTIES`, which is set in
`%USERPROFILE%\.gradle\gradle.properties` and kept outside Git. Write that file
**without a BOM**. A BOM silently renames the property, and the build falls
back to the debug key with only a warning.

Automated evidence:

```text
@jewelos/core test     28 files, 338 tests passed
@jewelos/data test      7 files,  40 tests passed
mobile test             4 files,  29 tests passed
turbo typecheck         5 packages passed; mobile tsc passed
web test               67 files, 317 tests; FmsFlowBuilder and DataPurgeCard
                        failed once under Gradle load, then passed when re-run alone
```

---

## Session 2026-09-11 — permissions parity, FMS console, invisible buttons

**Invisible buttons (the "no Sign in button" bug).** NativeWind 4.2.6 on
React Native 0.86 drops a function-form `style` on `Pressable`, so every button,
chip, picker trigger, and pressable card lost its background. A primary button
became near-white text on a near-white screen. `apps/mobile/src/ui/Pressable.tsx`
resolves the pressed state itself and hands NativeWind a plain style. **Always
import `Pressable` from `@/ui/Pressable`** when its `style` is a function.

**Ported from `1418ff7` (granular permissions):**
- `AuthProvider` loads `get_my_access_context` (shared
  `loadAccessContext`, with the same built-in fallback as web), sets
  `profile.user_role` to the effective role, and refreshes on the `settings` /
  `organization` realtime topics and whenever the app returns to the foreground.
  `useAccess()` gives screens the snapshot.
- Shell: the launcher, More sheet, and deep links all use `getAccessibleMenu` /
  `resolvePageAccess` with live section controls (`loadSectionControls`). Every
  destination, the four bottom tabs included, sits behind a gate that shows the
  web maintenance notice or a no-access message.
- `hasPermission` replaces role checks in Availability, Forms, Reports export,
  Dropdown Master, FMS, Notifications admin, Users, Settings, and the daily
  checklist manager.
- Settings: role vs dashboard authority, a separate permission for each panel,
  Developer Mode section list, permission management entry, and the Super
  Admin "Clear data" card.
- `PermissionManagementScreen` (Roles / Designations / Users) on the shared
  `packages/data/src/permissions/api.ts`.

**Ported from `d76c1a5` (single FMS section):** `FmsScreen` replaces the
Live-work / Flow-library split. The tab path is `/fms`. `FmsTasksScreen` is now
the live-instance list, scoped to one workflow when opened from a card. The
graph step designer stays on web; phones publish finished drafts.

**Also closed:** web `EditUser` parity (reports-to, buddies, system role, week
off, delete user) and the Notifications admin tabs (templates, rules, delivery
logs, provider status).

**Core oddity to resolve on web:** `getPageForPath` in `packages/core/src/roleMenu.ts`
has two `/tasks/fms` lines. The older `→ fms_tasks` line runs first, so the
FMS commit's `→ fms_builder` line is unreachable. Mobile routes both ids to the
FMS tab; web will send `/tasks/fms` links to its fallback page until the
duplicate is removed.

**Follow-up the same day (device feedback):**
- **Mixed light/dark colours.** NativeWind 4 reads dark mode from its own
  colour-scheme state, which follows the phone's system setting, not the `dark`
  class on the root view. `ThemeProvider` now calls
  `colorScheme.set(name)` on every change. Without that, a phone in system dark
  mode drew web-ported components (header, task cards) dark inside a light app.
- **Native FMS builder.** `FmsBuilderScreen` plus
  `features/fms/FmsGraphCanvas.tsx` and `FmsStageEditor.tsx` port the web
  builder, canvas, and step editor. Pointer input becomes drag and pinch;
  only desktop Shift+drag multi-select is left out. The pure helpers
  (`definition`, `graph`, `departments`) now also live in
  `packages/data/src/fms/`, with the web tests copied to `builder.test.ts`.
  Web still has its own copies until it depends on `@jewelos/data`.
- **"JewelOS isn't responding" every few minutes: not yet diagnosed.** No ANR
  trace has been captured: the phone keeps dropping off USB. Capture it with
  `adb shell dumpsys dropbox --print data_app_anr`. As a precaution, unchanged
  access and section-control refreshes no longer replace state (each
  replacement re-rendered the whole tree).
- **PowerShell patching trap.** In `@('a', 'b' + "`n" + 'c')` the comma binds
  tighter than `+`, so the replacement silently loses everything after the
  newline. Build replacement strings in variables first.

**Uploads (reported from the device, fixed 2026-09-12):**
- **"This file could not be read. Try a different one."** `pickFile` read the
  picked file with `FileSystem.readAsStringAsync`, which `expo-file-system` 57
  keeps only in `expo-file-system/legacy`; from the main module it throws at run
  time. **Every** upload failed this way — task evidence, task attachments, FMS
  stage evidence, and form file questions. It now reads through
  `new File(uri).arrayBuffer()`.
- A gallery photo re-encoded to JPEG could keep a `.HEIC` name, which the
  server rejects for mismatching its MIME type, so `pickFile` now corrects the
  extension to match the bytes.
- Task Upload offered the camera only. `chooseSource()` / `pickFileFromChooser()`
  now ask Camera / Gallery / Files, as a web file input does on a phone, and
  task completion passes `imagesOnly` because `uploadAndCompleteTask` takes
  JPEG, PNG, or WebP up to 5 MB. Task detail's two attach buttons became one
  "Attach a photo or file".

Automated evidence (2026-09-11):

```text
turbo typecheck         5/5 passed; mobile tsc passed
@jewelos/core test     30 files, 366 tests passed
@jewelos/data test      7 files,  40 tests passed
mobile test             4 files,  34 tests passed
web test               67 files, 317 tests passed
```

---

## Session 2026-09-12 — Recurring / To-Do parity, and two real defects

### Recurring / To-Do is ported (not yet exercised on the phone)

`RecurringTodoScreen.tsx` went from an 84-line read-only Work/Schedules list to
the full workspace. Everything the web page does, it now does:

- all 11 buckets (Today, Overdue, Rejected, Completed, Coverage Required,
  Manager Review, My Work, Schedules, Verification, Follow-ups, Performance);
- all 7 filters plus the date range, in a Filters sheet;
- all 11 stat tiles, in the web page's order and wording;
- schedule create, edit, pause/activate, run now, and delete;
- completion with the doer's own remark, on-behalf completion with its own
  question, checklist toggling, upload-to-complete, follow-ups, verify/reject;
- the Performance table, as per-employee cards.

New files: `features/recurringTodo/{RecurringWorkCard,RecurringScheduleCard,RecurringScheduleForm}.tsx`
and `ui/PromptSheet.tsx` — the touch replacement for `window.prompt`, which
Android has no equivalent of (`Alert.prompt` is iOS-only). Other ports that need
to ask a question should reuse it.

**Extraction first, as rule 3 requires.** `packages/core/src/recurringTodo.ts`
now holds every decision the page used to make inline: bucket membership,
the work-card action set, the remark rules, the status pill, the performance
totals, the manage-role check, and the schedule form's validation and payload.
`RecurringTodoPage.tsx` and `TaskForms.tsx` were refactored onto it and web
stayed green, which is what proves the extraction is faithful.

`packages/data/src/recurringTodo/` already mirrored the web API exactly, so no
new RPC was needed — only the two display rules were de-duplicated into core.

### Defect found and fixed: every task form submitted from the phone was rejected

`TaskFormScreen` called `submitForm(..., "task", taskId)`. Migration 0009 is
explicit:

```sql
if p_linked_module not in ('checklist_task','delegation_task') then
  raise exception 'Linked module is not an approved task module'
```

and it re-checks the value against the task's own `task_type`. So **every**
form a task required — from the Tasks feed and from Task Detail — failed on the
phone. Web has always sent `delegation_task` / `checklist_task`.

The mapping is now `taskFormLinkedModule()` in `packages/core/src/taskCardState.ts`;
both web call sites (`TasksPage`, `RecurringTodoPage`) and the mobile screen use
it, and `TaskForm` carries `taskType` as a route param. This was pre-existing,
not introduced by this session's work — but the new Complete form action would
have inherited it.

### Defect fixed: the dead `/tasks/fms` rule

`getPageForPath` had two `/tasks/fms` lines; the older `-> fms_tasks` won.
`fms_tasks` has no entry in `ALL_MENU_ITEMS` and no render branch in
`apps/web/src/App.tsx`, so web sent every `/tasks/fms` link to the fallback
page. The stale line is gone and the path resolves to `fms_builder`. Mobile
routed both ids to the FMS tab already, so it is unaffected.

### Forms builder groundwork

`features/forms/{fieldTypes,guidedConditions,routingMap}.ts` are pure and
depend only on core types, so they moved to `packages/core/src/forms/` with
their tests; the web files are one-line re-export shims. The builder UI itself
is not ported yet — this is step 2 of that port, done ahead of it.

### Duplicated API copies — a warning

`features/fms/definition.ts` and `graph.ts` have **diverged** from their
`packages/data/src/fms/` copies (51 vs 57 and 88 vs 93 lines). They are not
interchangeable. Whoever closes that item must diff and reconcile them
deliberately; deleting either side blind would change behaviour on one client.
`daily-checklists/api.ts` and `notifications/viewModel.ts` differ only in the
client accessor and are a straight swap.

### ANR: no new record, and a better reading of the old one

The dropbox still holds exactly two records, 10 and 11 Sept, both older than the
2026-09-11 18:25 build. Nothing new after installing this build. Still
unconfirmed under real use.

Re-reading the 11 Sept trace corrects the earlier diagnosis. It is a
memory-pressure ANR: `Heap: 1% free, 252MB/256MB`, RSS ~2 GB, 128% CPU in the
app, `kswapd0` at 34%, subject `Input dispatching timed out … Waited 10000ms`.
A Java heap pinned at its 256 MB ceiling is thrashing, not drawing. The
whole-tenant `loadFmsRuntime()` described in section 4.5 is the obvious
suspect and should be looked at first if it recurs.

### Evidence

```text
turbo typecheck         5/5 passed; mobile tsc passed
@jewelos/core test     34 files, 422 tests passed
@jewelos/data test      8 files,  61 tests passed
web test               65 files, 308 tests passed
mobile test             4 files,  35 tests passed
```

Web moved 320 -> 308 and core 409 -> 422 because 12 tests moved packages with
the code they cover. Nothing was dropped.

APK built (`BUILD SUCCESSFUL in 7m 23s`, 38,592,808 bytes), verified as
`CN=MK Jewels`, and installed with `-r` over the existing install.

**Device QA is still outstanding.** Nothing in this session has been used on the
phone by a person. Recurring / To-Do must not be reported complete until it has.

---

## Session 2026-09-12 (second) — performance, dark theme, and eight device defects

Eight items were reported from the phone with screenshots. Items 1, 4 and 6
turned out to be two shared root causes rather than six screen bugs, and are
fixed once, centrally.

### Root cause A — every long list mounted every row

`ui/Screen.tsx` wraps content in a plain `ScrollView` when `scroll` is set, and
screens `.map()`ed their rows into it. Nothing was virtualised, so a hundred
rows were a hundred synchronous layouts before the screen could paint. On Task
Control the snapshot was already in memory when a tab was tapped, which is what
proved the delay was mount cost and not the network.

**`apps/mobile/src/ui/ListScreen.tsx`** is the fix: a `FlatList` in the same
frame `Screen` provides, with everything that is not a row — headings, stat
tiles, tab strips, search boxes, filters — passed as `header`, so the page is
still one scroll surface and no list scrolls inside a page. It keeps `Screen`'s
padding, safe-area inset, keyboard handling and optional pinned footer.

Converted: `TaskControlScreen` (all four tabs on one list via a `Row` union,
three `memo`'d row components), `RecurringTodoScreen` (work / schedules /
performance), `UsersScreen` (row extracted to a `memo`'d `UserCard`),
`DropdownMasterScreen`. `TasksScreen`, `FmsTasksScreen`, `CrmScreen` and
`NotificationsScreen` were already on `FlatList`.

**A second, larger part of root cause A was a closed `Sheet` staying in the
tree.** A `Modal` with `visible={false}` draws nothing, but React still builds
and reconciles its children on every render of whatever owns it — and a sheet is
usually owned by a *row*. `RecurringWorkCard` held a `PromptSheet` each, and
`OptionPicker` renders a `Sheet` unconditionally, so the Availability screen was
building one modal per person. `Sheet` now returns `null` when closed, unmounting
300 ms after the slide-out so the animation is still seen. A sheet that owns a
`FlatList` passes `scrollable={false}`.

### Root cause B — a refetch on every keystroke

`RecurringTodoScreen` had `search` in the `useAsyncData` dependency list, so
every character fired a fresh `loadRecurringWorkspace()` **and** a
`loadTaskAuthoringReferenceData()`. Typing "invoice" was seven round trips of
each, six of them discarded. Image 1 showed it stuck on "Loading recurring
work...".

- `lib/useDebouncedValue.ts` settles the term (300 ms) before it reaches the
  loader. The screen still shows every keystroke. **The RPC and its filter
  payload are unchanged** — the server call is byte-identical to web's.
- `loadTaskAuthoringReferenceData()` does not depend on the filters at all, so
  it moved to its own `useAsyncData` that runs once on mount.

**Only this screen had the pattern.** All seven screens that use a search term
were checked: `CrmScreen` applies its search explicitly (`searchClients` on
submit), and Availability, Users, Notifications, Dropdown Master and the FMS
builder's assignee picker all filter in memory.

### Item 2 — sheets could not be scrolled, and a doubled asterisk

`Sheet` rendered its children straight into a `View` capped at `maxHeight: 75%`
with no scroll view, so **every** sheet in the app clipped anything taller than
that with no way to reach the rest. In image 2 the New recurring schedule form
was cut below "12 Sept 2026": the Due Time field, Task Controls, and the Save
button were all unreachable. The body is now a `ScrollView` with the grabber and
title fixed above it, inside a `KeyboardAvoidingView`, with
`keyboardShouldPersistTaps="handled"`. One fix covers the Filters sheet,
`PromptSheet`, `OptionPicker`, and the sheets in Users, Dropdown Master, Forms
and FMS. `DropdownEditor`'s own nested `ScrollView` was removed.

The doubled asterisk was ours, not web's: web's label string really is
"Core Task *", and `TextField` appended a second one. The wording therefore
stays verbatim and `ui/requiredMark.ts` suppresses the marker when a label
already ends in one. Wired into `TextField`, `ToggleField` and `FormField`.

### Item 3 — the dark theme

Measuring the palette first changed the diagnosis. **Text contrast was never
the problem:** `#C2B8AA` on `#201B16` was already 8.73:1 and gold `#D7B571` on
`#201B16` was 8.73:1, both far above AA's 4.5:1. What failed was structure —
card `#201B16` against page `#120F0C` was **1.12:1**, and the border `#52473A`
on a card was **1.89:1**, under AA's 3:1 for UI boundaries. The app read as one
edgeless near-black mass, which is what images 3 and 4 show.

Fourteen dark tokens moved, keeping the warm-brown identity. Light is untouched.

| token | before | after |
| --- | --- | --- |
| `obsidian` (page) | `#120F0C` | `#17130F` |
| `charcoal` / `task-bg` (card) | `#201B16` | `#2A231C` |
| `task-muted` | `#302921` | `#3A3127` |
| `task-border` | `#52473A` | `#7D6C58` |
| `soft-grey` | `#B5AC9F` | `#C6BDB0` |
| `task-text-muted` | `#C2B8AA` | `#CEC5B8` |
| `gold` / `task-accent` | `#D7B571` | `#DFBE7C` |
| `danger` | `#DC7670` | `#E9857F` |
| `success` | `#79A982` | `#87BB91` |
| `warning` / `task-warning` | `#DCAE52` | `#E3B75E` |
| `task-accent-soft` | `#483A25` | `#4F4028` |

Result: border on card **1.89 → 3.07** (now passes AA), border on page
2.11 → 3.66, card-vs-page separation 1.12 → 1.19, and the lowest text ratio
anywhere on a card is **5.99:1**. `champagne`, `white`, `gold-secondary` and
`task-overdue` are unchanged and stay above 6:1.

**This is a shared palette, so web's dark theme changed identically.** That is
the correct outcome under rule 2 — there is no mobile-only override, and none
should be added. `apps/web/src/index.css` and
`packages/ui-tokens/src/tokens.json` were changed together;
`apps/web/src/theme/tokens.test.ts` parses the CSS and passing proves they agree.

### Item 7 — Dropdown Master

**(a) The missing tiles** were added, with web's wording (Total / Active /
Inactive). The derivation is not the symmetrical thing it looks like, so it went
to `packages/core/src/dropdownMaster.ts` with tests and **web was pointed at it
first** (web stayed at 308). `Total` and `Inactive` count the whole category and
ignore the search box and status filter; `Active` counts only the visible rows.
That asymmetry is the approved page's, and is reproduced rather than corrected —
see the divergence note in the playbook. `filterDropdownMasterItems` went with
it, so the two clients now filter identically; mobile previously searched only
label and value, web label, value and category.

**(b) The raw Postgres error** in image 5 —
`duplicate key value violates unique constraint "dropdown_masters_tenant_id_master_type_value_key"`
— was **not a mobile bug**. Web's `errorMessage()` returns `error.message` just
the same, so web shows the identical text. Fixing it only in mobile would have
created a divergence, so it is fixed in `packages/data/src/writeErrors.ts`:
`writeError(message)` maps a known constraint to a sentence at the point the
write is made, and both clients show it because it is the thrown Error's
`message`. The database's own text is kept on `WriteRejected.technicalMessage`
for diagnostics, and an **unmapped** failure passes through unchanged — a wrong
guess reads worse than a technical truth. Wired into `changeMasterOption` and
`createMasterList`. The server check stays authoritative; nothing is pre-checked.

### Item 8 — collapsible home sections

`HomeScreen`'s local `Section` header is now a real button
(`accessibilityRole="button"`, `accessibilityState={{ expanded }}`, full-width
at `theme.touchTarget`) with a chevron. Open by default, state held in the
component so it lasts the session only. The body is hidden with
`display: "none"`, never unmounted, so collapsing cannot trigger a refetch.
Titles and contents are untouched.

### Item 5 was blank in the report. Nothing was done for it.

### Evidence

```text
turbo typecheck         5/5 passed; mobile tsc passed
@jewelos/core test     35 files, 431 tests passed   (was 34 / 422)
@jewelos/data test      9 files,  68 tests passed   (was  8 /  61)
web test               65 files, 308 tests passed   (unchanged — the extraction
                                                     is faithful)
mobile test             5 files,  38 tests passed   (was  4 /  35)
```

New tests: `dropdownMaster` (9, core), `writeErrors` (7, data), `requiredMark`
(3, mobile). Nothing moved packages this session.

### ANR: a third record, and it names root cause A

A **new** record appeared at `2026-09-12 13:20:46`, during the reporter's own
session on the pre-fix build (the Recurring / To-Do build installed the previous
day). The dropbox now holds three, and the freeze is **no longer unconfirmed
under real use**.

It is not the same failure as the 11 Sept one, and the difference matters:

| | 2026-09-11 17:50 | 2026-09-12 13:20 |
| --- | --- | --- |
| RSS | ~2,066 MB | 785 MB |
| Java heap | 1% free, 252/256 MB | not pinned |
| app CPU | 128% | 101%, **98% user** |
| `kswapd0` | 34% | not significant |
| main thread | blocked | **`state=R`, running** |

The 11 Sept record is memory pressure. **Today's is a CPU-bound main thread**,
and its stack says exactly what it was doing:

```
"main" prio=5 tid=1 Runnable
  at android.view.View.getTag
  at com.facebook.react.uimanager.BlendModeHelper.needsIsolatedLayer
  at com.facebook.react.views.view.ReactViewGroup.drawChild
  at android.view.ViewGroup.dispatchDraw
  ...
  at android.widget.ScrollView.draw
  at com.facebook.react.views.scroll.ReactScrollView.draw
```

That is a `ReactScrollView` drawing its children, one `drawChild` at a time,
for longer than the 10 second input-dispatch deadline — an unvirtualised
`Screen scroll` with every row mounted. It is root cause A caught in the act,
and it is the direct justification for `ListScreen`.

**So the two ANRs have two different causes and need two different fixes.**
This session's list virtualisation addresses the 13:20 one. The whole-tenant
`loadFmsRuntime()` remains the suspect for the 11 Sept memory-pressure one and
is still untouched — do not treat the list work as having closed that.

Baseline for the next session: three records, the newest `2026-09-12 13:20:46`,
all from builds **older** than the 14:33 install. Anything newer than that is
new evidence about this session's work.

### Still open

- Availability, Forms Library, FMS console and Permission Management still
  `.map()` into `Screen scroll`. They are smaller lists, and the `Sheet` unmount
  fix removes the worst of Availability's cost (one modal per person), but they
  should move to `ListScreen` when next touched.
- Dropdown Master still lacks web's all/active/inactive status filter.
- `features/fms/{definition,graph}.ts` vs `packages/data/src/fms/` remain
  diverged (51 vs 57 and 88 vs 93 lines). Untouched this session.

---

## Session 2026-09-12 (third) — Task Control parity, and the real cause of the recurring slowness

### The headline: it is a 12 MB payload, not a slow query

Measured on the **production** database, not inferred:

```
task_instances   5,672 rows     form_submissions     25 rows
task_assignees   5,672          task_checklists   1,304
task_templates   1,456          task_comments         0

get_recurring_todo_workspace('{}') as the real actor:  1,482 ms
response payload:                                     12,366 KB
  instances 10,473 KB   templates 1,893 KB   stats 0 KB
statement_timeout for the authenticated role:              8 s
```

**The query is not slow.** 1.5 s against an 8 s budget. The minute the user sees
is a **12 MB JSON document** crossing a mobile network and being parsed by
Hermes into a JS object graph. The intermittent
`cancelling statement due to statement timeout` is that 1.5 s occasionally
overrunning the 8 s budget under load.

This also lines up with the 2026-09-11 memory-pressure ANR — Java heap pinned at
252/256 MB, RSS ~2 GB. A 12 MB JSON parsed into objects is comfortably enough to
do that. **The ANR and the slowness are very likely the same defect.** Earlier
notes blamed `loadFmsRuntime()`; on this evidence the recurring workspace is at
least as strong a suspect.

Web pays the same 12 MB, but on broadband with V8 it is tolerable. That is why
this reads as a mobile bug and is not one.

### Three wrong turns, all caught by measuring

Recorded so the next session does not repeat them:

1. **"It is client-side mount cost."** The first pass fixed Recurring as a
   rendering problem. The reporter's error message was a *server* statement
   timeout. The brief's "pure mount cost, not network" was true and verified for
   Task Control and was carried across to Recurring without checking the RPC.
2. **"Fold the two scans into one."** Implemented, benchmarked, reverted — about
   **20% slower** (18.6 s vs 15.3 s on a synthetic 40,000-row tenant). The
   statistics pass it would remove measures **3 ms**; deriving `visible` from a
   wider materialised set costs more than it saves.
3. **"The Seq Scan on form_submissions is the cause."** Found in a real
   `auto_explain` plan, and genuinely a defect — but `form_submissions` holds
   **25 rows** in production, so it costs nothing today. A synthetic benchmark
   made it look important; the production row count settled it.

A fourth correction: the handoff previously said only the mobile screen had
`search` in its loader dependency list. **Web has it too**
(`RecurringTodoPage.tsx:378`, undebounced), so the browser also fires one
cancelled query per keystroke. Only the mobile screens had been audited.

### `0159_recurring_workspace_submissions_scan.sql` — written, NOT applied

Two small, correct, equivalence-tested read fixes. **Neither fixes the reported
problem**, and the file's own header says so in its first two lines:

1. `s.tenant_id = v_actor.tenant_id` on the `form_submissions` join, so
   `idx_form_submissions_task_completion` (which leads with `tenant_id`) becomes
   usable instead of a Seq Scan. Worth nothing at 25 rows; worth something as
   that table grows, which it does with every form ever submitted.
2. `idx_task_instances_recurring_window` on
   `(tenant_id, planned_datetime) where task_template_id is not null`, matching
   the predicate the range scan actually uses.

Equivalence was tested, not asserted: the 0118 function was created alongside as
`..._old` and both were run over sixteen filter combinations — default, wide and
narrow windows, each search, status, priority, branch, department and
schedule_kind filter, and all at once — comparing the entire JSONB result. All
sixteen identical, including the deliberate asymmetry where a search narrows
`instances` while `stats.total` stays at the unsearched count.

**It was not applied.** `supabase db push` is blocked in this environment as a
production deploy. Routing the DDL through `supabase db query` would have
bypassed the intent of that block, so it was not attempted.

**Also found while preparing to push:** an untracked
`0160_fms_assigned_work_contract.sql` (FMS assigned-work view contract) that this
session did not write. `supabase db push` applies *all* pending migrations, so it
would have gone to production as a side effect. 0160 was temporarily moved aside
and then restored untouched. Whoever pushes 0159 must decide about 0160
deliberately.

### The actual fix, which needs agreement

Cutting the 12 MB. Two routes, both shared-contract changes:

- **Paginate `instances`.** The phone shows one bucket at a time and never needs
  5,672 occurrences at once.
- **Select columns instead of `to_jsonb(v)`,** which currently emits every
  column of `task_instances` whether a client reads it or not.

Either changes `parseRecurringWorkspace`, which types rows as whole
`Tables<"task_instances">` / `Tables<"task_templates">` records, so web changes
too. Not done unilaterally.

### Task Control now matches web

`TaskControlScreen.tsx` went from a 68-line read-only summary to the full
workspace: the filter bar as a sheet (five range presets, custom dates, branch,
department, user, search, reset, scope summary), Overview with all five tiles
plus Needs attention / By branch / By department / Evidence gaps, People ordered
worst-first, Tasks with all seven view chips, server pagination and signed-URL
evidence, and Templates with all twelve values and all four actions. New files:
`features/taskControl/{TaskControlFilterSheet,panels,rows}.tsx`.

Rule 3 followed: role gating, tab metadata, view chips and display helpers moved
to `packages/core/src/taskControlView.ts` with 15 tests, and **web was refactored
onto them first** — web stayed at 308. Two web guard tests asserted the role
constants by reading the page source; they now assert the shared functions, with
membership covered properly in core.

### Evidence

```text
turbo typecheck         5/5 passed; mobile tsc passed
@jewelos/core test     36 files, 442 tests passed   (was 35 / 431)
@jewelos/data test      9 files,  68 tests passed
web test               65 files, 308 tests passed   (unchanged)
mobile test             5 files,  38 tests passed
```

APK built and verified `CN=MK Jewels` (38,639,512 bytes). **Not installed** —
the phone was off USB. Task Control has never been used by a person.

## FMS assigned-work contract and canvas containment (2026-09-12)

One persisted work item is now reachable from Home, Notifications, Tasks, a
direct URL, web and native, through one shared destination contract:
`fmsAssignedWorkPath` / `parseFmsAssignedWorkPath` in `@jewelos/core`, mapped to
native routes by `apps/mobile/src/features/fms/assignedWorkNavigation.ts`. The
web-only `features/fms/deepLink.ts` helper was deleted; nothing infers assigned
work from a form id any more.

Migration `0160` adds `fms_work_source`, `fms_instance_id`,
`fms_instance_stage_id` and `fms_starter_assignment_id` to `v_all_tasks`, adds
pending starter assignments as feed rows, and closes the matching notification
by trigger when the underlying assignment completes.

`fetchHomeSummary` in `@jewelos/data` now resolves each runtime stage's pinned
form, which it previously did only in the web copy — native Home could not tell
"open the workflow" from "complete this exact form" before this.

Native canvas: edge groups inside `<Svg>` were React Native `<View>` elements,
which `react-native-svg` cannot host; they are `<G>` now. `FmsBuilderScreen` no
longer wraps the canvas in a vertical `ScrollView` — the canvas sits in a
bounded region above a separately scrolling editor, so a one-finger vertical pan
reaches the canvas instead of the parent scroll view.

### Evidence

```text
turbo typecheck         5/5 passed; mobile tsc passed
turbo build             5/5 passed
@jewelos/core test     38 files, 469 tests passed   (was 37 / 449)
@jewelos/data test      9 files,  68 tests passed
web test               65 files, 315 tests passed   (was 65 / 310)
mobile test             6 files,  47 tests passed   (was 5 / 38)
supabase db reset       full migration chain applied cleanly
supabase test db       0160 passed, 28 assertions
supabase db lint        no new warning
git diff --check        clean
```

**Not verified.** No authenticated browser pass and no Android device/emulator
run were performed in this session, so none of the touch behaviour, the canvas
gesture work, or the cross-surface flows have been seen by a person. The manual
rows in `docs/REGRESSION_CHECKLIST.md` ("Assigned FMS work") are the pass to run.

Three pgTAP files fail and did so before this work: `0006` (its reviewed
function-count baseline predates committed migrations 0157/0158), `0106`
(`task_import_identity_aliases` is unclassified in the retirement manifest), and
`0139` (`get_employee_task_progress` was redefined by 0156). None of the three
involve FMS.

### Still outstanding

- The native canvas still uses `PanResponder` with React state per pointer move.
  Moving it to Gesture Handler + Reanimated shared values needs device
  verification, which was not available here.
- `apps/mobile/vitest.config.ts` includes only `src/**/*.test.ts` and the app
  carries no React Native rendering preset, so component-level (`.tsx`) tests
  for the canvas and for a native Forms Builder cannot run yet. That preset is a
  prerequisite for the remaining native plans.
