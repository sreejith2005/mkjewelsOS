# JewelOS Unified Hamburger Navigation Design

## Objective

Replace the duplicate compact-navigation entry points, **My Apps** and
**More**, with one role-aware hamburger navigation drawer in both JewelOS
clients. Keep the compact dock focused on **Home** and **Tasks**. Preserve all
existing destinations, deep links, authorization, section-maintenance behavior,
theme behavior, and the desktop web sidebar.

This is a presentation and navigation-shell change only. It does not add or
change database tables, RLS policies, RPCs, Storage paths, audit behavior,
permissions, or route identifiers.

## Existing State

The desktop web client already has a collapsible leading sidebar. Compact web
and Android instead expose four dock actions: Home, Tasks, My Apps, and More.
My Apps and More both enumerate the same permitted destinations; More adds
account information and sign-out. Android is built on a tab navigator whose
FMS, CRM, and Section tabs remain reachable through the current path resolver.

The authoritative application root is `C:\Users\MIS\Downloads\MKJewelOS`.
`C:\jos` is a stale clone and is not a source or target for this work.

## Product Design

### Navigation surfaces

| Surface | Result |
| --- | --- |
| Desktop web (`md` and above) | Keep the existing collapsible leading sidebar and header toggle. |
| Compact web | Add a leading hamburger in the header. The bottom dock has Home and Tasks only. |
| Native Android phone | Add the same leading hamburger in the header. The bottom dock has Home and Tasks only. |
| Unified drawer | Show the current user and branch, every currently accessible destination, its current selection, and Sign out. |

The hamburger sits at the leading edge before the logo, matching the standard
top-app-bar placement. The current profile avatar is not a second drawer
trigger; account context remains visible inside the drawer. Notifications stay
available through the existing bell and route, as they are today.

### Drawer behavior

On compact web and Android, the drawer is a modal, left-edge panel with a
scrim. It opens from the hamburger, closes when a destination is selected, and
does not alter the active route until that selection is made.

Web behavior:

- clicking the scrim or pressing Escape closes the drawer;
- keyboard focus moves into the drawer, is constrained while it is open, and
  returns to the hamburger when it closes;
- the drawer has a labelled modal-dialog semantic and a visible close control;
- body scrolling is locked while the drawer is open.

Android behavior:

- tapping the scrim or using the hardware Back action closes the drawer;
- the panel observes top/bottom safe-area insets and scrolls independently for
  long role menus;
- every destination and the close control keeps the existing touch-target
  minimum and accessibility label;
- no new native dependency or navigator is introduced. The drawer is a shell
  overlay that calls the existing `navigatePath` contract, preserving tab
  history and nested/deep-link destinations.

The drawer will list the same `launcherItems` currently available to the two
duplicate compact overlays. Those items already derive from the shared access
context and live section controls. Thus disabled sections remain hidden for
ordinary users, Developer Mode users retain their approved access, and denied
routes stay denied even if a URL or native navigation action is invoked
directly.

## Component Boundaries

Create one dedicated, platform-specific navigation drawer component in each
client rather than changing the generic form/dialog modal. A navigation drawer
has different geometry, lifecycle, and accessibility needs from the existing
bottom sheets, so preserving the generic modal avoids regressions in task,
form, and FMS workflows.

### Web

- `ApplicationShell` owns one compact `drawerOpen` state instead of separate
  `appsOpen` and `moreOpen` states.
- A `MobileNavigationDrawer` renders profile context, accessible launcher
  items, selection state, and Sign out.
- `MobileBottomNav` receives only Home and Tasks; it no longer owns overlay
  callbacks.
- The desktop `<aside>` and its `sidebarOpen` behavior remain unchanged.

### Android

- `AppTabs` owns one `drawerOpen` shell state instead of `appsOpen` and
  `moreOpen`.
- `MobileHeader` exposes the leading hamburger callback.
- A native `MobileNavigationDrawer` renders the same user context, accessible
  destinations, selection state, and Sign out.
- `MobileBottomNav` receives only Home and Tasks; the underlying Home, Tasks,
  FMS, CRM, and Section tab registrations remain intact.

Existing `AppLauncher` and `MoreSheet` are removed only after all of their
behavior is represented by the drawer and no call sites remain. This is not a
route removal: their menu items and logout action continue to exist in the new
drawer.

## Data Flow and Authorization

No menu item is hardcoded for a role. Both clients continue to build entries
from `getAccessibleMenu`, `getLauncherMenuForRole`, `resolvePageAccess`, and
the live section controls. A drawer selection calls the existing path
navigation function, which performs the same page-access decision before
navigating.

The drawer changes discovery and presentation only. Server-side RLS and audited
RPC authorization remain the boundary for every protected read and write.

## Error Handling and Compatibility

- If live section controls fail to load, retain the existing fail-open default
  controls; do not make the drawer an authorization dependency.
- A route opened externally remains guarded by existing web route selection and
  native `SectionGate`/`navigatePath` logic.
- A disabled section keeps its existing maintenance notice semantics instead of
  silently showing stale data.
- Existing mobile safe-area padding, theme switching, notification entry point,
  sign-out behavior, and unsaved-change guards remain in force.

## Verification

Before implementation, add or update focused tests to prove:

1. compact dock destinations are exactly Home and Tasks;
2. the drawer retains the same accessible destination set as the previous
   launcher/menu for allowed, denied, and Developer Mode-disabled cases;
3. choosing a drawer destination calls the existing navigation path and closes
   the drawer;
4. compact web drawer markup retains labelled modal, close, Escape, focus, and
   scrim behavior;
5. Android Back and scrim closure do not navigate away from the active tab.

Run the affected web and mobile tests, strict typechecks, web production build,
and `git diff --check`. Perform rendered compact-web QA at desktop and phone
viewports, including open/close/navigate behavior and browser-console health.
If an authorized Android device is connected, verify the drawer, hardware Back,
Home/Tasks dock, an FMS or CRM drawer destination, notifications, and sign-out
without Metro. Automated, browser, and device evidence are reported separately.

## Non-Goals

- No desktop-sidebar redesign.
- No route, role, permission, or backend-contract change.
- No migration, Edge Function, deployment, or native package installation.
- No removal of FMS, CRM, Section, notification, profile, or account features.
