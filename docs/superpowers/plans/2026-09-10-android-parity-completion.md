# Android parity completion plan

**Goal:** Ship an Android-only React Native APK whose reachable sections use the same Supabase contracts and shared business rules as the approved web app, with no placeholder for a web-implemented page.

1. Reconcile the short-path Android work with the authoritative repository without copying stale web code.
2. Restore the shared `packages/data` and native build foundations; port subsequent web API corrections into that shared layer.
3. Replace remaining implemented-page placeholders with role-aware native workspaces for recurring work, Task Control, users, dropdowns, forms, and FMS management. Preserve the existing native CRM and runtime flows and close their material action gaps.
4. Keep writes on existing audited RPC/Edge Function contracts; make no database or hosted changes.
5. Run core/data/web/mobile tests, all workspace typechecks, web build, Android export, and Gradle release assembly.
6. Install the standalone APK on the attached Galaxy A55 and verify authentication restore, the four-action shell, persistent theme, Tasks/checklist behavior, My Apps destinations, and fatal runtime logs without Metro.

The release gate is evidence-based: a successful bundle or APK build alone does not establish device parity.
