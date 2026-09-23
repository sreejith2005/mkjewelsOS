# JewelOS Android — release and update guide

The single source of truth for publishing the JewelOS Android app to employees
and shipping updates to it. **Any new chat or person doing a mobile release
should read this whole file first.**

Established 2026-09-14. Update this file whenever the release process changes.

---

## 0. The short version

```powershell
# 1. Commit your work (the release refuses uncommitted mobile/shared source)
git add <files>; git commit -m "feat(mobile): ..."

# 2. Release (from the repository root, C:\Users\MIS\Downloads\MKJewelOS)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "What changed, in plain words"

# 3. Push main when ready
git push origin main
```

That's all. Every installed app sees the update the next time it opens (or
returns to the foreground) and offers **Update now**. New employees always use
the same permanent link:

> **https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/JewelOS.apk**

Hard rules:

1. **Never lose the upload keystore** (§6). Without it, no future update can
   install over the app, and every employee must uninstall and reinstall.
2. **Only publish releases through the script.** It keeps `versionCode`
   rising, verifies the signature, and writes the `latest.json` the app reads.
3. **Every GitHub release in `sreejith2005/mkjewelsOS` is a mobile release.**
   The app finds updates through `releases/latest`, so a non-mobile release
   marked "latest" would break update checks for every phone. For anything
   else, use a pre-release or a different repository.

---

## 1. What the app is

| | |
|---|---|
| App name | JewelOS |
| Android package | `com.jewelos.mobile` (never change it; a new id is a different app) |
| Source | `apps/mobile` — Expo SDK 57 / React Native 0.86, a real native app, not a WebView |
| Shared logic | `packages/core`, `packages/data`, `packages/ui-tokens` (shared with `apps/web`) |
| Backend | Hosted Supabase `yimafxhuwgfhvzczqqdd.supabase.co` (same as web) |
| Web app | `apps/web`, deployed separately on Vercel. Not affected by mobile releases. |
| ABI | arm64-v8a only by default (see `-AllAbis`, §4) |
| Signing | Release upload key `CN=MK Jewels`, kept outside Git (§6) |

Read these for product and engineering context. This guide covers only
release and distribution:

- `AGENTS.md` — repository rules (read first, always)
- `PROJECT_HANDOFF.md` — product and database state
- `apps/mobile/README.md` — toolchain, why mobile installs with npm, device dev
- `docs/MOBILE_HANDOFF.md`, `docs/MOBILE_PARITY_PLAYBOOK.md` — mobile history, traps
- `PRODUCTION_SWITCH_PLAYBOOK.md` — Supabase migrations / Edge Functions / Vercel

---

## 2. How distribution and updates work

```text
 your PC                                   GitHub (public repo)                       employee phone
 ───────                                   ────────────────────                       ──────────────
 scripts\release-mobile.ps1                Release "mobile-v1.0.4"
   ├─ bump apps/mobile/app.json              ├─ JewelOS.apk
   ├─ gradlew assembleRelease (signed)       └─ latest.json  ◄──── app checks on launch / foreground
   ├─ verify signer + versionCode                                   │  newer versionCode?
   ├─ commit + tag mobile-v1.0.4 (push tag)                         ▼
   └─ gh release create --latest  ───────►  releases/latest/download/…   "Update available" → Update now
                                                                        → download APK → Android "Install"
```

**Hosting.** GitHub Releases on the public repository. Free, no extra account,
and GitHub always serves the newest release's files at the permanent
`releases/latest/download/<file>` URLs.

**The update manifest** (`latest.json`, uploaded with every release):

```json
{
  "schema": 1,
  "versionName": "1.0.4",
  "versionCode": 5,
  "requiredVersionCode": 0,
  "publishedAt": "2026-09-14T10:00:00.0000000Z",
  "notes": "Faster task list",
  "apkUrl": "https://github.com/sreejith2005/mkjewelsOS/releases/download/mobile-v1.0.4/JewelOS.apk",
  "sizeBytes": 38639512,
  "sha256": "…"
}
```

**The in-app updater** — `apps/mobile/src/features/appUpdate/`:

| File | Role |
|---|---|
| `releaseManifest.ts` | Manifest URL, parser, and the decision `current` / `optional` / `required` (pure, unit-tested) |
| `installRelease.ts` | Downloads the APK to cache, checks its size, opens Android's installer (`expo-file-system/legacy` + `expo-intent-launcher`) |
| `AppUpdatePrompt.tsx` | The dialog, mounted in `App.tsx`. Checks on launch and on return to foreground (at most every 30 min) |

Behaviour:

- Installed `versionCode` (from `expo-application`) < manifest `versionCode`
  → prompt. **Later** hides it until the next app launch.
- Installed `versionCode` < `requiredVersionCode` → **Update required**, no
  Later, back button does nothing.
