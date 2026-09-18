# Task Performance Score Design

## Goal

Replace task-completion percentage displays with two negative performance
scores: a pending score and a delayed score. The same definitions apply to the
web application, the native application, an individual employee's dashboard,
and authorized management views.

## Scope

This change covers rate-style task metrics only. It does not change task
completion state, assignment rules, deadlines, overdue classification, task
counts, FMS progression, checklist semantics, or authorization.

Raw operational counts remain visible: Assigned, Completed, Remaining,
Overdue, On-time, and Delayed. The scores make performance conspicuous; the
counts explain the score.

## Canonical score contract

The canonical implementation lives in `@jewelos/core`. Every client imports
it; no client calculates a score independently.

All score values are rounded to one decimal place for display.

### Pending score

For an assessed task cohort:

```text
(completed / assigned) * 100 - 100
```

Examples:

```text
75 completed / 100 assigned = -25.0%
2 completed / 33 assigned = -93.9%
0 completed / 33 assigned = -100.0%
```

When `assigned` is zero, the score is `null` and displays as `No data`. A
person with no assigned work must not receive a failing score.

### Delayed score

For the same assessed cohort:

```text
(on-time completed / completed) * 100 - 100
```

Examples:

```text
25 on-time / 75 completed = -66.7%
0 on-time / 75 completed = -100.0%
0 completed / 33 assigned = -100.0%
```

When `assigned` is zero, the score is `null` and displays as `No data`.
When work was assigned but no task is complete, delayed score is `-100.0%` as
explicitly requested. A completed task without an on-time classification is
not counted as on time, so it contributes to the negative delayed score.

## Data and authorization design

`get_employee_task_progress` already provides authorized assigned, completed,
remaining, and overdue counts for Task Control. It will be extended to expose
on-time completed counts needed by the canonical delayed-score contract. Its
existing security-definer, tenant, branch, department, active-user, and role
scope checks remain intact.

`get_dashboard_metrics` will return `task_pending_score` and
`task_delayed_score` calculated server-side from one authorized assigned-task
cohort. The dashboard score numerator and denominator therefore cannot be
drawn from different date populations. The existing
`task_completion_rate` output remains temporarily for backwards compatibility
with installed older native builds, but the current web and native UIs will not
render it.

The new migration is forward-only. It updates the generated database types and
adds pgTAP coverage for scope and score semantics; it does not rewrite
historical task records.

## User experience

Every score is rendered in the existing danger/red semantic token, including
`-0.0%` if it can occur. Scores have clear labels:

- Pending score
- Delayed score

Task Control uses these scores in its overview tiles, employee/department/
branch rows, attention copy, and attention ordering. The latter continues to
prioritize overdue work and backlog before using the pending score as a
tie-breaker.

Dashboard metric definitions replace the displayed completion-rate metric with
the two scores. Regular employees receive their own server-authorized values.
Managers, admins, and super admins retain their existing authorized scopes and
filters; Task Control continues to expose its authorized per-person detail.

Recurring/To-do performance replaces its completion and on-time percentages
with the same pending and delayed scores. The underlying occurrence and
overdue behavior remains unchanged.

The native Task Control, Dashboard, and Recurring/To-do screens consume the
same shared functions and labels as web, with phone-appropriate layout only.

## Error handling and compatibility

No client infers authorization from a score. Database RPCs remain the source
of permitted rows and aggregates. A missing or malformed score is rendered as
`No data`, never as a successful score.

The new response fields are additive. Existing installed mobile versions can
continue to read their completion-rate field until employees install the
native update. The released native update will be built and tested through the
repository's mobile release process; it is not implied by a web deployment.

## Verification

Tests prove:

1. both formulas, one-decimal rounding, no-assignment `No data`, and the
   assigned-but-zero-completed delayed `-100.0%` case;
2. attention ordering and recurring-performance parity use the shared score;
3. Task Control and Dashboard RPCs preserve authorization and calculate
   authorized cohort values;
4. web displays red negative scores in every affected surface;
5. native imports the shared contract and renders the same labels and values;
6. focused core, data, web, mobile, typecheck, build, database-contract, and
   device/touch checks are reported separately.

## Deliberate non-goals

- No new employee-ranking persistence table or historical appraisal ledger.
- No change to task, FMS, form, upload, checklist, or notification completion
  transactions.
- No expansion of staff access to other employees' data.
- No deletion or mutation of existing migrations.
