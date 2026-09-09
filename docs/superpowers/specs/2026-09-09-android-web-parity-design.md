# JewelOS Android Web-Parity Design

## Objective

Build JewelOS as a fully native React Native Android application whose behavior, business rules, backend operations, content, and phone user experience match the management-approved web application. The final deliverable is a tested, signed APK.

The Android application must implement every feature available through the web app's 15 implemented routes, including the administration tools. No route may remain a placeholder or display "Coming soon."

## Product Constraints

- Android is the only required native platform.
- The deliverable is an installable APK.
- Use React Native. Do not use Capacitor, Cordova, Ionic, a WebView wrapper, or another application-conversion wrapper.
- The approved web app is the behavioral and visual reference. Do not redesign or reinterpret it.
- Preserve `com.jewelos.mobile` as the Android application ID.
- A clean installation is acceptable if the signing key for the earlier APK is unavailable. Once a production key is established, later releases must support in-place upgrades.
- All sections, including FMS Builder, Form Builder, and task bulk import, must remain fully functional on Android. Phone-specific layout changes may change presentation mechanics but not fields, permissions, validation, behavior, or outcomes.
- The web application must remain functional and behaviorally unchanged throughout the port.

## Source of Truth and Repository

`C:\jos` is the active repository for this work. `apps/web` is the approved product reference.

For each feature, inspect the corresponding web implementation in full before changing shared logic or building its native screen. Also inspect both read-only historical reference implementations required by `AGENTS.md` when their files are available. They inform expected feature behavior but must never be edited, imported, copied into the active application, or added as dependencies. When historical references disagree, prefer the more complete Base44 behavior unless the approved current web app has superseded it; record material disagreements in the delivery summary.

Existing uncommitted work belongs to the product owner. Preserve it. Stage and commit only named paths belonging to the current task. Do not mix deletion of retired reference files into parity commits without first establishing that the deletion is intentional.

## Architecture

### Shared business logic

`packages/core` owns pure, platform-independent decisions, including:

- task and checklist behavior;
- permissions and role-derived capabilities;
- recurrence calculations;
- form visibility and validation;
- FMS state interpretation;
- filtering, status, and view-state derivation;
- analytics and report calculations that do not require a UI runtime.

When a rule still lives inside a web component, extract it into a typed pure function with focused tests. Refactor the web consumer to call that function and verify the existing web behavior before the native screen consumes it. This web-first extraction is the primary parity proof.

### Shared data access

`packages/data` owns Supabase queries and mutations shared by web and Android. `packages/api-client` owns client construction and registration. The native app must not implement a second backend path, a shadow database, hardcoded business records, or direct table writes that bypass existing audited server operations.

Every sensitive mutation must use the same audited RPC or server transaction as the web app. Supabase RLS and RPC authorization remain the security boundary; client-side route and action filtering are user-experience controls only.

### Shared visual tokens

`packages/ui-tokens` owns both approved color palettes and shared spacing, typography, radii, and touch-target values. The web stylesheet remains the visual source where already established, with drift tests protecting extracted tokens.

`apps/mobile` uses NativeWind to retain approved Tailwind class names where React Native supports them. Platform-required differences such as safe-area insets, elevation, native scrolling, bottom sheets, and Android back handling must preserve the web design's visual intent and interaction outcome.

### Native presentation

`apps/mobile` contains only React Native presentation, Android integrations, navigation, platform controls, and thin orchestration around shared logic and data functions. It must not duplicate business decisions.

## Navigation and Application Shell

Replace the existing invented five-tab navigator with the approved four-action phone navigation:

1. Home
2. Tasks
3. My Apps
4. More

The shell must mirror the web app's phone presentation: header, content width, spacing, card density, typography, icons, active states, safe areas, and bottom navigation. My Apps and More expose the same role-filtered destinations as the web app using shared RBAC definitions.

Android back navigation must follow native expectations without losing the web flow. Editors and forms with unsaved changes must warn before destructive navigation.

Deep links and nested workflow routes must carry exact record identifiers. Do not infer a form, FMS assignment, task, customer, user, or other target from a non-unique related identifier.

## Required Feature Coverage

Implement native equivalents for all web routes listed by `IMPLEMENTED_PAGES` in `apps/web/src/App.tsx`:

1. Home
2. Dashboard
3. CRM
4. Checklist Tasks
5. Recurring/To-Do
6. Task Templates and Task Control
7. FMS Tasks and FMS execution
8. FMS Builder
9. Forms Library and Form Builder
10. Notifications
11. Team Directory and User Management
12. Availability
13. Reports
14. Dropdown Master
15. Settings

Also reproduce supporting surfaces reached from those routes, including task authoring, task details, assignee selection, daily-checklist gates, task evidence and uploads, task bulk import, form filling, FMS stage execution, client details, profile controls, application launcher, and the More sheet.

Remove `SectionScreen` and every "Coming soon" navigation path once real destinations replace them.

## Phone Adaptation Rules

The Android app must match the approved web app opened at a phone viewport. Native adaptation is allowed only where the browser control has no direct React Native equivalent.

