# Android Parity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the divergent Android shell with the approved web phone shell, make light/dark mode affect the complete existing native app, and route role-authorized launcher items to every already implemented native screen.

**Architecture:** Keep React Navigation as the native routing engine, but render the approved four-action `MobileBottomNav` as its custom tab bar and keep My Apps/More as sheets owned by `AppTabs`. Put path-to-native-route and role-filtered launcher derivation in a pure `shellModel.ts` module so navigation behavior is testable without a native renderer. Use the existing `ThemeProvider` and migrate every static palette consumer to `makeStyles`/`useAppTheme`, leaving NativeWind classes driven by the root `dark` class.

**Tech Stack:** React Native 0.86, Expo 57, React Navigation 7, NativeWind 4, TypeScript 5.9, Vitest 4, `@jewelos/core`, `@jewelos/data`, `@jewelos/ui-tokens`, Supabase.

**Spec:** `docs/superpowers/specs/2026-09-09-android-web-parity-design.md`

## Global Constraints

- Android only; the deliverable for the complete project is a signed APK.
- Preserve application ID `com.jewelos.mobile`.
- No Capacitor, Cordova, Ionic, WebView wrapper, mock backend, local shadow database, duplicated authorization, or mobile-only business rules.
- `C:\jos` is the active repository and `apps/web` is the approved behavioral/visual reference.
- Preserve unrelated dirty work and stage only named paths.
- Use `npm --prefix apps/mobile` for mobile dependency and script commands; do not place mobile under pnpm.
- Light is the default theme and the preference key remains `jewelos-theme`.
- Bottom navigation is exactly Home, Tasks, My Apps, More.
- Placeholder routes for unported feature slices may remain during this foundation slice, but already implemented Home, Tasks, CRM, and FMS Tasks screens must be reachable without a placeholder.
- All user-facing text must use valid UTF-8 punctuation; do not introduce mojibake.

---

### Task 1: Establish a Reproducible Baseline and Pure Shell Contract

**Files:**
- Create: `apps/mobile/src/navigation/shellModel.test.ts`
- Create: `apps/mobile/src/navigation/shellModel.ts`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `packages/core/src/roleMenu.test.ts`
- Modify: `packages/core/src/roleMenu.ts`

**Interfaces:**
- Consumes: `getMenuForRole(role)`, `getPageForPath(path)`, `PageId`, `UserRole` from `@jewelos/core`.
- Produces: `NativeTopLevelRoute = "Home" | "Tasks" | "Fms" | "Crm"`; `resolveNativeDestination(path): { kind: "tab"; route: NativeTopLevelRoute } | { kind: "section"; page: PageId } | null`; `buildLauncherItems(role): readonly ShellLauncherItem[]`; `pathForTopLevelRoute(route): string`.

- [ ] **Step 1: Record repository and machine baseline**

Run:

```powershell
git status --short --branch
git rev-parse --git-dir
git rev-parse --git-common-dir
Get-PSDrive C
node --version
pnpm.cmd --version
npm --version
```

Expected: `C:\jos` is on `main`, has the handed-off uncommitted migration, Node satisfies the workspace requirement, and enough disk space remains for TypeScript and Metro verification. Work in place because the handed-off native implementation exists only in the dirty checkout; do not create an isolated worktree that omits it.

- [ ] **Step 2: Run the pre-change automated baseline**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
npm --prefix apps/mobile run test
npm --prefix apps/mobile run typecheck
```

Expected: all commands exit 0. If a command fails, stop and diagnose the baseline before attributing it to this slice.

- [ ] **Step 3: Write failing shell-model tests**

Create `apps/mobile/src/navigation/shellModel.test.ts` with cases equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { buildLauncherItems, pathForTopLevelRoute, resolveNativeDestination } from "./shellModel";

describe("resolveNativeDestination", () => {
  it.each([
    ["/", "Home"],
    ["/tasks", "Tasks"],
    ["/tasks/checklist", "Tasks"],
    ["/tasks/fms", "Fms"],
    ["/crm", "Crm"],
  ] as const)("maps %s to the implemented %s tab", (path, route) => {
    expect(resolveNativeDestination(path)).toEqual({ kind: "tab", route });
  });

  it("routes an authorized feature path through the section stack", () => {
    expect(resolveNativeDestination("/settings")).toEqual({ kind: "section", page: "settings" });
  });

  it("rejects unknown paths", () => {
    expect(resolveNativeDestination("/not-a-jewelos-page")).toBeNull();
  });
});

describe("buildLauncherItems", () => {
  it("keeps core menu order and excludes destinations without approved app descriptions", () => {
    const items = buildLauncherItems("staff");
    expect(items.map((item) => item.id)).toEqual([
      "home", "dashboard", "checklist_tasks", "fms_builder", "forms_library",
      "availability", "reports", "settings",
    ]);
  });

  it("does not expose pages forbidden to the role", () => {
    expect(buildLauncherItems("housekeeping").some((item) => item.id === "crm")).toBe(false);
  });
});

it("uses the approved web paths for visible native tabs", () => {
  expect(pathForTopLevelRoute("Home")).toBe("/");
  expect(pathForTopLevelRoute("Tasks")).toBe("/tasks");
  expect(pathForTopLevelRoute("Fms")).toBe("/tasks/fms");
  expect(pathForTopLevelRoute("Crm")).toBe("/crm");
});
```

