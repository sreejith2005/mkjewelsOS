# JewelOS for Android

A native React Native application, not a wrapper around the web app. It shares
`@jewelos/core` (business rules), `@jewelos/data` (the Supabase data layer), and
`@jewelos/ui-tokens` with `apps/web`, and rebuilds the presentation layer with
real React Native components.

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

`apps/mobile/.env` (untracked) holds:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Only the `EXPO_PUBLIC_` prefix is inlined by Expo's Babel transform, and it is
inlined **at build time**. Changing either value requires a rebuild — a Metro
reload will not pick it up. The anon key is safe to ship for the same reason it
is safe on the web: the database enforces RLS. Nothing else may go in here; a
service-role key in a mobile bundle is a key handed to every user.

`src/config/env.ts` is the only place these are read, and it throws with a clear
message if either is missing rather than failing later inside Supabase.

---

## Development on a physical device

The physical phone is the primary target; no emulator is required.

```powershell
# 1. Install. The mobile app has its own install, separate from the pnpm
#    workspace — see "Why this app installs separately" below.
pnpm.cmd install          # from C:\jos — the workspace: web and packages/*
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

## Building an APK by hand

```powershell
# Debug — installable on any device, expects Metro unless bundled
npm run apk:debug
# → android/app/build/outputs/apk/debug/app-debug.apk

# Release — self-contained, no Metro, minified
npm run apk:release
# → android/app/build/outputs/apk/release/app-release.apk
```

A release build embeds the JavaScript bundle, so the installed application never
contacts a development server. It uses whatever `EXPO_PUBLIC_SUPABASE_URL` was
present at build time — check `.env` before cutting a release.

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

## Signing a release

The debug build is signed with Android's shared debug key and is not
distributable. A real release needs a keystore, which **must never be committed**.

```powershell
# Create once, and back it up somewhere safe. Losing it means no future release
# can update an already-installed app.
keytool -genkeypair -v -storetype PKCS12 `
  -keystore $HOME\jewelos-release.keystore `
  -alias jewelos -keyalg RSA -keysize 2048 -validity 10000
```

Put the credentials in `%USERPROFILE%\.gradle\gradle.properties`, which is
outside the repository:

```properties
JEWELOS_UPLOAD_STORE_FILE=C:/Users/<you>/jewelos-release.keystore
JEWELOS_UPLOAD_KEY_ALIAS=jewelos
JEWELOS_UPLOAD_STORE_PASSWORD=<password>
JEWELOS_UPLOAD_KEY_PASSWORD=<password>
```

Then add the signing config to `android/app/build.gradle` (the properties are
read from Gradle's home, so nothing secret enters the repository):

```groovy
signingConfigs {
    release {
        if (project.hasProperty('JEWELOS_UPLOAD_STORE_FILE')) {
            storeFile file(JEWELOS_UPLOAD_STORE_FILE)
            storePassword JEWELOS_UPLOAD_STORE_PASSWORD
            keyAlias JEWELOS_UPLOAD_KEY_ALIAS
            keyPassword JEWELOS_UPLOAD_KEY_PASSWORD
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // ...the rest of the generated release block
    }
}
```

---

## Versioning

Both values live in `app.json` and are copied into the native project by
`expo prebuild`:

```json
"version": "1.0.0",
"android": { "versionCode": 1 }
```

`versionCode` is what Android compares, and it must increase on **every**
release. A build that reuses a `versionCode` cannot be installed over its
predecessor.

| Release | `version` | `versionCode` |
|---|---|---|
| first | 1.0.0 | 1 |
| next | 1.0.1 | 2 |
| next | 1.1.0 | 3 |

Note that installing an APK directly does **not** give the app any means of
updating itself. Distribution and updates are a separate decision, deliberately
left open in `docs/MOBILE_MIGRATION_PLAN.md`.

---

## How the code is arranged

```text
App.tsx                     registers the UUID source, then mounts the providers
index.js                    Expo entry point
plugins/                    config plugins applied during prebuild
src/
  auth/AuthProvider.tsx     session restore, sign-in, blocked-account states
  config/env.ts             the only reader of EXPO_PUBLIC_* values
  forms/                    the native form renderer and its field controls
  fms/                      workflow helpers that are not screens
  lib/                      supabase client, secure storage, formatting, pickers
  navigation/               the tab and stack trees
  screens/                  one file per screen
  theme/                    the brand palette, from @jewelos/ui-tokens
  ui/                       the shared component vocabulary
```

Three rules hold this together:

1. **No business rule lives here.** Visibility, validation, SLA, role
   permissions, and workflow routing all come from `@jewelos/core`. If a
   decision belongs to the product rather than the screen, it goes there.
2. **No question or workflow branch is hard-coded.** The form renderer maps
   *field types* to controls and nothing else; which questions appear and where
   a workflow goes next are read from the saved definition and decided by the
   server.
3. **The server is the authority.** A hidden button is a courtesy. Every
   mutation goes through an audited RPC that re-checks the actor.
