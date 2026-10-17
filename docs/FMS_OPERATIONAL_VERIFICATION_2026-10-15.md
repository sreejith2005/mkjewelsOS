# FMS implementation verification

Release numbering: this document records the original isolated development stack. The main-based release uses migrations `0260`-`0284`, preserving production task-video migration `0259`. See `FMS_WEB_RELEASE_2026-10-17.md` for the exact mapping and current release outcome. Do not apply the development filenames to production.

Updated 2026-10-17. Implementation is in progress in the authoritative
JewelOS repository. This is local evidence, not a production release claim.

Owner scope update 2026-10-17: focus on the web app. Android testing and release
are deferred to the owner and are not a completion gate for this web scope.

## Implemented contracts

- Forward-only migrations 0239 onward pin assignment versions; record causal
  visit decisions and handoff intents; provide read-only preview and atomic,
  idempotent confirmation; expose scoped assigned work and context; and bind
  initial submissions to an exact workflow.
- Follow-up limits retain actionable work while holding for review. Initial
  manual handoffs, availability coverage, previous-employee previews, and
  nested join previews use the same final assignment rules.
- Private attachment access is limited to explicitly mapped causal answers,
  with an audited path RPC and short-lived Storage signing.
- Web and native consume shared typed contracts, confirmation, request
  identity, assignment authoring, work presentation, and simulation rules.
- The workflow activator, visit identity, task feed, approvals, per-doer
  completion, immutable form output, and historical versioning remain the
  existing persisted system. No second execution backend was added.

## Current local evidence

| Check | Result |
| --- | --- |
| Isolated Postgres | Dedicated `jewelos-fms-contract`, ports 61321/61322; no hosted writes |
| Focused core FMS tests | Latest run: 140 passed, including route-source validation and simulation fixes |
| Full core | 851 passed, 1 failed: pre-existing catalog drift, 42 migration entries versus 36 client entries |
| Full data | Latest run: 142 passed |
| Web | Fresh full run: 490/490 passed across 105 files. The later typed sample-answer test also passed its focused simulation run (2/2) |
| Native | Full run: 127 passed, one availability timeout; isolated retry passed that test. Native typecheck passed before latest simulation error handling |
| Workspace typecheck | 6 packages passed; final web `tsc --noEmit` also passed with the corrected test fixtures |
| Build | Five library packages passed the workspace build; final `pnpm.cmd --filter web build` passed including web TypeScript and Vite production output |
| Real local browser | Passed 390x844 and 1440x900; private PDF upload/sign/download, cancel preserving answers, eligible replacement, atomic owner, three-request retry race, one Form and successor, no other-owner redirect, no overflow/runtime errors |
| Android device | `adb devices -l`: no connected device |
| Hosted migration/deployment | Not performed |
| Signed APK/release | Not performed; explicitly deferred by the owner |

The final pgTAP sweep could not start: Docker Desktop returned HTTP 500 on
the exact isolated container's inspect/copy calls. No other stack was restarted
or stopped. The earlier sweep passed 0239-0259; 0260-0267 each have individual
passing results. Latest fixes include consumed manual intent isolation (7),
previous-doer fallback preview (3), prior loop journey (8), historical option
labels (2), legacy review handoff (4), and candidate route preview (4). A
fresh combined sweep, post-fix SQL lint, and clean replay remain open.

Individual passing
SQL suites cover assignment pinning, A→B→C→D→E, fixed-owner protection,
atomic cancellation/confirmation/retry, scoped context and file access,
exact starter identity, bounded assigned loading, manual handoffs, source
publication, repeated visits, task context batches, parallel joins,
protected role assignment, multi-doer completion, approvals, follow-up
hold/resume, initial manual choice, stale coverage, previous-employee parity,
initial return validation, nested join ancestry, and reference projection.

## Schema and security impact

The flow/instance assignment version, mutation request hash, handoff-intent
and assignment-decision tables, scoped RPCs, and private helper contracts are
reflected in the application-visible portions of both Database type files.
The scoped generator reads isolated metadata and preserves unrelated dirty
members; complete schema/type reconciliation remains a release check.
Tables expose scoped reads, not
browser writes. Audited server functions own protected mutations. New helper
functions are revoked from browser and service-role direct execution where
they are internal contracts. Storage remains private.