- [ ] **Step 4: Run the shell-model test and verify RED**

Run:

```powershell
npm --prefix apps/mobile run test -- src/navigation/shellModel.test.ts
```

Expected: FAIL because `shellModel.ts` and its exports do not exist. The existing core path test added in the next step must also demonstrate that `/tasks/fms` is not yet recognized.

- [ ] **Step 5: Implement the minimal pure shell model**

First add this regression assertion to `packages/core/src/roleMenu.test.ts` and run it to observe RED:

```ts
expect(getPageForPath("/tasks/fms")).toBe("fms_tasks");
```

Then extend the special task-path mapping in `packages/core/src/roleMenu.ts` so `/tasks/fms` resolves to `fms_tasks`. This fixes the current mismatch where the approved Home screen links to `/tasks/fms` but the shared resolver does not recognize it. Run the focused core test to observe GREEN.

Create `shellModel.ts` with typed top-level route/path maps, the same implemented-page set and launcher descriptions used by the web shell, and pure functions matching the interfaces above. Use `getPageForPath()` rather than duplicating alias handling. Do not import React Native, React Navigation, or icon components into this module.

Update `types.ts` so `TabParamList` contains only the renderable content tabs `Home`, `Tasks`, `Fms`, and `Crm`. Remove `More` as a screen because More is an action sheet, not a destination. Retain all existing detail-stack parameter types.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npm --prefix apps/mobile run test -- src/navigation/shellModel.test.ts
npm --prefix apps/mobile run typecheck
pnpm.cmd --filter @jewelos/core test -- src/roleMenu.test.ts
```

Expected: shell-model tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit only the shell contract**

```powershell
git add -- apps/mobile/src/navigation/shellModel.test.ts apps/mobile/src/navigation/shellModel.ts apps/mobile/src/navigation/types.ts packages/core/src/roleMenu.test.ts packages/core/src/roleMenu.ts
git diff --cached --check
git commit -m "feat(mobile): define approved shell navigation contract"
```

---

### Task 2: Make Theme Coverage Enforceable Across the Native App

**Files:**
- Create: `apps/mobile/src/theme/themeCoverage.test.ts`
- Modify: `apps/mobile/src/lib/NetworkBanner.tsx`
- Modify: `apps/mobile/src/forms/DateField.tsx`
- Modify: `apps/mobile/src/forms/FileField.tsx`
- Modify: `apps/mobile/src/forms/FormField.tsx`
- Modify: `apps/mobile/src/forms/FormRenderer.tsx`
- Modify: `apps/mobile/src/forms/RatingField.tsx`
- Modify: `apps/mobile/src/forms/ToggleField.tsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/ClientDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/CrmScreen.tsx`
- Modify: `apps/mobile/src/screens/FmsInstanceScreen.tsx`
- Modify: `apps/mobile/src/screens/FmsStageScreen.tsx`
- Modify: `apps/mobile/src/screens/FmsTasksScreen.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/LoginScreen.tsx`
- Modify: `apps/mobile/src/screens/MoreScreen.tsx`
- Modify: `apps/mobile/src/screens/ProfileScreen.tsx`
- Modify: `apps/mobile/src/screens/TaskDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/TasksScreen.tsx`
- Modify: `apps/mobile/src/screens/WalkinScreen.tsx`
- Modify: `apps/mobile/src/ui/Button.tsx`
- Modify: `apps/mobile/src/ui/Card.tsx`
- Modify: `apps/mobile/src/ui/OptionPicker.tsx`
- Modify: `apps/mobile/src/ui/Screen.tsx`
- Modify: `apps/mobile/src/ui/SearchField.tsx`
- Modify: `apps/mobile/src/ui/SegmentedControl.tsx`
- Modify: `apps/mobile/src/ui/Sheet.tsx`
- Modify: `apps/mobile/src/ui/states.tsx`
- Modify: `apps/mobile/src/ui/Text.tsx`
- Modify: `apps/mobile/src/ui/TextField.tsx`

**Interfaces:**
- Consumes: `makeStyles(factory)` and `useAppTheme()` from the existing theme system.
- Produces: every rendered static `StyleSheet` is recomputed from the active theme; no application component imports the module-level `theme` singleton.

- [ ] **Step 1: Write a failing architecture guard**

Create `themeCoverage.test.ts` using `node:fs` and `node:path`. Recursively inspect `apps/mobile/src`, ignore `theme/theme.ts`, `theme/ThemeProvider.tsx`, `theme/makeStyles.ts`, and test files, and assert that no remaining source file contains an import whose module specifier is `@/theme/theme`.

The failure message must list every violating relative path so future regressions are actionable.

- [ ] **Step 2: Run the guard and verify RED**

Run:

```powershell
npm --prefix apps/mobile run test -- src/theme/themeCoverage.test.ts
```

Expected: FAIL listing the current static-theme consumers.

- [ ] **Step 3: Migrate primitives and shared form controls**

For every listed file whose `StyleSheet.create` references `theme`, replace the module-level import and stylesheet with:

```ts
import { makeStyles } from "@/theme/makeStyles";

