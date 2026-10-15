# JewelOS for Android

The Android app is a thin native shell around the JewelOS web app: one
full-screen WebView of the deployed web origin (`EXPO_PUBLIC_JEWELOS_WEB_ORIGIN`),
so the app and the web are always the same build. Owner decision 2026-10-15; it
replaced the hand-written native screens, which are kept in Git under the tag
`mobile-native-archive`.

**A web deploy is an app update.** Every change to `apps/web` (or to the shared
packages the web bundles) reaches phones the next time the page loads. A new APK
is needed only for a change to this folder: the shell, `app.json`, permissions,
icons, or a native dependency.

What the shell does, and nothing more (`src/features/webShell/`):

| Concern | Behaviour |
|---|---|
| Sign-in | The page signs in and keeps its own session in the WebView's storage. The app holds no session or token. App backup is off, so that storage never leaves the phone. |
| Navigation | The top frame stays on the web origin. Other web addresses (including signed file links opened with `window.open`), `tel:`, `mailto:`, WhatsApp and other app links open outside the app. Anything else is blocked. |
| Downloads | A file the page builds in memory (`blob:`/`data:` with `<a download>`) is handed to the app and offered through Android's share sheet (15 MB cap, sanitised name). |
| Uploads, camera, microphone | The WebView's own file chooser and capture; Android asks for camera or microphone permission the first time. |
| Theme | The page reports its theme and colours; the status-bar and gesture-bar strips and the native dialogs follow. |
| Back button | Walks the page's history, then leaves the app. |
| Offline / crash | An offline banner, a "No connection" screen with retry, and a reload if Android stops the page's renderer. |
| Updates | The in-app update prompt (`src/features/appUpdate/`), unchanged. |
| Links into the app | `jewelos://<path>` and links on the web origin open that page. |

The web knows it is inside the app from the `JewelOSApp/1` user-agent token. It
does not change its behaviour for it today.

---

## Prerequisites on this machine

Everything below is already installed on the current development host; the
versions are recorded so a second machine can be set up to match.

| Tool | Version | Notes |
|---|---|---|
| Node | 24.17.0 | `>=20.19.0` is the workspace minimum |
| pnpm | 11.20.0 | `packageManager` in the root `package.json` |
| JDK | Temurin 17 | Expo SDK 57 requires 17; newer JDKs are not supported by this Gradle |
| Android SDK | `C:\Android` | `ANDROID_HOME` must point here |
| Build tools | 36.0.0 | plus platform `android-36` |
| NDK | 27.1.12297006 | needed by React Native's C++ codegen |

`android/local.properties` is untracked and must contain the SDK path with
forward slashes:

```properties
sdk.dir=C:/Android
```

---

## Environment configuration

`apps/mobile/.env` (untracked) holds one value, copied from `.env.example`:

```bash
EXPO_PUBLIC_JEWELOS_WEB_ORIGIN=https://mkjewels-os.vercel.app
```

It is **required for a release**: `scripts/release-mobile.ps1` refuses to build
without a valid https origin and prints the value it uses. A debug build may use
a local `http://10.0.2.2:<port>` (emulator) or LAN address. It is inlined **at
build time**, so changing it needs a rebuild and a new release; installed apps
keep the origin they were built with. Nothing secret belongs in this file: it is
compiled into an APK anyone can download.

---

## Development on a physical device

The physical phone is the primary target; no emulator is required.

```powershell
# 1. Install. The mobile app has its own install, separate from the pnpm
#    workspace — see "Why this app installs with npm" below.
pnpm.cmd install          # from the repository root — the workspace: web and packages/*
cd apps\mobile
npm install               # this app installs with npm, not pnpm

# 2. On the phone: Settings › About phone › tap "Build number" seven times,
#    then Settings › System › Developer options › USB debugging.
#    Connect over USB-C and accept the "Allow USB debugging?" prompt.

# 3. Confirm the host can see it. The device must be listed as `device`,
#    not `unauthorized` (accept the prompt) and not `offline` (replug).
npm run devices

# 4. Build, install, and launch, starting Metro alongside it
npm run android

# 5. Watch the JavaScript logs in a second terminal
npm run logs
```

**Reloading.** Press `r` in the Metro terminal, or shake the device. If the
shake gesture is awkward, `adb shell input keyevent 82` opens the developer
menu.

**When a reload is not enough.** Metro only reloads JavaScript. Re-run
`run android` after any of these:

