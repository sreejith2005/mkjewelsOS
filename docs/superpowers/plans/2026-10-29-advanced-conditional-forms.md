# Advanced conditional Forms, FMS scheduling and task scope

The owner's attached 2026-10-29 specification is the implementation brief. Extend the existing systems; preserve submissions, versions, assignment identity, authorization and customer-sync architecture.

## Audit and design

Visibility already uses `FormRule` but its editor cannot author nested groups. Section routing uses `branches` and `next`; question jumps currently author visibility. The section walker, step navigation and SQL helpers must share the same precedence. FMS section projections currently drop branches. The workspace already has server projections and follow-up metadata; extend those contracts.

Persist advanced rules in existing JSON contracts: section eligibility and rule, branch rule/name and stable question destinations, root rule negation. Retain legacy fields and legacy section-route precedence for previously saved definitions. New advanced routes execute in saved order, first match wins, before section fallback. Only forward destinations are publishable. Section eligibility always applies. Form submit and FMS stage progression remain existing atomic RPC operations.

## Implementation sequence

1. Add failing core acceptance tests for negative empty answers, independent section eligibility, immediate question jumps, ordered grouped routes, explicit-route/default-submit precedence, answer sanitization, invalid routes and FMS section scope. Extend existing evaluators and normalization/validation rather than adding another engine.
2. Extend builder's shared predicate editor to nested groups and root show/hide controls; add section eligibility and ordered navigation editing. Retain side-by-side production-renderer preview and label destinations by section/question.
3. Add forward-only SQL migration 0352 for persistence, server eligibility/path validation, active-answer sanitization and scoped FMS parity. Preserve authorization, audit and transaction boundaries; test both allowed and denied calls.
4. Extend existing follow-up timing and workspace filtering in 0353. One Asia/Kolkata Today/Overall/Overdue scope filters the server dataset before counts and pagination. Test requested date/time override and duplicate-safe progression.
5. Classify FMS forms by existing workflow/stage relationships and add filters without copying forms.
6. Update Kiara help/review with exact labels. Run focused core/web/DB tests, relevant lint/type/build, rendered desktop/phone QA and diff checks. Review integration and report exact proof boundaries.

## Ownership and integration

Parent: shared form TypeScript engine, builder/renderer/map, help and final verification. Independent agents: form SQL/tests (0352), FMS scheduling and Tasks (0353), Forms Library hierarchy. Agents must preserve the pre-existing dirty renderer/CRM edits. No hosted migration, publication or deployment is implied by local implementation.

## Review focus

- Unanswered negative comparisons must not activate routes.
- A question route beats a section's default Submit; skipped required fields are excluded only by a valid path.
- Changed controlling answers cannot leak inactive values into CRM.
- FMS section isolation and exactly-once progression remain intact.
- Count/list date scope applies before pagination and uses business-local boundaries.

## Release integration (2026-10-30)

The authorized release is based on current `origin/main` at `dcee3bd`, isolated from the original dirty feature checkout. Only advanced routing, scheduling, task scope and workflow hierarchy changes are integrated. Unmerged Forms 2 history/AI-import dependencies are excluded; current main save/publish paths, Other answers, recipient sorting, activated customer integration and the task doer fix are retained.

Migrations are renumbered to `0361_advanced_form_routing.sql` and `0362_advanced_fms_scheduling_task_scope.sql`; deployed migration files are unchanged. Existing `list_fms_built_forms` gains optional author-only exact workflow/stage links, without inferred cross-pairing. The release database report records verification against current main. Earlier implementation evidence below refers to the original checkout and its former local migration numbers.

Release database regressions passed559 assertions across30 files, including unchanged8-second budgets after statistics refresh in the synthetic fixtures.

