# CLAUDE.md

The repository root is `C:\Users\MIS\Downloads\MKJewelOS` (confirm with
`git rev-parse --show-toplevel`).

1. Read `AGENTS.md` completely before inspecting or changing anything. It holds
   the repository rules.
2. **Publishing or updating the Android app** (release, ship, APK, "send to
   employees", update prompt): follow `docs/MOBILE_RELEASE_GUIDE.md`. Releases
   go through `scripts\release-mobile.ps1` only.
3. Mobile development context: `apps/mobile/README.md`. Since 2026-10-15 the
   Android app is a shell around the deployed web app: product changes are web
   changes and need no native work or APK. `docs/MOBILE_PARITY_PLAYBOOK.md` and
   `docs/MOBILE_HANDOFF.md` describe the retired native screens (history only).