- Offline or GitHub unreachable → silently tries again later. It never blocks
  the app.
- Debug builds (`__DEV__`) never check.
- If in-app download fails, the dialog offers **Download in browser instead**.
- Permission `REQUEST_INSTALL_PACKAGES` is declared in `app.json` and
  `android/app/src/main/AndroidManifest.xml`. The first time, Android asks the
  employee to allow "Install unknown apps" for JewelOS.

**Version numbers.** `apps/mobile/app.json` is the only place they live:
`expo.version` (shown to people, e.g. `1.0.4`) and `expo.android.versionCode`
(integer Android compares). `android/app/build.gradle` reads both from
`app.json` at build time. Do not hard-code them in Gradle again, and do not
edit them by hand: the script sets them.

**Release history.** `gh release list -R sreejith2005/mkjewelsOS`, or the
Releases page. Every APK is also archived locally in
`%USERPROFILE%\JewelOS-releases\mobile-v<version>\`.

---

## 3. Which changes need a mobile release?

| You changed | What to do |
|---|---|
| Anything in `apps/mobile/**` | Mobile release (this guide) |
| `packages/core`, `packages/data`, `packages/ui-tokens` | Mobile release **and** web deploy; both apps bundle them |
| `apps/web/**` only | Web deploy only (Vercel), no APK |
| Supabase migration / RPC / RLS / Edge Function | `PRODUCTION_SWITCH_PLAYBOOK.md`. No APK unless the app code changed too. **Keep it backward-compatible with the app versions still installed.** If it breaks older apps, release a mobile build that works with it and publish that release with `-Mandatory`. |
| `apps/mobile/.env` (Supabase URL/key) | Mobile release. Values are baked in at build time. |
| `app.json` plugins/permissions, native deps (`npx expo install …`) | Mobile release. Covered automatically: every release is a full native build. |

There are **no over-the-air JS updates** (no `expo-updates` / EAS Update).
Every change reaches phones as a new APK through the prompt. That was a
deliberate choice (2026-09-14): no extra account, one mechanism for every kind
of change. EAS Update could be added later if silent updates become important.

---

## 4. Releasing an update — full procedure

### Before

1. Work is finished and tested. Run it on a phone (`npm run android` in
   `apps/mobile`) for anything visual.
2. Commit it. The script refuses to run if `apps/mobile`, `packages`, or root
   lockfiles/config have uncommitted **or untracked** changes. The APK is
   built from the working tree, and this guarantees it equals a commit.
   Unrelated dirt elsewhere (e.g. `sreejith-crm/`) does not block.
3. Be on `main`.
4. At least 3 GB free on `C:`.

### Run

```powershell
cd C:\Users\MIS\Downloads\MKJewelOS
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "Fixed FMS form submit; faster task list"
```

| Option | Effect |
|---|---|
| `-Notes "…"` | **Required.** Shown to employees in the update dialog and on the release page. Write it for them. |
| `-Bump patch` (default) / `minor` / `major` | `1.0.4 → 1.0.5` / `1.1.0` / `2.0.0`. `versionCode` always goes up by 1. |
| `-Mandatory` | Phones below this version must update before continuing. Use when older builds break against the server. Stays in force for later releases until a newer `-Mandatory` raises it. |
| `-AllAbis` | Also builds 32-bit ARM (`armeabi-v7a`). Use if some phone says the app is not compatible (§8). Larger APK, longer build. |
| `-SkipChecks` | Skip mobile typecheck/tests. Only if you just ran them. |
| `-NoPublish` | Build and verify only, for testing. No commit/tag/release; `app.json` restored. Don't hand this APK to employees. |

### What the script does

1. **Preflight**: `main`; clean source; `gh auth status`; keystore descriptor
   exists and has no BOM; `.env` points at `yimafxhuwgfhvzczqqdd.supabase.co`;
   build-tools present; disk space.
2. **Version**: reads `app.json` and the published `latest.json`, takes the
   higher, bumps it. Refuses if the tag/release already exists.
3. **Checks**: `npm --prefix apps/mobile run typecheck` and `run test`.
4. **Build**: writes the new version to `app.json`, runs
   `gradlew assembleRelease --no-daemon --max-workers=2`. **20–40 minutes**;
   incremental builds are faster. If anything fails, `app.json` is restored.
5. **Verify**: `apksigner` (must not be the debug key); `aapt2 dump badging`
   must show `com.jewelos.mobile` with the new versionCode/versionName; source
   must not have changed during the build.
6. **Archive**: `%USERPROFILE%\JewelOS-releases\mobile-v<ver>\JewelOS.apk` + `latest.json`.
7. **Commit + tag**: commits only `apps/mobile/app.json`
   (`release(mobile): JewelOS <ver> (versionCode N)`), creates annotated tag
   `mobile-v<ver>`, pushes **only the tag**. It does not push `main`.
8. **Publish**: `gh release create mobile-v<ver> JewelOS.apk latest.json --latest --verify-tag`.
9. **Confirm**: polls the public `latest.json` until it reports the new versionCode.

### After

1. `git push origin main` (the release commit is local until you do).
2. Optionally open the app on your own phone, confirm the prompt appears,
   update, reopen, and confirm the prompt no longer appears (the build now
   matches the published versionCode).
3. Tell employees only if you want to. The app prompts them anyway.

### If a release goes wrong

- **Script stopped before step 7**: nothing was published. Fix the cause and re-run.
- **Stopped after tagging but before publishing** (e.g. network): finish by hand:
  ```powershell
  $t='mobile-v1.0.5'; $d="$HOME\JewelOS-releases\$t"
  gh release create $t "$d\JewelOS.apk" "$d\latest.json" --repo sreejith2005/mkjewelsOS --title "JewelOS 1.0.5" --notes "…" --latest --verify-tag
  ```
- **A published build is broken**: you cannot downgrade phones (Android refuses
  a lower versionCode). Fix or revert in code and **release a new, higher
  version** (use `-Mandatory` if the bad build must be replaced urgently).
  Deleting the bad GitHub release only stops phones that haven't updated yet;
  if you do, re-mark the previous release as latest:
  `gh release edit mobile-v<previous> --latest -R sreejith2005/mkjewelsOS`.

---

## 5. Build machine requirements

Already set up on this PC (Windows 11, 16 GB RAM, 4 cores). Details and
reasons in `apps/mobile/README.md` and `docs/MOBILE_HANDOFF.md` §4.4.

| Tool | Value |
|---|---|
| JDK | Temurin 17 (`JAVA_HOME`) — not newer |
| Android SDK | `C:\Android` (`ANDROID_HOME`), build-tools 36.0.0, platform 36, NDK 27.1.12297006 |
| Node / npm / pnpm | 24.x / 11.x / pnpm 11.20.0 |
| GitHub CLI | `gh`, logged in as `sreejith2005` |
| Mobile deps | `apps/mobile` installs with **npm** (`npm install`), not pnpm |
| Workspace deps | root `pnpm.cmd install` (for `packages/*`) |
| Signing | `%USERPROFILE%\.gradle\gradle.properties` → `JEWELOS_KEYSTORE_PROPERTIES` |
| Secrets file | `apps/mobile/.env` (untracked): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` only |

Never put a service-role key or any other secret in `apps/mobile/.env`. It is
compiled into an APK that anyone can download.

### Setting up a new build PC

1. Install the tools above; `gh auth login`.
2. Clone the repo to a **short path**. `C:\Users\MIS\Downloads\MKJewelOS` is
   known to work; much longer paths hit Windows' 260-character limit in the C++ build.
3. `pnpm.cmd install` at the root; `npm install` in `apps/mobile`.
4. Create `apps/mobile/.env` and `apps/mobile/android/local.properties` (`sdk.dir=C:/Android`).
5. Copy the keystore folder from backup (§6) and add the
   `JEWELOS_KEYSTORE_PROPERTIES=…` line to `%USERPROFILE%\.gradle\gradle.properties`.
6. `scripts\release-mobile.ps1 -Notes test -NoPublish` to prove it builds and signs correctly.

---

## 6. The upload keystore — protect it

Every JewelOS APK is signed with the same key. Android installs an update
**only if** it carries the same signature as the installed app.

| | |
|---|---|
| Descriptor | `C:\Users\MIS\Downloads\safety-keys-passwords-impt\keystore.properties` |
| Keystore | `C:\Users\MIS\Downloads\safety-keys-passwords-impt\mkjewels-release.keystore` |
| Alias | `mkjewels-release` |
| Wired via | `%USERPROFILE%\.gradle\gradle.properties`: `JEWELOS_KEYSTORE_PROPERTIES=<descriptor path>` |
| Read by | `apps/mobile/android/app/build.gradle` `signingConfigs.release` |
| Certificate | `CN=MK Jewels` |

- **Back up that whole folder** (keystore + properties with passwords) in two
  places outside this PC: an encrypted cloud drive and an offline USB. If it
  is lost, you must publish under a new key and every employee must uninstall
  and reinstall.
- Never commit it, paste its passwords into a chat, or print them in a terminal.
- Save `keystore.properties` as **UTF-8 without BOM**. A BOM silently makes
  Gradle sign with the debug key; the script detects both the BOM and a
  debug-signed APK and stops.
- If Gradle cannot find the descriptor it logs
  `JewelOS: no upgrade keystore found; signing release with the debug key.`
  The script refuses to publish such an APK.

---

## 7. Employees: install and update

### Message to send (WhatsApp / email)

> **JewelOS app for Android**
> 1. Open this link on your phone: https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/JewelOS.apk
> 2. When the download finishes, tap it (or open it from Downloads).
> 3. If your phone says installing from this source isn't allowed, tap **Settings**, turn on **Allow from this source**, then go back and tap **Install**.
> 4. If Play Protect warns about an unknown app, tap **More details → Install anyway**.
> 5. Open JewelOS and sign in with your work login.
>
> Updates: when a new version is ready, the app shows **Update available**. Tap **Update now**, then **Install**. If asked, allow JewelOS to install apps.

### Updating

Nothing to send. The prompt appears automatically. The first update on each
phone asks once to allow "Install unknown apps" for JewelOS; after that it is
Update now → Install. Sign-in is kept across updates.

### Phones that had an early test build

Builds before **1.0.1** have no update prompt. Those phones need the link above
once; after that they update in-app. A phone with a **debug** build (installed
over USB during development) must uninstall it first ("App not installed" /
"conflicts with an existing package").

---

## 8. Troubleshooting

### Employee-side

| Symptom | Cause / fix |
|---|---|
| "App not installed" / "package conflicts with an existing package" | Installed copy has a different signature (a debug/dev build). Uninstall JewelOS, install from the link. |
| "App not installed as package appears to be invalid" / "not compatible" | Phone runs 32-bit Android. Release with `-AllAbis`. |
| "There was a problem parsing the package" | Download incomplete. Re-download on a stable connection. |
| No update prompt | The app checks on launch or foreground, at most every 30 min. Fully close and reopen. Confirm the published manifest (below). Builds before 1.0.1 have no prompt. |
| Update downloads but Install does nothing | "Install unknown apps" was declined. Settings → Apps → JewelOS → Install unknown apps → Allow. Then Update again. |
| Play Protect blocks | "More details → Install anyway". Expected for apps outside the Play Store. |

### Release-side

| Symptom | Fix |
|---|---|
| `uncommitted changes would be built into the APK` | Commit, or `git stash -u -- <paths>`. If another person/session is mid-work in this checkout, wait for them to commit. |
| `GitHub CLI is not logged in` | `gh auth login` |
| `does not point at yimafxhuwgfhvzczqqdd.supabase.co` | Fix `apps/mobile/.env`. If production genuinely moved, update `$ExpectedSupabaseHost` in the script **and** §1 of this guide. |
| `signed with the DEBUG key` / BOM | §6 |
| `Filename longer than 260 characters` / `build.ninja still dirty` | Checkout path too long (§5), or `apps/mobile` installed with pnpm. Use npm. |
| Gradle killed / out of memory | Close other heavy apps; `plugins/withAndroidBuildBudget.js` already bounds memory. |
| Disk full | Delete old `%USERPROFILE%\JewelOS-releases\*` folders (they are also on GitHub) and `apps/mobile/android/app/build`. |
| Script says release/tag already exists | A previous run published it. Check `gh release list`; re-run with the next version. |
| Manifest check warns after publishing | GitHub CDN delay; check in a few minutes. |

Check what phones currently see:

```powershell
Invoke-RestMethod https://github.com/sreejith2005/mkjewelsOS/releases/latest/download/latest.json
```

---

## 9. Instructions for AI agents (new chats)

The user's standing instruction is to publish each completed mobile-affecting
change through this procedure, including work started in a new chat. A separate
"publish" request is not needed once the implementation and required gates pass.
Do not release documentation-only edits. If a gate fails, stop and report it;
never publish an unverified build. Use the same permanent APK link in §0 for
every version. A `-Mandatory` update still needs explicit user approval.

When handling a mobile-affecting change or asked to "publish", "release",
"ship", or "update the app":

1. Read `AGENTS.md` and this guide. Run `git status --short --branch`.
2. Make sure the requested changes are committed. Never commit another
   session's or the user's unrelated work without asking.
3. Run `scripts\release-mobile.ps1` with employee-readable `-Notes`. Use a
   long timeout or background execution: the build takes 20–40 min. Do **not**
   hand-roll Gradle builds, bump versions manually, or create GitHub releases
   by hand, except for the recovery steps in §4.
4. Push the release commit to `origin/main`, verify `HEAD == origin/main`, then
   report the version, versionCode, release URL, and manifest check result.
5. Ask the user before using `-Mandatory`. It interrupts every employee.
6. Do not change: the package id, the signing setup, the manifest URL or asset
   names (`JewelOS.apk`, `latest.json`), the `mobile-v<version>` tag format,
   or `releases/latest` semantics. Installed apps depend on them. If a change
   is unavoidable, ship an app release that understands both the old and new
   form first, then switch.
7. If the updater code changes, keep `releaseManifest.test.ts` green and
   verify on a real phone with a `-NoPublish` build before publishing.
8. Update this guide when the process changes.