Release gates passed on the integrated checkout: full core 1,360 tests/115 files; data 200 tests/32 files; web 767 tests/148 files (single worker, exit 0); monorepo typecheck and build each 6/6 tasks. Synthetic Playwright checks at 1440/390/320 pixels passed with current-main CSS, no horizontal overflow, stale path fields or console errors; desktop preview remains beside the editor. Hosted preflight matched through0357 and the dry run listed only0358/0359 with no seeds/roles. Backup metadata confirms a completed2026-10-29T20:23:56.725Z backup; PITR is disabled. No authenticated hosted employee flow is claimed by these synthetic checks.

## Implementation handoff (2026-10-30)

The implementation extends existing contracts. Local application and focused database verification passed. Hosted migration, deployment and authenticated production verification remain separate release gates.

### Routing and compatibility

- Existing `condition`, `rule`, `branches`, section `next`, stable keys and snapshots remain readable. Legacy branch objects retain section-end resolution (last matching question). New branches with a rule, OTHERWISE or a question destination navigate immediately; first matching saved rule wins. Explicit Continue bypasses the section fallback. Only forward destinations publish.
- Independent question visibility supports show/hide and nested groups. Sections support always, conditional show/hide and routing-only entry. Conditions evaluate only normalized active answers; missing answers cannot satisfy negative predicates unless they explicitly test emptiness.
- One bounded evaluator drives active questions/sections, answer pruning, validation, step navigation and renderer preview. Required validation applies to the chosen path. New short and long conditional forms share stepped section navigation. Preview never writes or uploads.
- Section-scoped FMS keeps valid internal question routing and terminals, discards external routes, and leaves workflow progression to existing atomic audited submission contracts. Section imports remap internal references and report dropped external dependencies before copying.
- Root negation and routing references survive normalization, option/type edits, question renaming and duplication. The routing map distinguishes navigation from visibility and warns about structural unreachable sections, duplicate rules and routes after OTHERWISE. Diagnostics are conservative, not a general proof of condition satisfiability.

### FMS, task scope and data integrity

- Existing successor routing, assignment and idempotent activation implement follow-ups; optional `followUp.schedule` configures days/hours, local clock, requested date/time and weekend handling. Default is next calendar day at 11:00 Asia/Kolkata. No call/message delivery or second scheduler is added.
- Today is the strict Asia/Kolkata date; Overall includes authorized future work and status-permitted history; Overdue separates unfinished earlier dates. Server filters run before totals/pagination. Search badges retain the same query/status/date filters when switching categories; no-search FMS retains workflow/stage hierarchy.
- FMS Workflow Forms categorizes existing access-filtered provenance/attachments without copying records. Stage names categorize presentation only; exact assignment identity is unchanged.
- No new tables, columns, RLS policies or Storage behavior. New private helper signatures are reflected in database.types.ts; grants remain revoked. Existing audit/transaction and two-project customer sync boundaries are reused. Active answers are pruned before customer mapping and causal assignment reads. No historical submission rewrite, customer backfill, CRM-project schema change or hosted action occurred.

### Release gate

Docker initially returned HTTP500 and the supported Desktop restart timed out, but it recovered on retry. Isolated verification then replayed0340 through0353 from a0319 schema baseline, restoring only canonical permission reference rows and normalizing a known baseline-only amendment to the repository0300 membership predicate. Initial incomplete/partially migrated candidate baselines were not accepted as proof. No existing database or active session was reset.

Final exact0353 source was additionally applied atomically from a pre0353 checkpoint. Database verification found and corrected the scope insertion marker to target0317's pre-name membership relation, preserved explicit completed-history requests, reused materialized rows for filtered totals, and short-circuited no-scope/Overall calendar evaluation to preserve the existing eight-second global-search budget. Both new suites and related regressions passed; details below. This is incremental baseline replay, not a fresh0001-to0353 reset. Vendor ACL/event-trigger ownership differences in the synthetic bootstrap and exact commands/results are recorded in [the database verification report](../../ADVANCED_FORMS_DATABASE_VERIFICATION_2026-10-30.md).