Version 1 remains compatible; version 2 does not use the old global form
assignee context as the source of later owners. No historical owner or
submission is rewritten as part of the upgrade. CRM schema/data is untouched.

## Open gates

1. Restore access to the isolated Docker database, finish the combined SQL
   regression/lint/replay and expanded browser builder/start-flow checks.
   The independent reviewer stopped on a provider usage limit before a final
   report. Its partial important findings were addressed in a consolidated
   fix pass; author checks do not establish a clean independent review.
2. Reconcile the unrelated permission catalog baseline before declaring the
   entire repository green. Preserve the concurrent mixed WIP commit and
   review named paths before publication.
3. Clean isolated migration replay and migration ledger verification remain
   separate from the incremental local SQL applications.
4. Staging/hosted migration dry-run, authenticated hosted UX, production
   migration, web deployment and Git publication
   are separate gates under `PRODUCTION_SWITCH_PLAYBOOK.md`.
5. Android work is deferred by the owner; no device/APK gate applies to the
   current web-only scope.

See `FMS_USER_GUIDE.md` for configuration and employee instructions, and the
approved design and plan in `docs/superpowers/` for acceptance scope.

## Commands and scope

- `pnpm.cmd --filter @jewelos/core exec vitest run src/fms --maxWorkers=1`
  passed 140 tests.
- `pnpm.cmd --filter @jewelos/data test` passed 142 tests.
- `pnpm.cmd --filter web exec vitest run src/features/fms/FmsFlowBuilder.test.tsx src/features/fms/FmsFormAuthoring.test.tsx --maxWorkers=1 --testTimeout=20000`
  passed 28 tests, including persisted identity and return to the selected step.
- `pnpm.cmd --filter web exec vitest run src/features/tasks/TaskComposerVoice.test.tsx src/features/analytics/insights/ManagementDashboard.test.tsx --maxWorkers=1 --testTimeout=20000`
  passed 12 tests after the full-run failures.
- `pnpm.cmd --filter web exec vitest run --maxWorkers=1 --testTimeout=20000`
  subsequently passed 490/490 tests in 105 files. An interim worker termination
  warning did not produce a failed test or nonzero test exit. Synthetic
  notification error-boundary logs are expected assertions.
- `pnpm.cmd --filter web exec vitest run src/features/fms/FmsSimulation.test.tsx --maxWorkers=1 --testTimeout=20000`
  passed 2/2 after demonstrating invalid-route and typed-answer failures first.
  The typed-answer case was added after the full run collected its tests.
- `pnpm.cmd --dir apps/mobile test --maxWorkers=1 --testTimeout=20000`
  passed 127/128; `pnpm.cmd --dir apps/mobile exec vitest run --config vitest.config.ts src/lib/appAvailability.test.ts --maxWorkers=1 --testTimeout=30000`
  passed its isolated retry.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1` passed 6/6.
  `pnpm.cmd exec turbo run build --force --concurrency=1` then passed five
  packages and failed web on a newly added test's unsupported `exact` option;
  the test was corrected. Subsequent final checks are recorded below.
- `pnpm.cmd --filter web build` subsequently passed after correcting both test
  fixtures, including TypeScript and production bundling (2164 modules).
  Existing large-chunk warnings remain; no build error remains.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-fms-contract.ps1 -AllFms`
  failed before any test execution on Docker engine HTTP 500.
- `git diff --check` passed (line-ending notices only).

`scripts/test-fms-contract.ps1 -Reset` now refuses to run because CLI local
target selection was ambiguous. Its lint path explicitly names the dedicated
container. This helper never substitutes another database when Docker fails.

The earlier browser results establish assigned-work behavior only. The newer
builder, Forms round trip, and simulation UI have component/type evidence;
their expanded real-browser run remains blocked. No physical Android evidence
or authenticated hosted evidence is implied.
