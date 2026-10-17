# FMS task identification and submission outcome

Task cards and Home FMS actions append the persisted workflow reference to the
existing configured title, so repeated workflow/stage names remain distinguishable.
The focused stage heading uses the same formatting. Configured title templates
and submitted records are unchanged.

Successful runtime forms replace the completed stage screen with a concise saved
confirmation, actual next assignees, and server-returned exact own-work links.
Same-person continuation opens the existing context-first stage page. Starter and
Forms Library confirmations retain their flow with clearer continuation/assignment
copy. Source visits are excluded from next-work links. Parallel targets retain
separate visit identities; labels never determine authorization or routing.

Approval, all-doer waiting and deferred completion preserve the stage runner and
its database-derived controls. Outcome text says saved rather than claiming that
pending requirements are complete. Final completion and hold have distinct copy.
Result state resets when handoff identity changes.

No migration, RLS, RPC, Storage grant, generated-type, notification completion or
persistent workflow identity change is needed. Existing transactional server
progression remains authoritative. Android is deferred per the owner's web scope.

Validation:
- Core FMS Vitest: 12 files, 146 tests passed.
- Focused web task/home/runtime/outcome tests: 6 files, 41 tests passed; final
  approval-retention/outcome/exact assigned-page rerun: 3 files, 22 tests passed.
- Web typecheck and production build passed; standalone E2E syntax and Git
  whitespace checks passed.
- Repository Playwright/local synthetic Supabase: actual Task/Home/Notification
  context-first links, other-employee confirmation, same-person next-stage
  continuation with previous answers, private file upload/sign/download, cancel,
  concurrent idempotent retry, builder/canvas and non-writing simulation passed
  at 390x844 and 1440x900. Browser connector initialization was unavailable earlier;
  screenshots of outcomes disable animations to capture settled layout.
- Independent review found and resolved pending-stage control/copy edge cases;
  final read-only review found no remaining important issues.

Release is scoped to web and shared presentation helpers, based on main 6adbd0b.
No production fixtures or customer submissions were created. CI and Vercel results
are recorded separately after main publication. Signed-in production staff
confirmation remains an owner check. Previous compatible web commit: 6adbd0b.