Before hosted release follow PRODUCTION_SWITCH_PLAYBOOK.md: confirm JewelOS linked project, inspect migration ledger, reconcile branch/migration numbering, dry-run, review named paths, and apply/deploy with the owner. Then verify authenticated save/reload/publish/revise/duplicate, FMS submission/progression and task drilldowns against the deployed schema. Git publication and hosted verification are separate. Web-only changes require no APK.

### Validation evidence (2026-10-30)

- `pnpm.cmd --filter @jewelos/core test --maxWorkers=2 --testTimeout=15000`: final review rerun passed 1,357 tests across 115 files. Includes the regression preventing an incompatible source-type edit from broadening another question's grouped route.
- `pnpm.cmd --filter @jewelos/data test --maxWorkers=2`: passed 199 tests across 32 files. Following search/count integration, the focused data API suite passed 22 tests and Tasks paging passed 9 tests.
- `pnpm.cmd --filter web test --maxWorkers=2 --testTimeout=30000`: earlier full run passed 745 tests across 146 files. Latest run after search/count integration passed 660 tests across 142 files but exited 1 because four forks workers timed out before starting. Retried those four files with `pnpm.cmd --filter web exec vitest run src/features/fms/FmsFlowBuilder.test.tsx src/features/forms/forms.test.tsx src/features/permissions/PermissionManagementPage.test.tsx src/features/fms/FmsStageEditor.test.tsx --maxWorkers=1 --testTimeout=30000`: all 86 tests passed. Combined latest coverage is 746 tests across all 146 files, with the worker startup failure explicitly retained here. Final routing/type-edit focused core checks passed 35 tests across 3 files.
- `pnpm.cmd exec turbo run typecheck --force --concurrency=1` and `pnpm.cmd exec turbo run build --force --concurrency=1`: each passed 6 tasks. Core/web builds and web typecheck passed again after final routing changes. Existing bundle-size/plugin-timing warnings remain.
- Playwright synthetic harness exercised real builder/renderer components at 1440, 390 and 320 pixel widths and a resized 390x460 viewport. Preview branch changes pruned inactive questions, validation passed, and no horizontal overflow occurred. Fresh final phone preview had no console errors or Vite overlay. Browser plugin was unavailable, so Playwright was used. This does not prove authenticated persistence or physical Android behavior.
- `git diff --check`: passed. No commit, push, hosted migration, deployment, customer backfill or APK release was performed.
- Local database regressions: 513 passing assertions across26 related files. Final0352 passed40/40 and0353 passed44/44; final scale/history0293 passed12/12 and naming-cost0312 passed7/7, including its eight-second global-search budget. The other22 files passed on the fresh incremental replay before the final scoped-query guards; the affected four files were rerun afterward.
- Database lint equivalent used `plpgsql_check_function_tb` on26 routine definitions across22 affected helper/RPC names: 0 errors and14 warnings, including type-assignment, unused-parameter and stable/volatile-expression warnings retained. This is focused function checking, not a claim that the entire database passed `supabase db lint`.

### Scoped file manifest

These paths include this task additions/edits; unrelated pre-existing or concurrent changes in other paths were preserved.