- Use cards or vertically scrollable native lists for wide tables without omitting columns, filters, actions, or record details.
- Use full-screen editors, ordered editing steps, or bottom sheets for multi-panel tools while retaining the same inputs, validation, mutations, and results.
- FMS Builder, Form Builder, and task bulk import remain fully editable. Their phone layouts may serialize desktop panels into steps, but must not reduce functionality.
- Use native camera, gallery, document, date, selection, and confirmation controls while preserving the web operation's contract.
- Maintain at least Android-appropriate touch targets and the approved mobile density. Avoid the oversized typography, spacing, and cards that made the earlier application feel bloated.
- Support both approved light and dark themes throughout navigation chrome, status bar, sheets, modals, form controls, loading states, and every screen. The default remains light, and the selected theme persists locally.

## Data Flow and State

All server-backed screens read through shared data functions. Business data remains in Supabase; the native app must not create an offline source of truth. Authentication credentials use encrypted Android storage. Non-sensitive preferences such as theme may use local preference storage.

Mutations follow this flow:

1. A native screen gathers and locally validates the same input as the web flow.
2. Shared logic derives permissions and valid actions.
3. A shared data function invokes the existing audited RPC or server operation.
4. The UI waits for a confirmed result, reports failures without claiming success, and refreshes the authoritative record.

FMS branching and advancement remain server decisions. Forms remain definition-driven; never branch native behavior on displayed question text or hardcoded option labels.

## Loading, Errors, and Connectivity

Every data-backed screen must provide explicit loading, empty, error, blocked, offline, and expired-session behavior where applicable.

- Failed writes remain visible and retryable.
- The app must not optimistically claim a sensitive write succeeded before server confirmation.
- Validation errors should identify the affected field or action.
- Permission failures must not be disguised as empty data.
- Losing connectivity must not discard entered form or editor state.
- Session expiration returns the user to authentication without retaining another user's protected screen state on a shared device.

## Delivery Sequence

Deliver parity in independently testable vertical slices:

1. **Foundation:** approved four-action navigation, matching mobile header, complete light/dark behavior, density, safe areas, and native route structure.
2. **Core workflows:** Tasks and checklists, Home, FMS execution, and CRM.
3. **Operational sections:** Settings, Notifications, Availability, Dashboard, Forms Library, Recurring/To-Do, Dropdown Master, Users, Reports, and Task Control.
4. **Complex authoring:** Form Builder, FMS Builder, and task bulk import using complete phone layouts.
5. **Release:** authenticated device regression, production configuration validation, signed release build, signature checks, installation testing, and final APK handoff.

No slice is complete merely because its screen renders. It must include its real reads, actions, permissions, validation, loading/error states, tests, and device evidence.

## Verification Strategy

Each parity slice must pass these gates:

1. Add focused tests for any extracted shared decisions.
2. Refactor the web consumer onto shared logic.
3. Run relevant web tests and confirm unchanged behavior.
4. Build the React Native screen from the same logic and data functions.
5. Run focused mobile tests and strict type-checking.
6. Run affected core and data tests.
7. Compare the web app at a phone viewport with the Android screen.
8. Exercise the slice on a physical Android device using an authenticated account.

At appropriate integration checkpoints, run the complete core, data, web, and mobile suites plus the web production build and Android bundle/export checks. A native Gradle rebuild is required after native configuration or dependency changes, and at the final release gate.

The final release must verify separately:

- automated tests and strict TypeScript checks;
- web production build;
- Android JavaScript bundle/export;
- clean Android release build;
- JavaScript bundle embedded in the APK;
- APK signature and certificate details;
- application ID, version name, and version code;
- fresh installation on the target device;
- upgrade installation when an APK signed with the same established production key is available;
- login and session restoration;
- theme switching and persistence;
- navigation to every role-accessible section;
- representative create, edit, complete, upload, submit, and administrative workflows;
- layout and usability comparison against the approved web app at phone width.

Automated tests, APK construction, device installation, and authenticated workflow QA are distinct evidence and must be reported separately.

## Signing and APK Handling

Keep the production signing key and passwords outside Git. Commit only safe configuration templates and documentation. Preserve `com.jewelos.mobile`.

If the earlier APK's private signing key is available, use it after validating its certificate so the release can update the installed app. If it is unavailable, establish a new production key and perform one clean installation. Back up that key securely because every later in-place upgrade depends on it.

The final handoff must provide the exact APK path, version identifiers, signing-certificate fingerprint, build command, verification commands, and installation command without exposing secrets.

## Completion Criteria

The project is complete only when:

- all approved web sections and administration tools are functional in React Native;
- the app uses the same shared business rules and Supabase operations as the web app;
- no placeholder route remains;
- light and dark modes affect the entire interface and persist;
- the phone UI matches the approved web experience closely without bloated spacing or typography;
- the web application remains green and behaviorally unchanged;
- security and auditing remain server-enforced;
- the signed Android release APK passes the final verification and authenticated physical-device walkthrough;
- the final report lists every changed file, reference deviation, remaining limitation, verification command, result, and APK artifact path.
