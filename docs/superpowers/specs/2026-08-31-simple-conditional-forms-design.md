# Simple Conditional Forms Design

## Purpose

Make conditional questions understandable to a non-technical form author.
An author should be able to say: "When the person chooses this answer, ask
this follow-up question," and immediately see that journey in a live preview.

## Scope

This work changes the Forms builder experience and adds focused client tests.
It preserves the existing versioned Forms, audited save/publish RPCs, stored
field keys, submitted answers, and server-side rule validation.

The first release deliberately does not add a workflow graph, code editor,
calculation rules, respondent redirects, or new database schema.

## Author Experience

### Everyday conditional questions

The builder calls selectable fields "Choose one" questions. A selectable
field has answer choices such as Yes/No, Gold/Silver, or a dropdown list.

When editing such a question, each answer row offers a small optional
"Follow-up" control:

1. The author chooses an answer.
2. The author chooses a later existing question.
3. The builder displays a sentence such as: "If Gold is selected, ask Gold
   purity."

The selected follow-up question automatically receives the equivalent
existing visibility rule. It can be linked from more than one answer; those
links mean "ask this question when any of these answers are selected."

The target must appear later in the form. Moving or deleting either side
updates/removes the affected link with a clear local explanation, never a
silent invalid rule.

### Sections

Sections stay as lightweight organisation headings for a form. They do not
need to be created to make a follow-up question work. Existing section-jump
rules continue to render and run for already-authored forms, but the new
beginner experience does not offer new section-routing controls in its normal
flow.

### Existing advanced rules

Existing FormRule data remains valid and is never rewritten merely by opening
a form. A question with a rule that cannot be represented as one or more
answer-to-follow-up links receives an "Advanced condition" summary. It keeps
running in preview and for respondents. The existing technical rule and
section controls remain available only inside Advanced settings for authors
who need nested, numerical, date, or free-text comparisons; they are not part
of the everyday follow-up flow.

## Builder Layout

On desktop, the builder has two persistent columns:

- Left: form name, sections, add-question palette, and editable question list.
- Right: a live Form Preview with a "Start again" action.

The preview uses the same FormRenderer and rule evaluation as respondents.
Selecting an answer in it changes only preview answers; it never changes the
saved form definition. On narrow screens the preview becomes an accessible
Preview tab/modal rather than a cramped side-by-side panel.

Each question row shows a short conditional summary when applicable, for
example "Shown after: Metal = Gold." Low-level IF/AND/OR and branch controls
are kept under Advanced settings rather than normal editing.

## Data and Compatibility

The guided authoring layer converts each follow-up link to the existing
FormRule predicate shape: `{ kind: "predicate", fieldKey, operator:
"equals", value }`. Multiple source answers for one target become a flat
`any` group. This keeps the current core evaluator, client renderer, save
payload, RPC normalization, and server enforcement authoritative.

No migration, RLS policy, RPC signature, generated database type, or audit
contract changes. Published forms retain their exact stored rules. Drafts are
only changed after the author intentionally adds, removes, or changes a
follow-up link.

## Validation

Add tests for:

1. creating a follow-up link from an answer and producing the expected rule;
2. linking multiple answers to one question and producing an `any` rule;
3. removing a link without changing unrelated rules;
4. previewing each answer path and showing only the relevant questions;
5. preserving and clearly marking an existing advanced rule; and
6. existing forms, submissions, and section navigation remaining unchanged.

Run focused Forms tests, core tests covering rules, web type checking, a web
production build, and local database/pgTAP tests if the local Supabase stack
is available. Authenticated browser QA remains a separate evidence gate.
