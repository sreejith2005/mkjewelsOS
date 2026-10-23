# CRM readable profile histories — 2026-10-23

## Approved scope and impact

Owner approved expandable summaries for Complete contact history, SAVED WALK-IN DETAILS & MEDIA and PROFILE EDIT LOG, and previously authorized deploying the CRM repair and pushing to main. This is the presentation follow-up to that repair.

Show five loaded entries initially and use Show more / Show less; existing server pagination still reaches earlier pages. Contacts retain the audited Record contact flow under Add a contact. Walk-ins have grouped saved answers, source-labelled additional answers, original submitted answers, visit date/outcome and separate Media. Edits with the exact same timestamp and actor are presented together, with Before / After and timestamps including seconds. Both existing profile modes use the same edit renderer. Kiara help describes the controls; no new data tool is needed.

All query bounds and filters, RPCs, grants, RLS, private media signing and data remain unchanged. No migrations, generated database types, functions, secrets or APK are required. Generated CRM CSS was refreshed because removed utility classes are no longer used. Rollback is a compatible web redeploy of the preceding commit.

## Local evidence

- `pnpm.cmd --filter @jewelos/crm-ui test --maxWorkers=1`: 225 tests / 50 files pass.
- `pnpm.cmd --filter @jewelos/crm-ui typecheck`: pass.
- `pnpm.cmd --filter @jewelos/core exec vitest run src/assistant/appHelp.test.ts --maxWorkers=1`: 5 pass.
- `pnpm.cmd --filter web exec vitest run src/embedded/nativeCrmBridge.test.ts src/embedded/EmbeddedCrmRoot.test.tsx src/embedded/embeddedCrmClient.test.ts --maxWorkers=1`: 20 pass.
- `pnpm.cmd --filter web build`: pass; existing bundle-size advisory remains.
- `git diff --check`: pass.
- Independent whole-change review: nested-answer collision fixed with a red/green regression; no remaining critical/important findings.

Browser plugin not available; used installed Playwright and an isolated synthetic fixture importing the real ClientProfile, CrmDocument, navigation context, query provider and source CSS. The fixture and screenshots are private operational artifacts outside Git. Tested 1440px, 390px and 320px in light mode and 390px dark mode: correct page identity, meaningful content, no framework overlay/page errors/console errors/horizontal overflow; all three histories expand and reveal older entries; Before / After and full notes display; Add a contact opens; signed-media success uses a synthetic Storage response. Existing unit tests also cover signed-media failure, audited contact submission and retry identity. This is component/layout evidence, not authenticated hosted CRM or physical Android evidence. No new authorization path was introduced.

## Release verification

Publish only the reviewed paths, preserving unrelated `.superpowers/` and concurrent changes on main. Confirm remote SHA, CI and the Vercel deployment separately. The current environment has no configured hosted staging account; no production customer writes are used for testing. Publication status and hosted asset checks are reported in the handoff.
