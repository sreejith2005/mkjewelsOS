# CRM as a native JewelOS section: layout, Form Builder bindings, CRM → FMS/Tasks

Status: **Phase A shipped** (PR #50). **Phase B and C shipped for client queue and lead
registration** (branch `feat/crm-form-bindings-20261103`, JewelOS 0373, CRM 20261103000100). The
walk-in visit form (Option A: Form Builder questions, with the existing companions, products and
photos blocks kept), Phase D and Phase E are not implemented yet.

Owner decisions 2026-11-03: Option A for the walk-in special parts; Super Admin manages CRM forms
(permission `crm.manage_forms`); order Lead/Queue first, then Walk-in.

Owner request 2026-11-03: CRM becomes an ordinary JewelOS section, its forms are maintained in
the Form Builder, and CRM answers feed FMS and Tasks, without rebuilding the CRM, adding a second
form builder or customer master, or merging the two Supabase projects.

## Phase A: CRM inside the JewelOS shell (implemented)

Before: `apps/web/src/App.tsx` returned `<CrmApp>` outside `ApplicationShell` for `/crm/*`, so the
JewelOS header and sidebar disappeared and the CRM drew its own header, drawer, theme switch,
"← JewelOS" link and LOGOUT.

Now:

- `App.tsx` renders `<CrmApp layout="section">` as `pageContent`, like every other section. The
  same JewelOS gates apply (permission, Developer Mode switch, fallback page), and the error
  boundary and `Suspense` are the shell's.
- `CrmApp` has a `layout` prop (`"standalone"` default, `"section"`), carried by
  `crm-port/layout-context.ts`. `EmbeddedCrmRoot` does not pass it and keeps the original shell.
- `CrmShell` in section mode renders only a tab row (REGISTRATION, CLIENT QUEUE, CLIENT DATABASE,
  DASHBOARD, NOT BOUGHT FOLLOW UP, REFERRALS) and the existing `ClientSearch`. Paths are
  unchanged, so every `/crm/...` deep link opens the same page.
- The registration choice (CLIENT / WALK-IN or LEAD) moved from component state into
  `?register=client|lead`, so the CLIENT QUEUE tab, browser Back/Forward and reloads work.
  `EntryQueue` keeps `register=client` in its own queue links.
- Styles: the CRM root gets `crm-in-shell`; `jewelos-theme.css` styles the tabs, removes the CRM
  page gutter (the shell already pads) and makes the root transparent. Nothing is positioned
  against the window, and the CRM's `isolation: isolate` keeps its search results under the
  JewelOS header. `fitListingHeights` also leaves the shell's padding under the CRM, so desktop
  listings keep one scroll bar.
- No schema, RPC, RLS, storage or sync change. No Android change (the app shows the web app).

## Phases B and C as built (queue and lead)

- **Links** live in the JewelOS project: `crm_form_binding_versions` (immutable) and
  `crm_form_bindings` (active pointer), written only by `save_crm_form_binding` /
  `clear_crm_form_binding` (permission `crm.manage_forms`, `assert_module_enabled('crm')`,
  optimistic `p_expected_version_id`, audit `crm_form_linked` / `crm_form_unlinked`).
  `get_crm_form_bindings` (crm.view) returns each active link with the newest published version
  of the linked form family, so CRM users can render it whatever the form's library roles.
- **Targets** are the CRM RPC contracts, not a form layout: queue = `client_name`, `mobile`;
  lead = the CRM's own `lead_form_fields` (so a new CRM lead field appears by itself).
  `packages/core/src/crmForms.ts` holds the shared checks (`checkCrmFormBinding`), suggestions and
  the starter form. At every opening CRM re-checks the link against the current published version;
  if it no longer fits, CRM shows its standard form and tells form managers why.
- **Rendering**: the linked form opens in a JewelOS dialog (portal to `document.body`) with the
  shared `FormRenderer`. It cannot be inline: the CRM stylesheet resets every element inside the
  CRM root. The branch for queue registration stays a CRM choice.
- **Saving**: one browser write, to the CRM project, through `register_walkin_entry_from_form` /
  `save_crm_lead_from_form`. They call the existing RPCs unchanged and record
  `crm_private.form_submission_links` (submission key, form family/template/version, link
  version, every answer with its displayed label, the CRM payload, answers CRM did not take) in
  the same transaction. A retried key returns the first result; a different payload is refused.
  The Runo push after a lead is unchanged.
- **Not built yet**: the copy into JewelOS `form_submissions` over the CRM outbox (Phase C step 3
  below). Until then the CRM link row is the record of which form version produced each CRM
  record; Forms Library does not list these submissions.
- **Exact copies (owner request 2026-11-03, later)**: the generic starter form was replaced by
  "Copy today's CRM form". The queue copy is CLIENT NAME + MOBILE NUMBER; the lead copy is built
  in the browser from the CRM's live lead configuration (fields, labels, order, required, the same
  Dropdown Master lists or choices, and option routes as Form Builder conditions;
  `crmLeadFormCopy`). The copy is published as an ordinary form, linked at once, and listed in
  Forms Library under **CRM forms** for authors; Fill form there opens CRM registration.