```text
apps/web/src/features/forms/FormBuilder.tsx
apps/web/src/features/forms/FormRenderer.tsx
apps/web/src/features/forms/FormRoutingMap.tsx
apps/web/src/features/forms/FormRoutingControls.tsx
apps/web/src/features/forms/FormRoutingControls.test.tsx
apps/web/src/features/forms/FormRuleTreeEditor.tsx
apps/web/src/features/forms/FormRuleTreeEditor.test.tsx
apps/web/src/features/forms/FormRenderer.routing.test.tsx
apps/web/src/features/forms/forms.test.tsx
apps/web/src/features/forms/api.ts
apps/web/src/pages/FormsPage.tsx
apps/web/src/pages/FormsPage.workflows.test.tsx
apps/web/src/pages/TasksPage.tsx
apps/web/src/pages/TasksPage.paging.test.tsx
apps/web/src/features/tasks/api.ts
apps/web/src/features/tasks/api.test.ts
apps/web/src/features/tasks/fms/FmsTaskWorkspace.tsx
apps/web/src/features/tasks/fms/FmsTaskBoard.tsx
apps/web/src/features/tasks/fms/FmsStaffWorkspace.tsx
apps/web/src/features/tasks/fms/FmsStaffWorkspace.test.tsx
apps/web/src/features/tasks/fms/FmsTaskWorkspace.test.tsx
apps/web/src/features/fms/FmsAssignmentEditor.tsx
apps/web/src/features/fms/FmsAssignmentEditor.scheduling.test.tsx
packages/core/src/forms/types.ts
packages/core/src/forms/visibility.ts
packages/core/src/forms/rules.ts
packages/core/src/forms/sections.ts
packages/core/src/forms/stepNavigation.ts
packages/core/src/forms/definition.ts
packages/core/src/forms/answers.ts
packages/core/src/forms/validation.ts
packages/core/src/forms/builder.ts
packages/core/src/forms/fieldTypes.ts
packages/core/src/forms/guidedConditions.ts
packages/core/src/forms/library.ts
packages/core/src/forms/library.test.ts
packages/core/src/forms/guidedConditions.test.ts
packages/core/src/forms/routingMap.ts
packages/core/src/forms/routingMap.test.ts
packages/core/src/forms/sectionImport.ts
packages/core/src/forms/sectionImport.test.ts
packages/core/src/forms/advancedRouting.test.ts
packages/core/src/fms/workContracts.ts
packages/core/src/fms/transfer.ts
packages/core/src/fms/assignmentConfig.ts
packages/core/src/fms/followUp.test.ts
packages/core/src/fms/taskWorkspace.ts
packages/core/src/fms/taskWorkspace.test.ts
packages/core/src/fms/workflowForms.ts
packages/core/src/fms/workflowForms.test.ts
packages/core/src/fms/index.ts
packages/core/src/taskSearch.ts
packages/core/src/taskSearch.test.ts
packages/core/src/database.types.ts
packages/core/src/assistant/appHelp.ts
packages/data/src/forms/api.ts
packages/data/src/forms/api.test.ts
packages/data/src/tasks/api.ts
packages/data/src/tasks/api.test.ts
supabase/migrations/0361_advanced_form_routing.sql
supabase/migrations/0362_advanced_fms_scheduling_task_scope.sql
supabase/tests/0293_fms_workspace_history_scale.test.sql
supabase/tests/0312_fms_workspace_naming_cost.test.sql
supabase/tests/0361_advanced_form_routing.test.sql
supabase/tests/0361_fms_built_form_links.test.sql
supabase/tests/0362_fms_scheduling_task_scope.test.sql
docs/ASK_KIARA_APP_HELP_REVIEW.md
docs/ADVANCED_FORMS_DATABASE_VERIFICATION_2026-10-30.md
docs/ADVANCED_FORMS_RELEASE_DATABASE_2026-10-30.md
docs/superpowers/plans/2026-10-29-advanced-conditional-forms.md
docs/superpowers/plans/2026-10-29-fms-scheduling-task-scope.md
docs/superpowers/plans/2026-10-29-workflow-form-hierarchy.md
```

## Final current-main merge (2026-10-31)

Merged main through955c4971, including End Nodes, recorded outcomes, form-answer due dates, manager team boards and the phone handoff picker. Release migrations are0361/0362; main0358–0360 remain unchanged. Calendar `dateScope` is separate from FMS ownership `scope` (mine/all); ordinary task RPCs retain calendar `scope`. Scheduling extends the0360 causal due resolver; explicit `formDue` keeps precedence. New/compatibility due resolvers remain private.

The merged core suite passed1,395 tests across117files. Exact main0340–0362 replay succeeded atomically in isolated `advanced_forms_publish_20261030`, with no operational/customer rows copied. Focused board/staff scope regressions and final build/database gates are recorded by the final release outcome.
