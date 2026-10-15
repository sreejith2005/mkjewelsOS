# JewelOS app-wide visual refresh

Status: proposed design for owner review; implementation has not started.
Date: 2026-10-12, Asia/Calcutta.

## Intent

User testing found the web application's UI unattractive and lacking visual
interest. Refresh every implemented section, explicitly including CRM, without
making the application colourful. Success means a coherent, polished working
interface with readable hierarchy and useful interaction feedback.

The recommended direction is light and refined: white surfaces, charcoal text,
restrained existing gold accents, and semantic colour for operational states.
This direction is a proposal pending the owner's preference. Existing dark-mode
support remains part of the design and verification scope.

## Current source findings

- `apps/web/src/index.css` already defines light/dark semantic colours and shared
  field/panel utilities. Gold is the existing brand accent.
- `apps/web/src/components/ui.tsx` owns common buttons, dialogs, fields and notices.
  Dialogs already implement keyboard trapping, Escape, focus restoration and
  phone sheets; preserve these behaviours.
- `apps/web/src/components/shell/ApplicationShell.tsx` owns the main navigation,
  account controls, header and responsive content frame.
- CRM has a separate shell, typography, palette, CSS compilation and navigation
  in `packages/crm-ui`. Main-app CSS changes alone cannot refresh its screens.
- CRM's route inventory includes dashboard, walk-in queue/new visit, client
  database/new client/profile, follow-ups, referrals and new leads.
- The current workspace contains ongoing Task Control/deletion work. Preserve
  those edits and avoid replacing their changed components wholesale.

These are source findings, not a rendered or production UI audit.

## Visual direction

Use visual hierarchy, spacing, contrast and state changes to create interest.
Reserve gold for primary actions, selected navigation and modest highlights.
Use neutral borders and muted backgrounds for secondary actions. Retain red,
amber and green for meaning, with text/icons so colour is never the only signal.
Do not add blue accents, multicoloured navigation, decorative gradients or
ornamental dashboard content.

Use consistent heading sizes, readable body text, aligned labels, controlled
line lengths and a predictable spacing scale. Choose typography through visual
concept review before introducing any font changes. Keep operational tables
dense enough to scan and forms comfortable enough to complete.

Give the shell clearer active navigation, a quieter header and consistent
content gutters. Keep existing destinations, permission-driven menus, branch
context, notifications and user controls.

Replace indiscriminate heavy panel shadows with restrained separation. Tables
remain tables, work feeds remain work feeds and builders remain working canvases.

## Interaction direction

Use clear hover, keyboard-focus, pressed, selected and disabled states. Keep
transitions short and respect reduced-motion preferences. Avoid movement that
shifts layouts or delays routine work.

Review existing loading, saving, success, failure and empty states. Make feedback
visible without discarding entered answers, masking authorization failures or
showing success before persistence completes. Preserve current request and
transaction semantics.

On phones, retain comfortable touch targets, reachable actions, independent
table scrolling, safe-area handling and forms that remain usable with a keyboard.

## Coverage and acceptance inventory

| Surface | Required visual review |
| --- | --- |
| Login/recovery and application shell | Typography, navigation, theme, account and notification controls |
| Home and Dashboard | Assigned-work hierarchy, current metrics, alerts and existing charts |
| Tasks and recurring work | Feeds, filters, task details, checklist/evidence, creation and delegation |
| Task templates, import and Task Control | Tables, selection, previews, confirmation dialogs and progress/errors |
| FMS | Library, graph builder, inspectors, runtime and assigned-work forms |
| Forms Library | Library, builder, renderer, submissions and review |
| Notifications | Read/unread distinction, links and history |
| Users and permissions | Directory, user editing, section controls and permission previews |
| Availability and leave | Calendars, requests, handovers and review |
| Reports | Filters, existing visualizations, tables and exports |
| Dropdown Master | Lists, editing and validation |
| Settings | All implemented settings panels and operational dialogs |
| CRM dashboard | Filters, summaries and existing analytics |
| CRM client database/profile | Search, results, profile sections, history and documents |
| CRM walk-ins/leads | Entry queues, long forms, steps, validation and save feedback |
| CRM follow-ups/referrals | Queues, filters, paging, calling and history |

Inventory nested routes and dialogs before implementation. This table is a
coverage checklist, not permission to invent new functionality or metrics.

## Compatibility and architecture

Extend current tokens and component families; do not introduce a second design
system. Keep CRM styles scoped and regenerate its compiled CSS through the
existing build command. CRM implementation follows the repository instruction
to use `C:\crm` after verifying its current checkout and applicable instructions.

The user's request authorizes presentation changes to CRM despite its earlier
styling-parity requirement. Preserve fields, labels, order, vocabulary,
validation, calculations, identity bridge, data ownership and server contracts.

No schema, RPC, RLS, grants, audit, Storage or generated database-type changes
are intended. If an interaction requires a behavioural/server change, identify
it explicitly and review the relevant current contract before extending scope.

Do not alter assigned-work identities, completion transactions, notification
history, date-window rules, permissions or background refresh semantics.

Responsive web is in scope. Check native consumers and embedded CRM for impact.
If mobile-consumed tokens or native code change, follow the standing Android
checks and release instruction; stop if a required release gate fails.

## Delivery and verification

1. Confirm visual direction and produce representative concepts for the shell,
   a work/table screen, a builder and CRM, with phone counterparts. Concepts use
   existing information architecture; any example records must be clearly
   synthetic and never become application fallback data.
2. Approve the written design and prepare a concrete implementation plan.
3. Refresh shared shell/primitives, then complete the section inventory and CRM
   styling work. Track each surface individually rather than declaring the
   whole app refreshed after changing global CSS.
4. Run focused existing UI/regression tests, relevant package typechecks/builds
   and whitespace checks. Regenerate CRM CSS and check that its build is current.
5. Compare rendered screenshots against approved concepts at desktop and phone
   sizes, in light/dark themes. Exercise keyboard/focus, reduced motion, loading,
   validation, dialogs, long tables/forms and existing primary actions.
6. Keep local tests, authenticated browser evidence, hosted deployment and
   physical Android evidence separate. Do not claim production readiness from
   styling changes or static checks.

## Review gate

The design direction and concepts need owner review before product changes.
The brainstorming skill requires approval of the written spec before planning
implementation. This document is a reviewable proposal and has not been
committed, published or deployed.
