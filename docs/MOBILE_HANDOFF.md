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