const useStyles = makeStyles((theme) => StyleSheet.create({
  // existing style object, unchanged except that theme is now the callback argument
}));
```

Inside each component call `const styles = useStyles();`. If render-time values such as `RefreshControl.colors`, icon colors, or modal props also need the palette, add `const theme = useAppTheme();`. Do not rename colors or alter spacing during this mechanical migration.

- [ ] **Step 4: Run the theme guard and type-check after the primitives batch**

Run:

```powershell
npm --prefix apps/mobile run test -- src/theme/themeCoverage.test.ts
npm --prefix apps/mobile run typecheck
```

Expected: the guard may still fail only for screens/navigation not yet migrated; TypeScript exits 0.

- [ ] **Step 5: Migrate screens and navigation**

Apply the same `makeStyles`/`useAppTheme` conversion to all listed screens and `RootNavigator.tsx`. Construct the React Navigation theme inside `RootNavigator` with `useMemo` from the active palette and set `dark: name === "dark"`. Drive `headerStyle`, `headerTintColor`, and `headerTitleStyle` from the same active palette.

- [ ] **Step 6: Verify GREEN and full source coverage**

Run:

```powershell
npm --prefix apps/mobile run test -- src/theme/themeCoverage.test.ts
rg -n '@/theme/theme' apps/mobile/src
npm --prefix apps/mobile run typecheck
```

Expected: test passes, `rg` finds only the three allowed theme implementation imports (or none outside them), and type-check exits 0.

- [ ] **Step 7: Commit only theme coverage changes**

Stage `themeCoverage.test.ts` plus the explicitly migrated mobile files, inspect `git diff --cached --name-status`, run `git diff --cached --check`, and commit:

```powershell
git commit -m "fix(mobile): apply light and dark themes throughout"
```

---

### Task 3: Build the Approved Android Header and Theme Control

**Files:**
- Create: `apps/mobile/src/components/shell/ThemeToggle.tsx`
- Create: `apps/mobile/src/components/shell/MobileHeader.tsx`
- Modify: `apps/mobile/src/navigation/shellModel.test.ts`
- Modify: `apps/mobile/src/navigation/shellModel.ts`
- Modify: `apps/mobile/src/components/shell/MoreSheet.tsx`

**Interfaces:**
- Consumes: `useTheme()`, authenticated profile and branch data, `LauncherItem`, and `onNavigate(path)`.
- Produces: `ThemeToggle`; `MobileHeader({ onOpenMore, onNavigate, profileName })`; accessible labels returned by `themeToggleLabel(themeName)`.

- [ ] **Step 1: Add a failing theme-toggle contract test**

Append to `shellModel.test.ts`:

```ts
import { themeToggleLabel } from "./shellModel";

