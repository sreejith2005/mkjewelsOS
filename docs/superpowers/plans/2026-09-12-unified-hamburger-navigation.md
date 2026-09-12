# Unified Hamburger Navigation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace duplicate compact My Apps and More entry points with one accessible hamburger drawer in web and Android, retaining every route, access decision, and desktop sidebar behavior.

**Architecture:** Keep the desktop web aside and its collapse control. Add platform-specific compact drawer overlays that consume existing permission-filtered launcher items and call the existing web navigate and native navigatePath contracts. The compact dock becomes Home and Tasks only; native FMS, CRM, and Section tab registrations remain unchanged.

**Tech Stack:** React 18/Vite, TypeScript, Tailwind, Vitest/Testing Library; Expo/React Native, React Navigation tabs, NativeWind, Vitest.

**Spec:** docs/superpowers/specs/2026-09-12-unified-hamburger-navigation-design.md

## Global Constraints

- Work from C:\Users\MIS\Downloads\MKJewelOS; do not use C:\jos.
- Preserve unrelated dirty work and stage only navigation paths changed by this feature.
- Add no package, migration, Edge Function, database/RLS/RPC/Storage, or permission-contract change.
- Reuse launcherItems, getAccessibleMenu, resolvePageAccess, and native navigatePath; the drawer never authorizes access itself.
- Keep the desktop web sidebar and getSidebarNavigation behavior unchanged.
- Compact dock destinations are exactly / and /tasks.
- Web drawer has labelled modal semantics, focus management, Escape, scrim close, and focus restoration.
- Native drawer closes from scrim/Android Back, respects safe areas, and preserves all five registered tabs.
- Follow red-green TDD before every production-code change.

---

## File Structure

| File | Responsibility |
| --- | --- |
| apps/web/src/components/shell/MobileBottomNav.tsx | Two-destination compact dock. |
| apps/web/src/components/shell/MobileNavigationDrawer.tsx | Web drawer, profile context, menu, logout, modal accessibility. |
| apps/web/src/components/shell/MobileNavigationDrawer.test.tsx | Rendered drawer behavior. |
| apps/web/src/components/shell/ApplicationShell.tsx | Compact drawer state/header trigger; unchanged desktop sidebar. |
| apps/web/src/App.tsx | Replace two compact-overlay states with drawerOpen. |
| apps/mobile/src/components/shell/MobileBottomNav.tsx | Native two-destination dock. |
| apps/mobile/src/components/shell/MobileNavigationDrawer.tsx | Native safe-area drawer, Back/scrim closure, menu/logout. |
| apps/mobile/src/components/shell/MobileHeader.tsx | Leading hamburger trigger. |
| apps/mobile/src/navigation/AppTabs.tsx | One drawer state; existing routing retained. |
| apps/mobile/src/navigation/shellModel.ts | Testable compact dock contract. |
| apps/mobile/src/navigation/shellModel.test.ts | Compact-dock and route/access regression tests. |

## Task 1: Define and prove the compact dock contract

**Files:**
- Modify: apps/mobile/src/navigation/shellModel.ts
- Modify: apps/mobile/src/navigation/shellModel.test.ts
- Modify: apps/web/src/components/shell/MobileBottomNav.tsx
- Modify: apps/mobile/src/components/shell/MobileBottomNav.tsx

**Interfaces:**
- Consumes: isTaskPath(path: string) and navigatePath(path, shell, handlers).
- Produces: COMPACT_DOCK_PATHS, a readonly tuple containing / and /tasks.

- [ ] **Step 1: Write the failing test**

The break caught is a future reintroduction of My Apps, More, FMS, or CRM into the compact dock.

~~~ts
import { COMPACT_DOCK_PATHS } from "./shellModel";

