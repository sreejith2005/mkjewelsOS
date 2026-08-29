# FMS dynamic decisions, optional deadlines, and default assignment

## Scope

Make targeted changes only to the existing FMS builder and runtime contract.
Existing layouts, graph editing, normal steps, task behavior, and legacy
Yes/No flows remain supported.

## Decision configuration

Human stages support `decisionMode: "decision"` and persist an ordered list of
`decisionOptions`. Each option has a stable, stage-local key and a label. New
Decision Steps begin with the default options `yes`/`Yes` and `no`/`No`.

The key, not the mutable label, is used in the runtime outcome and downstream
conditional mapping. The editor permits adding, deleting, renaming, and
reordering options. A legacy `decisionMode: "yes_no"` rule is normalized as a
Decision Step with the compatible `yes` and `no` options. Runtime matching is
generic and does not branch on those values.

## Deadline and TAT configuration

`deadlineEnabled` defaults to true for each new human stage. When false,
deadline validation is skipped and the runtime deadline function returns
`NULL`; no zero-duration stand-in is created.

TAT is normalized as integer `tatMinutes`. The editor retains `tatUnit`
(`hours` or `minutes`) to present the selected unit. Existing `tatHours`
values remain readable and are converted to minutes while legacy definitions
remain valid.

## Conditional mapping

A decision conditional stores the earlier `decisionStageKey` and selected
`decisionOptionKey`. The editor derives the available values from the selected
earlier Decision Step. The shared validator and database publication check
reject a reference to a missing, later, non-decision, or deleted option.
Removing an option clears dependent mappings in the draft and surfaces a
publish-blocking validation message until a valid option is selected.

Existing Status conditions retain their existing supported operators. Decision
outcomes are data-driven; they do not reuse a fixed operator/value list.

## Default assignee

There is no existing durable FMS context-to-user assignment source. Add a
tenant-scoped, audited mapping selected from `user_profiles`, keyed by FMS
workflow context. FMS flows persist their selected context. CRM is one
context, not a special runtime name lookup.

An administrator selects Riya Mahto's existing Users record as the CRM mapping
once. New CRM human stages initialize a normal `specific_user` assignee rule
from that stored profile ID. The stage rule is persisted through the existing
draft-save RPC and remains the runtime source of task ownership; users can
override it in the FMS builder. No name is embedded in client or workflow
runtime code.

## Database and authorization

Use one forward-only migration. It extends FMS JSON validation, deadline
calculation, publication validation, stage activation, and completion outcome
validation for the new contract; all checks remain server-side. The mapping
table receives RLS and an audited mutation RPC restricted to the existing FMS
management roles. No browser-side mapping is authoritative.

## Verification

Add focused core tests for option normalization/validation, stale condition
rejection, disabled deadlines, and minute conversion; UI tests for decision
option editing, dynamic condition choices, and deadline controls; and pgTAP
coverage for database validation and null deadlines. Run targeted tests,
typecheck, and build. Manual verification covers the Instagram decision path,
option edits, and a CRM flow after Riya Mahto is selected from Users.