it("describes the theme the toggle will activate", () => {
  expect(themeToggleLabel("light")).toBe("Switch to dark mode");
  expect(themeToggleLabel("dark")).toBe("Switch to light mode");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm --prefix apps/mobile run test -- src/navigation/shellModel.test.ts
```

Expected: FAIL because `themeToggleLabel` is not exported.

- [ ] **Step 3: Implement the label helper and React Native theme toggle**

Implement `themeToggleLabel(name)` in `shellModel.ts`. Build `ThemeToggle.tsx` as the React Native port of `apps/web/src/components/ThemeToggle.tsx`: a 40dp `Pressable`, Moon/Sun from `lucide-react-native`, `accessibilityRole="switch"`, `accessibilityState={{ checked: name === "dark" }}`, the tested action label, and `toggleTheme()` from the provider. Retain the web Tailwind classes with `active:` replacing `hover:`.

- [ ] **Step 4: Build the phone header**

Build `MobileHeader.tsx` from the phone branch of `ApplicationShell.tsx`: 56dp height, task-border divider, task background, MK Jewels brand mark/text at the left, and theme toggle, notifications action, and initial-avatar More action at the right. Derive initials using the existing formatter. Notification press calls `onNavigate("/notifications")`; avatar press calls `onOpenMore`.

Do not add desktop sidebar controls or developer-mode controls to the Android phone header.

- [ ] **Step 5: Keep More behavior aligned with the web**

Retain the profile, role, branch, role-filtered navigation, and sign-out affordance in `MoreSheet`. Confirm it uses theme-responsive NativeWind classes and does not duplicate a second static theme control.

- [ ] **Step 6: Verify the header batch**

Run:

```powershell
npm --prefix apps/mobile run test -- src/navigation/shellModel.test.ts
npm --prefix apps/mobile run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit only the header batch**

```powershell
git add -- apps/mobile/src/components/shell/ThemeToggle.tsx apps/mobile/src/components/shell/MobileHeader.tsx apps/mobile/src/components/shell/MoreSheet.tsx apps/mobile/src/navigation/shellModel.ts apps/mobile/src/navigation/shellModel.test.ts
git diff --cached --check
git commit -m "feat(mobile): match the approved phone header"
```

---

### Task 4: Replace the Invented Five-Tab Shell

**Files:**
- Modify: `apps/mobile/src/navigation/AppTabs.tsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/components/shell/MobileBottomNav.tsx`
- Modify: `apps/mobile/src/components/shell/AppLauncher.tsx`
- Delete: `apps/mobile/src/screens/MoreScreen.tsx`

**Interfaces:**
- Consumes: `resolveNativeDestination`, `pathForTopLevelRoute`, `buildLauncherItems`, `MobileHeader`, `MobileBottomNav`, `AppLauncher`, `MoreSheet`, auth profile/branch/logout, and React Navigation tab/stack navigators.
- Produces: authenticated shell with four approved actions and role-aware navigation to implemented screens or the temporary section placeholder for later slices.

- [ ] **Step 1: Extend failing shell-model tests for deep task aliases and launcher parity**

Add cases for `/tasks/delegation`, `/tasks/import`, `/tasks/assigning-left`, `/task-evidence`, all implemented top-level paths, and each supported user role. Assert that menu order matches `getMenuForRole`, forbidden pages never appear, and menu-only IDs (`meeting_ai`, `delegation_tasks`, `task_evidence`) do not appear as launcher apps unless the approved web shell exposes them.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm --prefix apps/mobile run test -- src/navigation/shellModel.test.ts
```

Expected: at least one new alias or launcher-filter assertion fails until the model implements the complete web contract.

- [ ] **Step 3: Complete the pure destination model**

Update only `shellModel.ts` until all new model tests pass. Preserve exact core paths and aliases; do not invent native-only page identifiers.

- [ ] **Step 4: Integrate the custom tab bar and sheets**

Refactor `AppTabs.tsx` to:

- render only content tabs Home, Tasks, FMS Tasks, and CRM;
- hide the default React Navigation tab chrome;
- render `MobileHeader` above the active screen;
- render the already ported `MobileBottomNav` below it;
- open `AppLauncher` and `MoreSheet` for My Apps and More instead of navigating to screens;
- derive launcher entries from the authenticated role;
- send Home/Tasks/FMS/CRM destinations to the corresponding content tab;
- send every other known destination to `RootStackParamList["Section"]` until its real screen is delivered in a later parity slice;
- close a sheet before completing navigation;
- preserve native detail navigation from each content screen.

Supply the actual current web path to `MobileBottomNav`, so Home and all task aliases select the same active states as the web component.

- [ ] **Step 5: Align the root navigation theme and remove the fake More screen**

Keep `Tabs` headerless because `MobileHeader` owns phone chrome. Retain native headers for detail and editor routes, driven by the active theme. Remove `MoreScreen` from tab types, screen maps, and imports, then delete the file.

- [ ] **Step 6: Verify navigation integration**

Run:

```powershell
npm --prefix apps/mobile run test
npm --prefix apps/mobile run typecheck
npx --yes expo export --platform android --output-dir artifacts/foundation-export
```

Expected: all mobile tests pass, TypeScript exits 0, and Expo writes an Android bundle without Metro resolution errors.

- [ ] **Step 7: Commit only shell integration changes**

```powershell
git add -- apps/mobile/src/navigation/AppTabs.tsx apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/navigation/types.ts apps/mobile/src/components/shell/MobileBottomNav.tsx apps/mobile/src/components/shell/AppLauncher.tsx apps/mobile/src/screens/MoreScreen.tsx
git diff --cached --check
git commit -m "feat(mobile): install approved four-action shell"
```

---

### Task 5: Foundation Regression and Physical-Device Gate

**Files:**
- Modify: `docs/MOBILE_HANDOFF.md`
- Modify: `docs/MOBILE_MIGRATION_PLAN.md`

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: fresh automated evidence, Android bundle evidence, and authenticated device observations for the foundation slice.

- [ ] **Step 1: Run complete automated regression**

Run:

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force
npm --prefix apps/mobile run test
npm --prefix apps/mobile run typecheck
pnpm.cmd --filter web build
```

Expected: every command exits 0. Record exact test-file/test-case counts from output rather than copying older handoff numbers.

- [ ] **Step 2: Produce a fresh Android bundle**

Run from `apps/mobile`:

```powershell
npx expo export --platform android --output-dir ..\..\artifacts\foundation-export
```

Expected: Expo exits 0 and writes an Android Hermes bundle and assets.

- [ ] **Step 3: Reuse or rebuild the debug APK appropriately**

Because this foundation slice changes JavaScript only, first use the existing dev-client APK. Rebuild only if native configuration/dependencies changed or the existing artifact is missing:

```powershell
cd C:\jos\apps\mobile\android
.\gradlew.bat assembleDebug --no-daemon --max-workers=1
```

Expected when run: `BUILD SUCCESSFUL` and `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 4: Install and run on the authorized Android device**

Run:

```powershell
adb devices -l
adb install -r "C:\jos\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
adb reverse tcp:8081 tcp:8081
```

Start the dev client from `apps/mobile` with `npx expo start --dev-client --clear`. Confirm separately:

- header matches the web phone header;
- bottom actions are exactly Home, Tasks, My Apps, More;
- Home and Tasks active states are correct;
- My Apps and More open sheets rather than screens;
- role-forbidden destinations are absent;
- Home, Tasks, CRM, and FMS Tasks open real screens;
- unported destinations reach the temporary placeholder and remain explicitly tracked;
- light/dark toggle changes all visible surfaces, navigation headers, status bar, modals, forms, and existing screens;
- theme persists after force-close/reopen;
- Android back closes sheets before leaving the current screen;
- sign-out returns to authentication and protected content is unmounted.

- [ ] **Step 5: Update handoff documents with observed evidence**

Record commands, exit codes, test counts, bundle path, APK path, device model/serial state, and any visual or behavioral discrepancy. Do not report a device check that was not actually performed.

- [ ] **Step 6: Commit the verified foundation documentation**

```powershell
git add -- docs/MOBILE_HANDOFF.md docs/MOBILE_MIGRATION_PLAN.md
git diff --cached --check
git commit -m "docs: record Android parity foundation verification"
```

## Foundation Exit Criteria

- Four approved bottom actions replace the divergent five-tab bar.
- Theme switching visibly affects the entire currently implemented native app and persists.
- Header and sheets match the approved web phone shell.
- Home, Tasks, CRM, and FMS Tasks use real native screens.
- All existing detail/form/FMS navigation remains usable.
- No forbidden route is exposed for the signed-in role.
- Full automated regression and Android export pass with fresh evidence.
- Physical-device observations are recorded separately from automated evidence.
- Remaining placeholder sections are enumerated as the next vertical parity plans, not presented as completed functionality.