- adding or removing a native dependency;
- changing `app.json`, a config plugin, or anything under `android/`;
- changing a value in `.env`.

**If the device is not detected.** `adb kill-server; adb start-server`, then
replug. A cable that only supplies power will charge the phone and never appear
in `adb devices`. A device listed as `unauthorized` needs the "Allow USB
debugging?" prompt accepted on an unlocked screen.

**Careful with `tsconfig.json#paths`.** Expo's Metro resolves runtime imports
through it, not just types. A mapping added for the type-checker's benefit will
silently redirect a real import — pointing `react` at `@types/react` produces
`Unable to resolve "react" from "App.tsx"`, because that package has no runtime
entry. Keep `paths` to genuine source aliases such as `@/*`.

---

## Checks

```powershell
cd apps\mobile
npm run typecheck
npm test
```

The tests cover the pure modules: the shell's navigation and message rules
(`webShellBridge.test.ts`), the update manifest, and the theme. The page script
the shell injects is plain ES2017 in `webShellBridge.ts`; keep it small and
dependency-free.

## Building an APK

Releases are built, signed and published only by `scripts/release-mobile.ps1`
(`docs/MOBILE_RELEASE_GUIDE.md`). `npm run apk:debug` builds a debug APK for a
USB-connected test phone; it expects Metro unless bundled.

### Why this app installs with npm

This is the one structural oddity in the repository, and it exists for a
measured reason.

React Native's Android build compiles third-party C++, and CMake names every
object file after the full path of its source. pnpm's isolated layout routes
that through `node_modules/.pnpm/<name>@<version>_<32-char hash>/node_modules/`,
and the result runs past Windows' 260-character limit. `ninja` then fails with
`Filename longer than 260 characters`, or loops until it gives up with
`manifest 'build.ninja' still dirty after 100 tries`. Enabling `LongPathsEnabled`
in the registry does not help: the NDK's `ninja.exe` is not long-path aware.

Measured object path for the same source file, against that 260 limit:

| Checkout | node_modules | Length | |
|---|---|---|---|
| `C:\Users\...\MKJewelOS\jewelos` | pnpm isolated | 442 | fails |
| `C:\Users\...\MKJewelOS\jewelos` | flat | 282 | fails |
| `C:\jos` | pnpm isolated | 374 | fails |
| `C:\jos` | flat (npm) | **214** | builds |

Both changes were needed. Two other approaches were tried and rejected:

- **Hoisting the whole pnpm workspace** (Expo's usual advice for pnpm). It
  shortens the paths, but this repository carries two React majors — 18 for the
  web app, 19 for React Native — and hoisting leaves two React 18 directories on
  disk: `apps/web/node_modules/react` and the one nested beside
  `@testing-library/react`. Two directories are two module instances, two hook
  dispatchers, and a null `useState` in all 90 web render tests. Vitest aliases
  cannot reach Testing Library's CommonJS `require`.
- **`nodeLinker: hoisted` for this app alone.** pnpm still keeps
  peer-resolved packages — `react-native` and every native library among them —
  under `.pnpm/`, so the long segment survived and the build still failed.

npm produces a genuinely flat tree, so `react-native`, `expo-modules-core`, and
the native libraries sit directly in `apps/mobile/node_modules`. The shared
`@jewelos/*` packages are linked from the pnpm workspace with `file:` specifiers,
so their own dependencies still resolve out of the workspace install and there is
still exactly one copy of the business logic.

The web app's install is untouched by all of this, and its tests stay green.

**Consequence to remember:** this app is not a pnpm workspace member. Use `npm`
inside `apps/mobile`, or the `mobile:*` scripts from the repository root.
`pnpm --filter mobile` will not find it.

---

## How the code is arranged

```text
App.tsx                     theme, error boundary, the web shell, the update prompt
index.js                    Expo entry point
plugins/                    config plugins applied during prebuild
src/
  config/env.ts             the only reader of EXPO_PUBLIC_* values
  features/webShell/        the WebView screen, its rules, and download saving
  features/appUpdate/       the in-app update prompt and installer
  lib/                      logging, the offline banner
  theme/                    the native palette (from @jewelos/ui-tokens) for the shell's own screens
  ui/                       the few components the shell's own screens use
```

Keep it this small. A feature belongs in the web app; native code is only for
what a web page cannot do on a phone.
