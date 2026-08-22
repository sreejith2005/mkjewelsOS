# Recurring / To-Do Assignment Composer Design

## Purpose

Make the primary Recurring / To-Do creation flow match the supplied operational assignment form. A manager creates a schedule for one employee, sees that employee's department and branch, chooses a frequency, start date, scheduled start time, due time, completion type, and coverage policy.

## Product rules

- The composer belongs only to `/recurring-todo`; one-off Tasks remains unchanged.
- A schedule has one named employee. Their branch and department are shown from their current active profile and submitted as the schedule scope.
- Frequencies are daily, weekly, monthly, quarterly, yearly, one-time, and as-required. Existing advanced weekly/monthly controls remain available when needed.
- Scheduled start and due time are separate. Scheduled start records when work becomes actionable; due time supplies the task deadline shown to the employee.
- Completion type is either Checkbox (normal completion) or Upload (at least one attachment is mandatory before completion).
- Coverage is enabled by default. For an unavailable named employee, the server resolves Primary Buddy, then Secondary Buddy, then Reporting Manager. No per-schedule buddy can be selected.
- Disabling coverage leaves the original assignee unchanged and records the assignment as Coverage Required when that employee is unavailable; it never silently picks another person.
- Every save remains a protected, audited RPC. The browser submits declarative fields only and cannot claim a coverage result.

## Data and compatibility

Add nullable `due_time time` and non-null `coverage_enabled boolean default true` to `task_templates`. Existing `planned_time` remains the scheduled-start time. The recurring-instance creator writes `planned_datetime` from `due_time` when supplied, retaining `planned_time` as its compatible fallback. Existing schedules get `coverage_enabled=true` and keep their existing `planned_time` behavior.

The coverage resolver runs only when `coverage_enabled` is true. The same guard applies to immediate creation, worker generation, manual Run now, and reconciliation. The migration updates generated database types and uses a forward-only RPC replacement with audit preservation.

## UI and validation

The modal uses three numbered groups matching the screenshot: Assignment, Schedule, and Task Controls. Branch and department are read-only derived values after an employee is chosen. Required fields are employee, task title, frequency, start date, scheduled start time, and due time; due time cannot precede scheduled start time on a same-day schedule. Checkbox/Upload maps directly to the completion requirement. The coverage selector is labelled plainly and explains its profile-owned fallback chain.

Advanced recurrence options, checklist, form, verification, follow-up, active state, and performance remain below these groups so no existing capability is lost.

## Security and tests

The migration keeps RLS and minimum grants intact, validates tenant/branch/department scope in the existing security-definer save RPC, audits every mutation, and never exposes roster contact data. Tests cover payload validation, profile-derived scope, due-time persistence, coverage enabled/disabled resolution, initial instance creation, worker generation, and the rendered form labels and validation.
