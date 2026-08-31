# Forms Routing Workspace Design

## Goal

Replace the compact modal builder with a full-page Forms workspace where a
non-technical author can see, configure, and test long conditional paths
without writing comparison values or deciphering rule syntax.

## Scope

This changes the web Forms builder only. It reuses the existing versioned form
definition, stable field keys, `FormRule` visibility evaluator, form sections,
and section-branch persistence. It does not add a migration, RPC, RLS change,
new data type, workflow graph dependency, or a change to published submission
behaviour.

## Workspace

Selecting New form or Edit form opens the builder as a full-width workspace,
not a small modal. The builder has a clear header with the form name,
Save/Cancel, and Preview actions. Editing remains the normal mode.

Preview is an explicit full-form mode. Selecting Preview replaces the builder
with the actual respondent form and a Close preview action. Closing preview
returns to the unsaved builder state. Preview shares `FormRenderer` and the
same rule evaluation used by respondents, but never saves or submits data.

## Question Routing

Choose-one questions (dropdown and single-choice questions) expose a visible
"What happens after each answer?" table. Each answer row maps to one of:

1. Continue normally;
2. Ask a later question;
3. Skip to a later section; or
4. Submit the form.

Ask-a-question writes the existing equality visibility rule to its selected
target. An answer may select only one direct target question, preventing an
ambiguous route. More than one answer may target the same question, which
serializes as the existing flat `any` rule. Skipping to a section writes the
existing option-to-section branch. The choices exclude backward/self targets
and current/earlier sections so loops cannot be authored.

Every non-layout question visibly exposes "Show this question when...". The
author chooses a preceding source question, then selects only from that
question's real options. The answer selector is disabled with clear guidance
until its source is selected. This direct editor reads and writes simple
equality conditions and reflects its connection in the source question's
routing table.

Existing nested, numerical, date, or free-text conditions are never silently
rewritten. They remain clearly labelled as an existing complex condition and
continue to run in preview/respondent rendering. They are not exposed as a
misleading editable option map.

## Routing Overview

The workspace includes an always-visible, readable routing overview. It groups
every answer under its source question and renders plain-language connections,
for example:

```text
Metal
  Gold   -> Ask Gold purity
  Silver -> Ask Silver finish
```

It also lists section skips. Selecting a row focuses the relevant source or
target question. This overview is a linear, accessible map rather than a
drag-and-drop graph, so it remains practical for very long Forms.

## Long and Nested Paths

All question-to-question routes remain forward-only in form order. A target
question may itself be a choose-one question and create its own later routes;
there is no depth limit in the UI. Reusing the shared evaluator means a
respondent sees only the branch implied by their accumulated answers. Reordering
or deleting a question continues to use existing rule pruning, preventing a
dangling route from being saved.

## Validation

Focused tests cover:

1. opening a builder outside a modal and entering/exiting preview;
2. source-option selection rather than manual comparison entry;
3. one source question routing different answers to different follow-up
   questions;
4. routing a selected answer to a later section;
5. a three-level nested flow rendering only the active path; and
6. existing complex conditions remaining unchanged.

Run focused Forms UI/helper tests, core Forms tests, web typecheck, production
build, and rendered desktop/narrow-width QA when the browser runtime is
available.
