# Restore simple FMS canvas connections

Owner feedback: the new canvas detours overlap and obscure the flow. Restore
the earlier compact, readable presentation while retaining loop support,
multi-answer rules, connection details/editing, and saved node positions.

Cause: graphRouting treats any unequal port heights or crowded labels as a
reason to route below the entire graph. Even adjacent nodes get large detours.

1. Reproduce adjacent staggered nodes, competing labels, skip links, return
   links, and unrelated distant cards in focused geometry tests.
2. Restore short cubic connections when there is no intervening card. Move
   labels independently of line routing. Route only blocked/backward links
   outside local cards, keeping return lanes separate.
3. Restore compact label pills, restrained strokes and compact auto-arrange;
   keep convergence destinations after their longer forward paths. Saved
   positions only change when the user requests auto-arrange.
4. Test core, data and both canvas consumers; render the screenshot-like flow
   at desktop and phone widths and exercise selecting/editing/auto-arrange.
5. No database/schema changes. Preserve all routing and execution contracts.
   Android publication remains gated by physical-device validation.

## Validation

- Regression failures reproduced for staggered adjacent cards, crowded labels,
  unrelated distant cards and the shared finish being placed too early.
- Final `pnpm.cmd --filter @jewelos/core exec vitest run src/fms --maxWorkers=1`:
  111/111 passed, including the nine geometry checks. Core typecheck passed.
- `pnpm.cmd --filter @jewelos/data test`: 105/105 passed.
- `pnpm.cmd --filter web exec vitest run src/features/fms --maxWorkers=1 --testTimeout=20000`:
  90/90 passed. Default five-second limits timed out under host contention;
  only this command's timeout was increased, with no test/config changes.
- `pnpm.cmd --dir apps/mobile exec vitest run --maxWorkers=1 --testTimeout=20000`:
  127/127 passed. Initial concurrent attempts timed out in unrelated availability
  and theme coverage tests.
- Web typecheck and `pnpm.cmd --filter web build` passed; the build retains its
  existing large-chunk warning. `git diff --check` passed.
- Browser/Node REPL tools unavailable; existing Playwright 1.63 used for local
  component QA. Desktop 1365x768 and phone 390x844: 12 routes retained through
  auto-arrange, connection selection/details passed, zero browser errors, no
  page overflow and zero label/card overlaps in the arranged regression flow.
  Screenshots remain under the local temporary directory, outside Git. This
  is a synthetic component fixture, not an authenticated hosted workflow test.
- Temporary browser fixture files removed from the repository.

Native typecheck initially reported Node URL type errors in a concurrently
added `apps/mobile/src/theme/themeStartup.test.ts`; those unrelated edits were
preserved. A fresh `pnpm.cmd --dir apps/mobile typecheck` passed after that
concurrent work changed. No phone is connected. Android runtime validation and publication
remain pending. No migration, RPC, RLS, grants, generated-type, Storage or audit
changes are required. No persisted workflow or execution data was rewritten.

## Authorized Git publication

The owner requested migration deployment and a push to main. Production
JewelOS (`yimafxhuwgfhvzczqqdd`) migration ledger matches through 0212;
`supabase.cmd db push --linked --dry-run` reports up to date with empty
migration/seed/role lists. There is nothing to apply for this canvas change.

Publish only the six canvas/source/test paths plus this plan, based on current
origin/main in an isolated publication worktree. Preserve the active branch,
all unrelated theme/navigation edits and mobile version configuration. Git
publication is separate from hosted runtime proof and employee APK publication;
connected-device validation remains pending.

Publication checkout verification reused the existing unchanged dependency
installation through ignored directory junctions. Focused geometry tests passed
9/9 and web graph/canvas tests passed 8/8 after linking the root dependency
directory (the initial UI attempt could not resolve its test dependencies).
All seven staged files match the reviewed source. Staged whitespace,
forbidden-path and credential-pattern checks passed. Origin/main was refreshed
before committing; no additional FMS changes appeared.