it("keeps only Home and Tasks in the compact dock", () => {
  expect(COMPACT_DOCK_PATHS).toEqual(["/", "/tasks"]);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm.cmd --prefix apps/mobile run test -- shellModel.test.ts

Expected: import failure because COMPACT_DOCK_PATHS does not exist.

- [ ] **Step 3: Add the minimal model export**

~~~ts
export const COMPACT_DOCK_PATHS = ["/", "/tasks"] as const;
~~~

- [ ] **Step 4: Verify GREEN**

Run: npm.cmd --prefix apps/mobile run test -- shellModel.test.ts

Expected: all shell-model tests pass.

- [ ] **Step 5: Reduce both rendered docks**

Remove onOpenApps, onOpenMore, PanelsTopLeft, Menu, and their destination entries. Keep safe-area, active-state, and accessibility behavior. Use two equal columns.

~~~ts
const destinations = [
  { icon: Home, label: "Home", onSelect: () => onNavigate("/"), selected: path === "/" },
  { icon: CheckCircle2, label: "Tasks", onSelect: () => onNavigate("/tasks"), selected: isTaskPath(path) },
] as const;
~~~

- [ ] **Step 6: Commit**

~~~powershell
git add apps/mobile/src/navigation/shellModel.ts apps/mobile/src/navigation/shellModel.test.ts apps/web/src/components/shell/MobileBottomNav.tsx apps/mobile/src/components/shell/MobileBottomNav.tsx
git diff --cached --check
git commit -m "feat: reduce compact dock to home and tasks"
~~~

## Task 2: Build and prove the compact web drawer

**Files:**
- Create: apps/web/src/components/shell/MobileNavigationDrawer.tsx
- Create: apps/web/src/components/shell/MobileNavigationDrawer.test.tsx
- Modify: apps/web/src/components/shell/ApplicationShell.tsx
- Modify: apps/web/src/App.tsx
- Delete: apps/web/src/components/shell/AppLauncher.tsx
- Delete: apps/web/src/components/shell/MoreSheet.tsx

**Interfaces:**
- Consumes: existing LauncherItem, account context, currentPath, onNavigate(path), onClose(), and onLogout().
- Produces: MobileNavigationDrawer; selecting an item calls onNavigate(path) then onClose().

- [ ] **Step 1: Write failing rendered tests**

The breaks caught are missing modal semantics, failed post-navigation closure, and lost logout.

~~~tsx
it("navigates through the drawer and closes it", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(<MobileNavigationDrawer branchName="Bandra" currentPath="/" items={items} onClose={onClose} onLogout={vi.fn()} onNavigate={onNavigate} profileName="Asha Shah" roleLabel="Staff" />);
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  expect(onNavigate).toHaveBeenCalledWith("/tasks");
  expect(onClose).toHaveBeenCalledOnce();
});

it("has labelled modal semantics and closes from Escape", async () => {
  const user = userEvent.setup();
  render(<MobileNavigationDrawer branchName="Bandra" currentPath="/" items={items} onClose={onClose} onLogout={vi.fn()} onNavigate={vi.fn()} profileName="Asha Shah" roleLabel="Staff" />);
  expect(screen.getByRole("dialog", { name: "Navigation" })).toHaveAttribute("aria-modal", "true");
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm.cmd --filter web test -- MobileNavigationDrawer.test.tsx

Expected: module-not-found failure for the new drawer.

- [ ] **Step 3: Implement the dedicated drawer**

Create a compact-only fixed left panel with a click-to-close scrim, role=dialog, aria-modal=true, aria-label=Navigation, a close button, and all supplied launcher items. Save/restore active element, lock body scrolling, focus the panel, trap Tab/Shift+Tab, and close on Escape. Display profile, role, branch, current selection, and Sign out. Do not modify generic Modal.

- [ ] **Step 4: Wire one web drawer state**

Replace appsOpen/moreOpen with drawerOpen in App.tsx and ApplicationShell. Add a compact-only leading hamburger before the logo and render the drawer when open. Keep desktop header toggle, aside, notification bell, profile display, route fallback, and permissions unchanged.

- [ ] **Step 5: Delete only superseded overlays and verify GREEN**

After rg -n "AppLauncher|MoreSheet|appsOpen|moreOpen" apps/web/src finds no live references, delete the two superseded overlays.

~~~powershell
pnpm.cmd --filter web test -- MobileNavigationDrawer.test.tsx ApplicationShell.test.ts
pnpm.cmd --filter web typecheck
~~~

Expected: both tests and typecheck pass.

- [ ] **Step 6: Commit**

~~~powershell
git add apps/web/src/App.tsx apps/web/src/components/shell
git diff --cached --check
git commit -m "feat: add compact web navigation drawer"
~~~

## Task 3: Build and prove the native drawer without changing navigators

**Files:**
- Create: apps/mobile/src/components/shell/MobileNavigationDrawer.tsx
- Modify: apps/mobile/src/components/shell/MobileHeader.tsx
- Modify: apps/mobile/src/navigation/AppTabs.tsx
- Delete: apps/mobile/src/components/shell/AppLauncher.tsx
- Delete: apps/mobile/src/components/shell/MoreSheet.tsx

**Interfaces:**
- Consumes: native LauncherItem, visible, account context, currentPath, onClose, onNavigate, and onLogout.
- Produces: native drawer; destination selection calls onNavigate(path) then onClose(); Android Back/scrim call only onClose().

- [ ] **Step 1: Write a failing native shell-model test**

The break caught is a drawer refactor that removes a non-dock destination from the existing navigator. Use a path not already covered.

~~~ts
it("keeps Settings reachable outside the compact dock", () => {
  const { calls, handlers } = recorder();
  expect(navigatePath("/settings", shellFor("staff"), handlers)).toBe(true);
  expect(calls).toEqual(["path:/settings", "section:settings"]);
});
~~~

- [ ] **Step 2: Verify RED or replace duplicate characterization**

Run: npm.cmd --prefix apps/mobile run test -- shellModel.test.ts

Expected: if Settings is already characteristically green, remove this duplicate and retain the Task 1 failing compact-dock test; do not keep a tautological test.

- [ ] **Step 3: Implement native drawer**

Use React Native Modal with a left panel and pressable scrim. Add a BackHandler listener only while visible; call onClose() and return true so Back cannot navigate the tab. Use safe-area insets, a scrollable menu, accessibilityViewIsModal, labelled close/scrim/destination controls, current-path selection, and existing token classes. Do not alter generic bottom-sheet Modal.

- [ ] **Step 4: Wire header and shell**

Rename MobileHeader.onOpenMore to onOpenNavigation; render a leading Menu Pressable before the logo and retain theme/notification controls. In AppTabs, replace appsOpen/moreOpen with drawerOpen and render the drawer in ParityTabBar using existing branch/profile/launcher items/navigate/logout/currentPath. Remove old imports/call sites. Do not change Home, Tasks, Fms, Crm, or Section registrations or usePathNavigation.

- [ ] **Step 5: Verify GREEN**

~~~powershell
npm.cmd --prefix apps/mobile run test -- shellModel.test.ts
npm.cmd --prefix apps/mobile run typecheck
~~~

Expected: both commands exit 0; denied, Developer Mode, FMS, CRM, and settings navigation coverage stays green.

- [ ] **Step 6: Commit**

~~~powershell
git add apps/mobile/src/components/shell/MobileNavigationDrawer.tsx apps/mobile/src/components/shell/MobileHeader.tsx apps/mobile/src/components/shell/MobileBottomNav.tsx apps/mobile/src/navigation/AppTabs.tsx apps/mobile/src/navigation/shellModel.ts apps/mobile/src/navigation/shellModel.test.ts
git rm --cached --ignore-unmatch apps/mobile/src/components/shell/AppLauncher.tsx apps/mobile/src/components/shell/MoreSheet.tsx
git diff --cached --check
git commit -m "feat: add native hamburger navigation drawer"
~~~

## Task 4: Integrate and validate

**Files:**
- Modify only if verification finds a defect: files named in Tasks 1 to 3.

**Interfaces:**
- Consumes: complete compact shells.
- Produces: local test/build/browser/device evidence; no hosted mutation.

- [ ] **Step 1: Run focused and static gates**

~~~powershell
pnpm.cmd --filter web test -- MobileNavigationDrawer.test.tsx ApplicationShell.test.ts
npm.cmd --prefix apps/mobile run test
pnpm.cmd --filter web typecheck
npm.cmd --prefix apps/mobile run typecheck
pnpm.cmd --filter web build
git diff --check
~~~

Expected: every command exits 0. Re-run an unrelated failure alone and report it separately.

- [ ] **Step 2: Run compact-web rendered QA**

Start Vite with pnpm.cmd --filter web dev -- --host 127.0.0.1. Verify page identity, meaningful content, no error overlay, console health, hamburger open, Escape/scrim close, permitted destination navigation/closure, Home/Tasks-only dock, and unchanged desktop sidebar. Use Browser plugin evidence when available.

- [ ] **Step 3: Run Android evidence if an authorized device is attached**

Run adb devices -l. If available, verify hamburger open/close, Android Back, Home/Tasks dock, a permitted non-dock destination, notifications, sign out, theme toggle, and fatal logs without Metro. Otherwise report device QA as unproven.

- [ ] **Step 4: Review and commit only approved paths**

~~~powershell
git status --short
git diff --check
git diff --name-only
~~~

Confirm no environment file, Supabase directory, artifact, customer data, migration, or unrelated user file is staged. Stage only named navigation and plan/spec files, run git diff --cached --check, and commit with feat: unify compact navigation in hamburger drawers.

## Plan Self-Review

- Spec coverage: Tasks 1 to 3 implement the two-destination dock, web/native drawer, accessibility, access filtering, safe areas, Back behavior, and retained desktop sidebar. Task 4 covers static, rendered, and device evidence.
- Placeholder scan: no unfinished or deferred implementation step remains.
- Type consistency: both drawers consume existing platform LauncherItem; web uses drawerOpen/onDrawerOpenChange; native uses drawerOpen/setDrawerOpen; route dispatch remains existing navigate/navigatePath.
