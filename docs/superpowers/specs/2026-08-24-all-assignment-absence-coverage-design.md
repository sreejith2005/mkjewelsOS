# All Assignment Absence Coverage Design

## Goal

When a person is absent on the date a task is due, every new or already active
assignment routes to the person's primary buddy, then their secondary buddy.
If neither buddy is available, the work remains without an active replacement
and is marked `coverage_required` for manager review.

## Scope and rules

- The rule applies to ordinary tasks, recurring task instances, CRM follow-ups,
  and pending FMS stages.
- Availability is date-specific and uses the existing `is_user_available_for_task`
  contract. An absence on 2026-08-25 affects work due on 2026-08-25 only.
- The assignee selected by the caller remains recorded as the original assignee.
  The active assignment is the first available buddy in this order: primary,
  secondary.
- A reporting manager is notified for unresolved coverage but is never selected
  as an automatic replacement under this rule.
- An in-progress or in-review item is not reassigned automatically. It remains
  in place with `manager_review` metadata and an audited manager notification.
- Marking an employee present again does not automatically take work back.
- The database, not the client, applies the rule. This makes the result the same
  for Super Admin and ordinary authenticated users and protects RPC/direct
  mutation call paths.

## Architecture

Migration `0086` will replace the central SQL coverage resolver and its task,
CRM, FMS, and notification adapters. It removes the today/tomorrow gate while
preserving existing tenant checks, audit entries, RLS, and assignment history.
The resolver returns only `original`, `primary_buddy`, `secondary_buddy`, or
`coverage_required`. Existing routing through a reporting manager is retired.

An absence write invokes the existing reconciliation function for the selected
date. Creation/update hooks resolve coverage immediately for every new task or
CRM follow-up, and FMS stage activation resolves it for every planned stage.
The effective doer receives the normal module-visible assignment and an in-app
notification, while the original row/history is retained.

## Error handling and compatibility

Existing RPC signatures remain unchanged. If no buddy is available, no other
employee is silently assigned: the task/follow-up/stage stores
`coverage_required`, preserves the original assignment history where that
module has one, and sends the responsible manager a review notification.
Existing reporting-manager coverage metadata remains readable as historical
data, but no new assignment can produce it.

## Verification

pgTAP fixtures will prove primary routing, secondary fallback, unresolved
coverage, absence-triggered reassignment, creation-time routing, cross-tenant
isolation, and normal-user/Super-Admin authorization. Focused web tests will
confirm that the existing authorized task feeds receive the effective doer.