- **Walk-in visit (2026-11-04)**: new Form Builder question types for CRM forms: `repeat`
  (repeating group in `validation.repeat`) and `crm_photo` (CRM documents upload), plus
  `validation.crm` behaviours (client lookup by mobile, pincode lookup, branch CRM people /
  salespeople). JewelOS submission keeps refusing these types; CRM saves them. A walk-in answer
  may be filled from up to three questions (first answered wins). `crmWalkinFormCopy` builds the
  six-section copy; the walk-in page opens it from the queue entry with the standard prefill and
  saves through `submit_walkin_visit_from_form`, which calls `submit_walkin_visit` unchanged
  (JewelOS 0375, CRM 20261104000100). The three `*_from_form` wrappers now run with the caller's
  rights; only the replay check and a same-transaction link record are privileged.
- **Automatic client details (2026-11-04, owner request)**: the per-question "In CRM forms"
  settings and question widths were removed. Every form now recognises client phone and pincode
  questions by type and wording (`clientAutofill.ts`) and, for people with CRM access, fills the
  questions it recognises from CRM (`createCrmClientLookup`, through the login bridge). The
  walk-in link gives its Salesperson / CRM questions the branch lists. Saved widths are ignored.
- **Client history from every form (2026-11-04, owner request)**: JewelOS 0376 gives a submitted
  form with a client phone answer and no own mapping an automatic "history only" mapping
  (descriptor.automatic; phone -> primary_phone identity, every other answer history) through the
  existing customer events pipeline; the author's screens ignore automatic mappings. CRM
  20261104000200 approves such mappings on registration, attaches to existing clients only,
  never projects profile values from them, and skips (outcome rejected, reason automatic_*) when
  no client matches or the branch may not be written, without the identity review queue.
- **Form Builder addition (withdrawn 2026-11-04)**: question width (`validation.width`: full, half, third) for
  side-by-side questions on wider screens; phones keep one question per row.

## Phase B: Form Builder bindings (original design)

Home: **JewelOS project**, beside the forms they reference.

- `crm_form_binding_versions` (append-only): tenant, purpose (`queue` | `walkin` | `lead`),
  `template_id`, the published template version validated at activation, `field_map jsonb`
  (`crm_target -> form field_key`), validation result, created_by/at. Immutable by trigger.
- `crm_form_bindings`: one row per tenant and purpose pointing at the active version, or none
  (none = the existing CRM form, the compatibility fallback).
- RPCs (each `assert_module_enabled('crm')`, `has_permission`, `audit_logs` row in the same
  transaction): `get_crm_form_bindings()`, `validate_crm_form_binding(purpose, template_id,
  field_map)`, `save_crm_form_binding(...)`, `activate_crm_form_binding(version_id)`,
  `deactivate_crm_form_binding(purpose, reason)`. New permission `crm.forms.manage`
  (catalog + `catalog.migration.test.ts` parity).
- Target catalog in `packages/core/src/crm/formBindings.ts`, shared by the panel and the RPC
  mirror:
  - queue: `client_name` (text, required), `mobile` (phone, required). Branch, token, CRM queue
    and identity stay with `register_walkin_entry`.
  - lead: the `lead_form_fields.field_key` set `save_crm_lead` accepts, with each field's type and
    `is_mandatory`.
  - walk-in: the `submit_walkin_visit` payload keys, grouped (visit, outcome, companions, products,
    bridal, media).
- Validation: every required target mapped to a field of a compatible type that exists in the
  current published version (by `field_key`, never label); option fields must use a Dropdown
  Master list whose values match CRM vocabulary. Activation fails with the list of problems.
- Panel: **CRM Form Settings** opens as a drawer from REGISTRATION for `crm.forms.manage` users:
  current form per purpose, Change form, Preview (shared `FormRenderer`, read-only), Edit in Form
  Builder (`/forms?...`), Validate mapping, Save / Activate, Use the standard CRM form.
- Version pinning: an opened form keeps the template version it loaded; submission carries that
  version id and is validated against it. A newer publish applies to the next opening only.

## Phase C: submissions into the existing CRM records (original design)

One browser write, to the CRM, through the existing audited RPCs; JewelOS receives its copy over
the existing CRM → JewelOS outbox.

1. The shared `FormRenderer` collects and validates answers (sections, conditions, required,
   Dropdown Master) against the pinned version.
