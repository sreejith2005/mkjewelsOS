# Light default and theme switch repair

Requested outcome: light mode on first use, an explicit light/dark switch that
updates every themed surface, and saved user choices that survive reopening.

1. Reproduce the document's permanent dark class and blocked-storage failure
   with focused web tests. Check rendered palette values at desktop and phone
   widths, including a device reporting a dark system preference.
2. Bootstrap the saved preference before first paint. Keep `data-theme`, the
   Tailwind dark class, native browser controls and browser chrome in agreement.
   Opt out of browser automatic darkening in explicit light mode. Handle storage
   denial without breaking loading or the switch.
3. Remove Android's forced dark interface configuration, use the shared light
   background on startup, and drive native appearance from the selected theme.
   Keep the existing shared palettes, CRM styling and saved-preference key.
4. Run focused regressions, full web/mobile suites, web build and mobile
   typecheck. No schema, RPC, RLS, Storage, audit or generated-type changes.
5. Follow the mobile release guide only after the required gates pass. A
   connected-phone check is required for this visual Android change. Do not
   publish an APK if that gate cannot be completed.

## Implementation and evidence

- `apps/web/index.html`: light document default; saved preference applied before
  React loads; synchronized dark class and `data-theme`; explicit `only light`
  or `only dark` browser colour scheme and matching browser chrome.
- `apps/web/src/theme/ThemeContext.tsx`: updates all theme signals before paint;
  blocked preference reads/writes do not break the page or the switch. Uses
  the existing shared palette for the browser chrome. Saved dark is retained
  when deliberately selected; missing/invalid preferences start light.
- Web theme tests exercise repeated toggles, reload-equivalent remounts,
  blocked storage and the actual HTML startup script. The existing mobile
  document tests continue to cover viewport/safe-area contracts.
- `apps/mobile/app.json`: removes the forced dark native configuration and
  matches startup/splash backgrounds to the shared light palette. The existing
  native provider already calls NativeWind's `colorScheme.set(name)`, which
  delegates to native Appearance; no second theme implementation was added.
- Native startup regression checks the configuration against shared tokens.
- No database/schema/RPC/RLS/Storage/audit/type-generation impact. No historical
  records or server authorization paths changed. Concurrent FMS, shared graph
  and sidebar work was left untouched.

| Validation | Result |
| --- | --- |
| `pnpm.cmd --filter web test src/theme/ThemeContext.test.tsx src/theme/themeStartup.test.ts src/mobileDocument.test.ts --maxWorkers=1` | 12 tests passed, 3 files. |
| `npm.cmd --prefix apps/mobile test -- src/theme/themeStartup.test.ts src/theme/themeCoverage.test.ts --maxWorkers=1` | 2 tests passed, 2 files. |
| `pnpm.cmd --filter web build` | TypeScript and Vite build passed; existing bundle-size warning. |
| `npm.cmd --prefix apps/mobile run typecheck` | Passed after correcting the new test's filesystem path type. |
| Playwright, local `http://127.0.0.1:5174/`, synthetic local configuration | 1440, 390 and 360 pixel widths, both light/dark system preferences: light default, repeated toggles, saved reloads, actual page/field colours, no horizontal overflow, no page runtime errors. Blocked-storage rendered toggles passed. |
| Chromium automatic-darkening flag | Explicit light startup and return-to-light passed; screenshots visually inspected. This does not prove every vendor browser's forced-dark behaviour. |
| `git diff --check -- apps/mobile/app.json apps/web/index.html apps/web/src/theme/ThemeContext.tsx` | Passed. |
| `npm.cmd --prefix apps/mobile test -- --maxWorkers=2 --testTimeout=20000` | 126 passed, 1 failed: unchanged `src/lib/appAvailability.test.ts`, OS-listener sharing test times out during its import. Also timed out with the normal 5-second limit. |
| `pnpm.cmd --filter web test --maxWorkers=2 --testTimeout=20000` | Completed: 451 passed, 1 failed; 95 passing files, 1 failing file. Dashboard attention-record test failed. |
| `pnpm.cmd --filter web test src/features/analytics/insights/ManagementDashboard.test.tsx --maxWorkers=1 --testTimeout=20000` | 1 passed, 1 failed: `opens the records behind an attention finding`, missing `Review overdue work` button while the dashboard remains loading. No theme provider is mounted by this test. |

The initial unrestricted web run also hit timeouts in sidebar navigation,
Forms, permission management and FMS editor/builder tests under concurrent
load, and was interrupted. No unrelated code or test assertions were changed
to make these attempts pass.

Browser skill was read first, but no callable browser JavaScript runtime was
available. Standalone Playwright was used for the authorized rendered QA. An
Edge launch timed out; the bundled Chromium succeeded. Only unauthenticated
login rendering was checked; authenticated routes, actual Android/Safari,
native runtime and physical devices remain unproven.

Hosted read-only check of `https://mkjewels-os.vercel.app/` found the old permanent
dark class and no explicit `only light` opt-out. Its fresh login still reported
light, so the user's exact original device/browser symptom was not reproduced
on that host in desktop Chromium. The user confirmed Android and opening the
website link; exact tested URL/browser was requested for the remaining check.

## Release status

Source changes remain scoped and unpublished. No migration, deployment, commit,
push, tag or APK publication was performed. Required checks are not all green;
`adb devices -l` shows no attached phone for the visual native gate in
`docs/MOBILE_RELEASE_GUIDE.md`. The checkout is on a feature branch and also
contains concurrent unrelated edits; these must not be absorbed into a release.
Resolve the named failing checks, perform the physical Android pass, then follow
the normal reviewed web publication and `scripts/release-mobile.ps1` procedures.
