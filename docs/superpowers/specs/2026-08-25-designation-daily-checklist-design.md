# Designation Daily Checklist Design

## Goal

At the first new application session on each employee working day, show a short, mandatory checklist for the employee's designation. The employee must tick every item and affirm that they have reviewed it before using JewelOS that day.

This feature is a daily reinforcement tool. It is not the system of record for the full Standard Operating Procedure (SOP), and it does not claim to prove that an employee read or performed the work; it records a deliberate acknowledgement.

## Confirmed rules

- Store only the daily checklist: normally 10 to 15 concise, actionable lines. Do not store or upload the full SOP in this phase.
- There is one shared checklist per designation across all branches.
- A designation with no active checklist does not show a prompt.
- The checklist is required once per employee working day, using the `Asia/Kolkata` calendar date.
- An employee's configured week-off, non-active working status, disabled login, and inactive account skip the prompt.
- Super Admin and HR can manage checklists. The permission must be enforced on the server, not by hiding controls in the web application.
- Acknowledgement requires every visible item to be checked and a final explicit affirmation button.

## Architecture

Create a tenant-scoped `designation_daily_checklists` table. Each row belongs to a designation in `dropdown_masters` and includes the title, optional short instruction, ordered checklist items as a bounded JSONB array, final-affirmation text, `is_active`, and an integer `revision`. The JSONB array keeps this deliberately small content model simple while preserving ordering and avoiding a full SOP/CMS subsystem.

Checklist items must be validated server-side as an array of 1 to 20 objects, each with a stable UUID identifier and 1 to 500 characters of text. Titles are 1 to 120 characters; the optional instruction is at most 500 characters; final-affirmation text is 1 to 240 characters. The active designation checklist is unique per tenant/designation. Updating any employee-visible field increments `revision`.

Create a tenant-scoped `daily_checklist_acknowledgements` table with employee profile, acknowledgement date, checklist ID, checklist revision, immutable JSONB snapshot of the displayed items, acknowledgement time, and audit columns. A unique constraint on `(user_profile_id, acknowledgement_date)` establishes the once-per-day rule. The snapshot retains accurate historical evidence when a checklist is subsequently edited.

The browser loads one small "daily checklist status" read model after authentication and profile resolution. If the server says acknowledgement is required, it waits a short, non-disruptive delay, then opens a centred modal. The modal cannot be dismissed through escape, backdrop, navigation, or a close button. It shows progress, each checkbox, and the final affirmation. The submit control remains disabled until every item is selected.

Submission calls one authenticated `acknowledge_daily_checklist_with_audit` RPC. The RPC derives the actor from the session, recalculates working-day eligibility and the active checklist, validates that the submitted checked item IDs exactly match the active item set, inserts the acknowledgement snapshot, and writes an `audit_logs` row in the same transaction. It must be idempotent for a same-day retry and return the existing acknowledgement rather than permit a duplicate.

The initial release blocks the application behind the modal while acknowledgement is required. If the status request or acknowledgement request fails, the modal presents a retry state and does not pretend that acknowledgement succeeded. A later phase can add server-side write gates for selected operational actions if management wants acknowledgement to be a hard prerequisite for specific business actions as well as an application-entry gate.

## Authorization and data protection

- Both tables enable RLS, have no broad direct browser mutation grants, and are scoped to the authenticated actor's tenant.
- Employees can read only their current applicable checklist and their own acknowledgement status/history as required by the UI.
- Super Admin and HR receive server-authorized, audited create, edit, activate, and deactivate operations. Existing RBAC must define the HR capability explicitly rather than treating a designation label as authority.
- All configuration mutations and acknowledgements produce `audit_logs` records. The audit payload contains IDs, revision, counts, and event metadata; it does not need to duplicate checklist prose.
- Migration history remains forward-only, and generated Supabase TypeScript types are refreshed after the schema is added.

## Management experience

Add a compact Daily Checklists screen under an existing administrative/settings surface. An authorized administrator selects a designation, creates or edits its single checklist, orders the items, sets the final affirmation text, previews the employee modal, then activates or deactivates it. The screen warns that saving employee-visible changes creates a new revision and will apply to acknowledgements not yet made that day.

The checklist is deliberately not connected to Dropdown Master text editing. Designations remain controlled dropdown values; checklist management is a separate audited workflow.

## Compatibility and edge cases

- If the employee's designation changes, the next eligibility check resolves the checklist for the current designation. The acknowledgement snapshot and original designation context remain historical evidence.
- If a checklist changes after an employee has already acknowledged it that day, the employee is not prompted again that day; the next working day uses the new revision.
- An employee who becomes ineligible after sign-in is not prompted on a later status refresh. Eligibility is always recalculated by the acknowledgement RPC, so stale browser data cannot bypass the rule.
- If the employee has no designation or the designation's checklist is inactive, status is `not_required`; this supports gradual rollout.

## Validation

- pgTAP: RLS/grant coverage, cross-tenant rejection, role authorization, week-off/ineligible skip, designation resolution, one-per-day uniqueness, exact-item validation, snapshot/revision preservation, and audit rows.
- Focused web tests: required-modal timing, non-dismissible behaviour, checkbox progress, disabled/enabled final affirmation, retry state, no prompt after acknowledgement, and skip states.
- Typecheck and production build for changed packages, plus `git diff --check`.
- Browser QA with a synthetic account for a required checklist, a no-checklist designation, a week-off user, and an authorized HR/Super Admin editor. Database tests prove RLS/RPC; browser QA proves the rendered interaction.

## Delivery sequence

1. Define the explicit HR permission in the existing RBAC contract if it does not already exist.
2. Add the forward-only migration, audited RPCs, RLS policies, indexes, pgTAP coverage, and generated types.
3. Add typed API functions and pure eligibility/display types in shared packages.
4. Build the administrative checklist editor and preview.
5. Build the authenticated application-entry modal and focused web tests.
6. Run the validation suite, then complete local and hosted release checks separately before declaring the feature live.