2. The browser calls a new CRM wrapper RPC with a client-generated `submission_key` (UUID):
   `register_walkin_entry_from_form`, `submit_walkin_visit_from_form`, `save_crm_lead_from_form`.
   Each maps answers with the binding's `field_map` snapshot, calls the existing RPC unchanged
   inside the same transaction, and inserts `crm_private.form_submission_links (submission_key
   unique, binding_version_id, template_version_id, record_type, record_id, answers snapshot)`.
   A replay with the same key and payload returns the first result; a different payload is
   rejected. Phone normalization, client lookup, tokens, duplicates, Runo push and audit stay in
   the existing functions.
3. The same CRM transaction enqueues an outbox event (`crm.form_submission`) that CRM
   `sync-deliver` sends to JewelOS `crm-sync-receive`. A new service RPC writes the JewelOS
   `form_submissions` row (same `submission_key`, version, actor) idempotently. The CRM record is
   already saved, so the employee sees success at once; Forms history shows "Waiting for sync"
   until the copy lands, and failures appear in Customer Integration with retry.
4. Walk-in prefill: the visit form opens from the queue entry id. The wrapper reads the queue row
   server-side (name, phone, client id, branch, CRM) and rejects a mismatched or completed queue,
   so opening the form never creates a client.
5. Gap: the Form Builder has no repeatable groups (companions, product lines) and stores files in
   JewelOS storage, while CRM media is private CRM storage. See decision 1.

## Phase D: CRM answers → FMS and Tasks (design)

- CRM emits immutable events after its existing writes: `crm.walkin_submitted` (visit id, client
  id, MKC code, branch, CRM, salesperson, approved outcome fields) and `crm.lead_saved`, through
  the existing outbox, `sync-deliver` and `crm-sync-receive` (`crm_sync.inbox` deduplicates by
  event id).
- JewelOS `fms_crm_trigger_versions` (append-only) + `fms_crm_triggers` (active pointer): flow,
  event type, conditions on approved catalog fields (`outcome = NOT BOUGHT`), starter assignee
  rule. Configured in the FMS builder start step ("Start from a CRM event"); off until an admin
  activates it.
- `crm_sync_apply_crm_event` (service only) evaluates active trigger versions with the existing
  FMS condition rules, starts the run through the existing start contract, stores the snapshot
  in `fms_instance_crm_sources` (immutable: event id, client id, record id, trigger version,
  answers), and has a unique index on `(trigger_version_id, source_event_id)`, so a replayed
  event cannot start a second run. Later mapping changes create a new version and never rewrite
  completed runs.
- FMS stage forms may prefill from the snapshot ("From CRM"). Reading the snapshot follows FMS
  work visibility; phone and customer fields are shown in full only to users with `crm.view`.
- Tasks: walk-in tasks stay as they are (`source = 'crm_walkin'`, `source_ref_id` = queue id).
  New simple CRM work uses the same pattern (`crm_lead_followup`, `crm_not_bought`) with a unique
  partial index on `(source, source_ref_id)`. A trigger chooses either an FMS run or a simple
  task, never both, so one event never makes two tasks for the same work. Without an explicit CRM
  follow-up date, the due date uses the half-day rule (0371 `dayHalfDeadline`, still unmerged in
  `C:\jhalf`); FMS form-derived deadlines are unchanged.
- Client profile: add "Linked forms", "FMS runs" and "Tasks" panels to the existing profile, read
  with one paged RPC per panel (cursor pages, no N+1), authorized as the asker.

## Phase E: rollout

1. Phase A live; owner checks the regression list ("CRM inside JewelOS - 2026-11-03").
2. Phase B migration (JewelOS) + panel, no binding active: nothing changes for staff.
3. Phase C migrations (CRM wrappers + links + outbox kind, JewelOS receiver), then activate the
   Lead binding first (smallest form), then Queue, then Walk-in.
4. Phase D migrations; one Not Bought trigger piloted in one branch.
5. Legacy CRM form components are removed only after each binding has run cleanly in production.

Rollback at every step: deactivate the binding or trigger (the standard CRM form and no
automation return immediately); migrations are additive.

## Owner decisions needed before Phase B–D

1. **Walk-in special blocks.** (a) Extend the Form Builder with repeatable groups and a "CRM
   document" upload that writes to private CRM storage, or (b) hybrid: the Form Builder renders
   the walk-in questions and the existing CRM companion/product/media blocks stay inside the
   form. (b) is smaller and safer; (a) is the full goal.
2. **Who manages bindings**: proposed new permission `crm.forms.manage`, Super Admin by default.
3. **Which CRM answers FMS may read** (proposed: outcome, not-bought reason, product category,
   salesperson, branch, MKC code, visit date; phone only for `crm.view`).
4. **Order**: the half-day deadline change (0371, `C:\jhalf`) should merge first, because Phase D
   tasks depend on it.
5. Optional, separate: merging the two Supabase projects later would remove the cross-project
   outbox, but it is not part of this work.
