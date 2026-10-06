# Three-surface feature parity and mobile usability

Date: 2026-10-06 (Asia/Kolkata). Status: approved by the user in chat.

## Intended result

The desktop web app, phone web app, and Android app expose every currently
working web feature to the same authorized users, operate on the same durable
record identities, and produce the same validated outcomes. Phone layouts use
touch controls, appropriate scrolling and safe areas; identical desktop pixel
layouts are not an acceptance requirement.

The user requests implementation of all omissions, especially Android, and
changes on any surface to appear on the others. This design extends the existing
September 19 parity design to cover phone web and reliable freshness, retaining
the later approved CRM WebView and two-project decisions.

Evidence and current entry points are in `docs/MOBILE_PARITY_AUDIT_2026-10-06.md`.
Its initial findings are not a complete rendered parity certification.

## Approach

Use incremental feature slices against the existing web behavior. First close
refresh/identity gaps, then compare and implement every action in every section,
and finally verify the same scenarios across desktop, phone web and Android.
Keep functioning presentation and backend contracts; extend shared pure logic
and typed data access only when the comparison shows they need an extension.

Alternatives considered: rebuilding Android wholesale would put working flows
and regression protection at risk; wrapping the entire app in a WebView would
replace the established native experience and contradict the existing design.
Retain the specifically approved CRM WebView exception. Incremental completion
fits the repository rules and preserves existing employee workflows.

## Authority and compatibility

- Current web routes/components plus core rules, maintained specs, migrations
  and executable tests define behavior. Existing UI does not override database
  authorization or an approved product decision.
- Internal records stay in JewelOS Supabase. CRM records stay in the CRM
  Supabase project under the approved transition design. All three surfaces
  use each record's home project; cross-project contributions use the existing
  audited outbox/inbox protocol, never direct writes to another project's copy.
- Shared business rules belong in `packages/core`; I/O belongs in typed
  API/data layers. Preserve existing audited mutations, private Storage,
  idempotency and server-enforced permission resolution.
- Retain task IDs, exact FMS starter/stage IDs, form version pins and submitted
  snapshots. Preserve historical records and notification read history.
- No record retargeting, identity retirement, bulk data move or migration apply
  is implied by presentation parity. Any required contract extension is a
  forward migration with generated types and allowed/denied pgTAP cases.
- Preserve concurrent CRM paging and handoff edits. CRM code changes follow
  the required CRM worktree/runbook; do not merge or publish that transition
  from this audit branch prematurely.

## Freshness contract

A successful write is committed server state. Realtime signals invalidate
affected views; clients reload through their authorized loaders. Clients do not
copy mutable business records between surfaces or treat cached state as a
backend.

For online foreground views, relevant signals schedule a bounded debounced
reload, with one request in flight and one queued follow-up. Changes missed
while suspended or disconnected trigger catch-up on reconnection/foreground.
Navigation focus refreshes stale cached workspaces. Preserve current content,
selection, scroll position and unsaved fields during background reloads.

Use the existing shared subscription path and specialized inbox/export
mechanisms. Trace database signals per mutation before adding subscriptions.
If a mutation emits no appropriate signal, repair its existing durable event
contract with a scoped forward migration rather than adding broad polling.
Export progress polling may remain where its established contract requires it.

Cross-project sync is eventual: expose pending/retry/failure truthfully where
relevant. Do not promise instantaneous offline updates. Foreground recovery
must show committed results without requiring the user to log out and back in.
Test simultaneous writes using existing optimistic-version/conflict rules;
refresh must not silently overwrite an editor's draft.

## Feature and layout completion

Use every inventory row in the audit as an action checklist. Compare fields,
defaults, tabs, filters, pagination, allowed roles/overrides, validation,
attachments, mutations, historical rendering and nested links. Mark an action
complete only after checking both its main flow and related regression paths.
Discoveries expand the checklist rather than silently becoming desktop-only.

Phone web uses the current shared responsive shell and components. Inspect at
320, 360, 390 and 430 CSS pixels, landscape/compact height, browser zoom and
keyboard open. Fix clipped actions, inaccessible tables, overflowing pickers,
stacked dialogs and canvas gestures with scoped component changes. Preserve
all actions and use accessible horizontal overflow for genuinely wide data.

Android uses native screens and controls, existing tokens, virtualized long
lists, one scroll owner per editor, keyboard avoidance and safe areas. Verify
large device font sizes, TalkBack labels/state, Android back navigation,
permission denial and interrupted camera/microphone/file actions. Keep dirty
editor warnings and distinguish initial loading from background refresh.

Add the shared form-selected FMS assignee control on both builders. Eligible
fields are required, always-visible Users-backed questions in the selected
linked form. Validate through the existing core/server contract and retain
explicit stage assignment precedence. Treat this as an identified shared gap,
not evidence that the rest of the desktop app needs redesign.

## Delivery order

1. Refresh the existing implementation plan and action matrix against this
   design and current source. Select isolated parity work compatible with the
   current CRM transition branch; inspect all consumers before editing.
2. Close confirmed native subscription and reconnect/foreground gaps. Verify
   notification/export/CRM signals separately. Inventory incoming deep links
   and close verified route-identity omissions.
3. Complete Tasks, recurring work, Task Control, FMS and Forms actions and
   mobile layouts. Exercise Home/Notifications/direct-link entry and atomic
   submission/progression together.
4. Complete Users, Availability, Notifications administration, Reports,
   Dropdown Master, Settings, permissions, checklists and device operations.
5. Verify the approved CRM web/mobile/embed surfaces and two-project behavior
   in coordination with its maintained runbook. Preserve original CRM parity.
6. Run full cross-surface acceptance, regression, authorization and release
   gates; publish the reviewed signed Android update through the official
   script under the standing user release instruction.

These are delivery slices, not optional scope reductions. The project remains
incomplete until every web-implemented action has the required mobile evidence.

## Acceptance and evidence

For each mutable workflow, perform the same synthetic scenario from desktop
web, phone web and Android in turn. Observe the exact record from the other two
surfaces, including status, attachments/history, aggregate counts and durable
notification closure where applicable. Repeat with one observer disconnected
or backgrounded, then return it to the foreground and verify catch-up. Verify
conflicting writes, duplicate-tap/retry safety and preservation of drafts.

Cover ordinary and privileged actors plus effective permission overrides.
Backend cases include unauthenticated/inactive, cross-tenant/cross-branch,
direct API and direct URL/native entry, as applicable. UI hiding is never
authorization proof.

Use focused existing tests first, then core/data/web/native regressions,
strict typechecks and web/native build/export. Run pgTAP/lint for backend
changes. Record rendered desktop/phone evidence separately from an authenticated
installed Android walkthrough. Tests cannot certify touch UX or live sync.

After gates pass, review named paths, perform credential-safe staging checks,
commit, and release through `scripts/release-mobile.ps1`; verify signer,
package/version, public `latest.json` and APK. Do not use `-Mandatory` without
explicit approval. Hosted project actions follow the production playbook and
the CRM owner-present runbook. Stop and report a failed required gate.

## Current limits and approval point

This turn establishes the initial source findings and design, with baseline
tests. It does not change application behavior. No Android device is connected,
and authenticated three-surface interaction evidence is outstanding.

The user approved this written design. The next gate is review of the concrete
implementation plan and selection of its execution method before product code
changes begin. Routine checks and the standing Android release instruction do
not require renewed authorization.
