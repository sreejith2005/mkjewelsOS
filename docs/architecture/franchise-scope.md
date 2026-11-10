# Franchise scope

Migrations `0385_franchise_foundation.sql` (Phase 1),
`0386_franchise_module_scope.sql` (Phase 2) and
`0387_franchise_scope_completion.sql` (Phase 3); CRM project
`20261107000100_crm_roster_franchise_scope.sql`. **Franchise isolation is Off**
until Super Admin switches it on (Users > Franchises), which needs every store
mapped to a franchise.

Owner decisions (2026-11-06):

- Exhibitions are temporary event locations (a new one most months), not
  stores. They need no franchise and never block activation; their work
  reaches the people who do it, and Super Admin sees everything.
- Roles are set in Users. Since 0393 (owner request 2026-11-07) the franchise
  comes from the person's own store: Admin and HR cover their store's
  franchise automatically (see "Automatic scope" below). Users > Franchises >
  Add extra scope (formerly Grant scope) is only for exceptions.
- Picking employees from other locations in a form is switched on per Users
  question in the form builder ("Allow selecting employees from other
  locations"); no separate permission is needed.
- CRM customer details, visits and history are shared by every store,
  branch and city: no franchise filter applies to CRM customer data.
- Super Admin sees and does everything in every store, including Store
  Intelligence.

## Structure

```text
Company (tenant) -> Franchise group -> Branch (store / exhibition / office / warehouse) -> Department -> Employee
```

- One MK Jewels tenant, the same two Supabase projects. Franchise groups are
  rows inside the tenant (`franchise_groups`), identified by UUID, never by
  city name.
- `branches.franchise_group_id` is the **only** place a franchise is stored.
  Tasks, forms, FMS runs, notifications and CRM records keep their existing
  `branch_id`; their franchise is always derived through the branch, so it can
  never drift.
- Composite foreign keys `(tenant_id, id)` on `franchise_groups`, `branches`
  and `user_profiles` stop a branch or grant from pointing at another tenant.
- `branches.location_kind` (`store`, `exhibition`, `office`, `warehouse`)
  records what a location is. It grants nothing. An exhibition must be mapped
  to one owning franchise with a written reason; an unmapped exhibition blocks
  activation, so it can never expose both franchises.
- The trigger `branches_franchise_guard` refuses any change to a branch's
  franchise or location type outside `assign_branch_franchise_with_audit`,
  whatever the write path (including service role).

## Concepts kept separate

| Concept | Where it lives |
|---|---|
| Authentication | Supabase Auth -> `current_profile()` |
| Capability (what you can do) | `permission_effective_for()`: role, department, designation, user overrides; plus scope-authority defaults while isolation is on |
| Data scope (which franchise/stores) | `org_scope_grants`, `branches.manager_id`, own `branch_id`, resolved by `org_scope_branch_ids()` |
| Work assignment | unchanged (task assignees, FMS stage assignees) |
| Record ownership | the record's `branch_id` -> `branches.franchise_group_id` |

A permission override never widens data scope: scope comes only from grants,
`manager_id` and the person's own branch.

## Leadership hierarchy (migration 0397, owner request 2026-11-09)

Supersedes the Admin rows of "Automatic scope" below and the Director row of
"Scope authorities".

| Role | Sees | Can change |
|---|---|---|
| Super Admin | everything | everything |
| Admin (no Director grant) | every franchise and store (`org_has_company_scope`) | users (add, edit; not delete), franchises and stores (add only), tasks and Task Control templates (create, assign, edit), leave and availability |
| Director (Admin role + `director` grants) | only the franchises and single stores granted | as Admin, but only inside that scope; adds stores only to a whole franchise they oversee; never creates or edits Admin or Director accounts |

- **Capabilities.** Admin's defaults no longer include `fms.manage`,
  `forms.manage`, `notifications.manage`, `settings.manage_organization`,
  `settings.manage_branch` or `recording.manage_rubric`; role-level grants of
  these (and of `tasks.delete` and `users.delete`) to Admin were removed
  (audited `role_permission_reset`). Individual
  user overrides set by Super Admin stay. New `tasks.delete` (Super Admin) is
  required by `delete_task_lifecycle_with_audit` and
  `admin_delete_task_series_with_audit`, so every task, series and template
  delete path needs it. New `organization.add_locations` (Super Admin, Admin)
  gates adding franchises and stores. Users, leave and every other delete was
  already Super Admin only. Manager keeps branch defaults; form authoring
  moved to Super Admin only in 0401.
- **View-only designs (migration 0401, owner 2026-11-10).** Admins, Directors
  and Managers hold `fms.view_designs`, `forms.view_designs`,
  `settings.view_organization` and the Dropdown Master page (`dropdowns.view`).
  `fms_my_flow_access` reports `view` on every workflow the person can see
  (`org_definition_visible`), so the 0390 View path (RLS reads, builder in view
  mode) serves them; an explicit grant wins and `view` never passes
  `can_edit_fms_flow`. `can_access_form_template` lets `forms.view_designs`
  read drafts and archived versions where `forms.manage` could. No write path
  checks the new keys. The Manager role grant of `forms.manage` was removed
  (audited).
- **Director identity.** No `user_role` value was added (about 420 checks
  treat `super_admin, admin` as one group, and a Director must keep every
  Admin read path). `org_is_director(profile)` = effective role Admin and an
  active non-company `director` grant. Director grants may now be franchise or
  single-store (`org_scope_grants_authority_level` relaxed for `director`);
  store grants count as manageable for a Director.
- **Company scope.** `org_has_company_scope` = Super Admin, a company grant,
  or an Admin who is not a Director. `org_automatic_scope` now confers HR only.
  `assert_org_user_write` never treats a Director as company scope (even with
  isolation off) and lets only company scope create or edit Admin and
  Director accounts.
- **Contracts.** `create_director_profile_with_audit` (service role, from
  `invite-user` when `user_role` is `director`): account, Leadership
  department, home store and grants in one transaction.
  `save_director_with_audit` (company scope with `users.manage`; changing
  someone's role stays Super Admin): Admin role, Leadership department, no
  designation, buddies or reporting manager, home store inside the scope, grants
  replaced. `end_director_with_audit` makes a Director a company-wide Admin;
  leaving the Admin role in `update_user_profile_with_audit` revokes Director
  grants. `list_director_scopes` labels Directors in Users.
  `get_org_locations` lists the franchises and stores the viewer may see and
  where they may add. `save_franchise_group_with_audit` (new franchise) and
  `create_branch_in_franchise_with_audit` accept `organization.add_locations`
  holders through `org_assert_location_creator`; editing stays Super Admin.
- **Leadership department.** `org_leadership_department(tenant)` finds or
  creates one company-wide department named Leadership (department is NOT NULL
  on `user_profiles`). A Director's home store is the requested store inside
  the scope, else the first chosen store, else the first store of the first
  chosen franchise.
- **Existing Directors.** The migration made every active Admin whose
  designation is "Director" a Director of their own store's franchise and
  moved them to Leadership with no designation (narrowing only; a profile
  that cannot move keeps its department and is logged as
  `director_department_unchanged`).
- **Store Intelligence.** Company scope lets an Admin open every branch's
  conversations, as Super Admin does (`recording_is_reviewer`).
- **Directors are always scoped (migration 0398).** `org_scope_enforced(tenant)`
  is true while the tenant's switch is on *or* the signed-in person is a
  Director of that tenant (`org_isolation_switch_on()` is the switch alone).
  Every franchise rule therefore narrows a Director's directory, tasks, Task
  Control, FMS, forms, dashboards, reports and exports with the switch off.
  Everyone else, and work with no signed-in person, is unchanged until the
  switch is on. Tests: `supabase/tests/0398_director_scope_always_on.test.sql`.
- **Scope answers are remembered per transaction (migration 0400).** The
  per-row helpers `org_scope_enforced`, `org_has_company_scope`,
  `org_scope_branch_ids` and `org_branch_visible` keep their last answer in a
  transaction-local setting keyed by their arguments, the signed-in user and a
  generation number. Statement triggers on `org_scope_grants`, `user_profiles`,
  `user_access_profiles`, `branches`, `franchise_groups` and
  `tenant_franchise_controls` bump the generation, so a change in the same
  transaction is seen at once; nothing outlives the transaction. Without this, a
  Director's Home, Dashboard and Reports ran past the request time limit. Home's
  recent activity reads each in-scope person's latest entries through
  `idx_audit_logs_home`. A new scope input table needs the same trigger. Tests:
  `supabase/tests/0400_director_scope_speed.test.sql`.
- Tests: `supabase/tests/0397_leadership_hierarchy.test.sql`; franchise tests
  0385-0387 now model the franchise-limited Admin as a Director.

## Automatic scope (migration 0393, numbered 0390 before deploy)

`org_automatic_scope(profile)` derives one franchise authority from the
person's effective role (dashboard authority, else role) and the franchise of
their own store, on every call (nothing is copied, so a change of store, role
or mapping moves it at once):

| Effective role | Automatic authority | Covers |
|---|---|---|
| Admin | Regional Admin | every store of their store's franchise |
| HR | HR | every store of their store's franchise |
| Store manager (`branches.manager_id`) | Store Manager | that store (unchanged) |
| Anyone else | none | their own store |

It counts exactly like the equivalent grant in `org_scope_branch_ids()` and
`org_scope_authorities()` (so, while isolation is on, also for the
scope-authority permission defaults). Nothing is conferred when the store has
no franchise (an exhibition), the franchise is inactive, or the person is not
active. Explicit grants still add to it (company scope, another franchise, a
Director who keeps the manager role, store access). The Franchises panel lists
it under **Automatic**; readiness no longer flags a covered leader. Mirror:
`automaticScopeAuthority()` / `resolveOrgScope()` in
`packages/core/src/organization/franchiseScope.ts`. Tests:
`supabase/tests/0393_automatic_franchise_scope_and_section_matrix.test.sql`.

## Scope authorities (`org_scope_grants`)

| Authority | Level | Reads | Manages (users) |
|---|---|---|---|
| Super Admin (role/authority) | company | everything | everything |
| Director | franchise (or company, Super Admin grant) | all stores of the franchise | ordinary users and Regional Admin/HR of the franchise, not other Directors |
| Regional Admin | franchise (or company) | all stores of the franchise | as above (with `users.manage`) |
| HR | franchise (or company) | all stores of the franchise | ordinary employees of the franchise |
| Store Manager | one store per grant; `branches.manager_id` counts too | that store | ordinary employees of that store |
| Store access | one store per grant | that store (read only) | nothing |
| Everyone else | own store | own store; own profile in the directory | nothing |

Director is a first-class persisted authority, not a new `user_role` value:
adding an enum value would place a Director below Staff in every existing
role-list check. A Director typically keeps the `manager` role for
capabilities and receives a Director grant for scope. Only Super Admin can
grant or revoke scope, and only Super Admin can grant company scope.

## Central contracts

| Function | Purpose |
|---|---|
| `org_scope_enforced(tenant)` | the activation gate (`tenant_franchise_controls`) |
| `franchise_enforcement_supported()` | `false` until the Phase 2 migration replaces it |
| `org_has_company_scope(profile)` | Super Admin authority or a company grant, active profile only |
| `org_scope_branch_ids(profile, manage)` | readable / manageable branch sets |
| `org_branch_in_data_scope(branch)` | predicate for Phase 2 policies; null branch = company scope only |
| `assert_org_user_write(actor, target, dest_branch, dest_role)` | every user create/edit (invite, coverage, editor) |
| `assert_org_user_target_scope(actor, target)` | deletion paths (`prepare_unused_user_deletion`, `remove_employee_with_audit`) |
| `get_my_org_scope()` | the browser's own scope snapshot (informational only) |

Super Admin RPCs (`franchise.manage`, all audited in `audit_logs`):
`save_franchise_group_with_audit`, `assign_branch_franchise_with_audit`
(impact counts in the audit row), `create_branch_in_franchise_with_audit`,
`grant_org_scope_with_audit`, `revoke_org_scope_with_audit`,
`transfer_employee_franchise_with_audit` (cross-franchise move; history kept,
franchise/store grants revoked), `get_franchise_readiness_report`,
`get_franchise_admin_context`, `set_franchise_enforcement_with_audit`
(switching off is always allowed; on requires Phase 2 support and complete
mappings).

## Permission matrix

New catalog keys:

| Key | Kind | Default roles | Scope-authority default (isolation on) |
|---|---|---|---|
| `franchise.manage` | protected | Super Admin | none |
| `users.manage_scoped` | action | Super Admin | Director, Regional Admin, HR, Store Manager |
| `users.view` (existing) | module | unchanged | Director, Regional Admin, HR, Store Manager |

User-management rules (`assert_org_user_write`):

| Actor | Isolation Off | Isolation On |
|---|---|---|
| `users.manage` holder (Admin) | company-wide, as today | only manageable branches; never company-scope or Director accounts; franchise change only by transfer |
| `users.manage_scoped` only (Director/HR/Store Manager defaults) | only manageable branches | same; ordinary employees only; cannot assign Admin or Super Admin |
| Super Admin | everything | everything; franchise change only by transfer |
| Anyone | Super Admin creation needs Super Admin authority (unchanged) | same |

Employee directory (`user_profiles` SELECT), isolation on: an additive policy
lets franchise and store authorities see the people they manage; a restrictive
policy limits everyone below company scope to their readable branches plus
their own row. Isolation off: both policies are inert.

## Backfill and exception report

The migration changes no existing row: every branch starts unmapped
(`franchise_group_id` null, `location_kind` `store`) and no grant is created.

The owner maps branches in **Users > Show franchises**, after reviewing the
production branch list with `scripts/franchise/branch-inventory.sql`
(read-only; prints branch names, codes, cities and counts only). Expected
mapping, to be confirmed against the real branch master:

| Franchise | Stores |
|---|---|
| Mumbai | Bandra, Andheri, Zaveri Bazaar |
| Ahmedabad | the two Ahmedabad stores (names from the branch master) |
| Owner decision | Exhibition: map to one franchise with a reason and Location type Exhibition |

**Readiness** in the same panel is the exception report:

- active stores without a franchise (blocks activation);
- exhibition-like locations to confirm;
- Admin / HR / Manager accounts with no scope grant and no managed store (these
  would see only their own store once isolation is on);
- records with no branch per table (tasks, task templates, form submissions,
  FMS runs, notifications, old CRM clients). These are **not** guessed: once
  isolation is on they are visible to company scope only until an explicit
  mapping is approved. Form templates and FMS flows with no branch are shared
  definitions; their submissions and runs stay individually scoped;
- employees whose department belongs to another store.

## Rollout

1. Phase 1 (this change): migration 0385 + web. Isolation Off. Visible effect:
   Super Admin sees the **Franchises** panel in Users. Everything else is
   unchanged; `users.manage` keeps its company-wide meaning.
2. Owner maps stores, decides the exhibition, and grants Director / Regional
   Admin / HR / Store Manager scope. Readiness reaches "Every active store has a
   franchise".
3. Phase 2 migration: scope predicates on tasks, forms, FMS, notifications,
   reports, exports, Kiara tools, CRM project, Storage; replaces
   `franchise_enforcement_supported()`; adds cross-location assignment.
4. Activation: Super Admin switches isolation on (audited). Rollback: switch it
   off; all Phase 1 data stays.

## Phase 2 (migration 0386)

Everything below is inert while isolation is Off: each rule first asks
`org_scope_enforced()` and, when it is false, keeps today's behaviour.

### Coverage registry (the activation lock)

`franchise_scope_modules` lists every section and whether it follows franchise
scope. `franchise_enforcement_supported()` is true only when every row is
`enforced`; `set_franchise_enforcement_with_audit(true, ...)` refuses
otherwise. Users > Franchises > Readiness shows the list (Ready / Not yet).

| Section | Status after 0386 | How |
|---|---|---|
| Users | Ready | 0385 directory policies, `assert_org_user_write` |
| Tasks | Ready | `can_read_task`, `task_assignment_user_in_scope` |
| FMS runs and handoffs | Ready | `can_read_fms_instance`, `assert_fms_handoff_recipient`, `fms_assignment_user_from_submission` |
| Forms | Ready | `can_access_form_template`, `can_open_form_from_library`, `can_manage_form_template`, `can_read_form_submission`, definition write guard |
| Dashboard, insights, Employee Task Performance | Ready | `task_in_reporting_scope`, `fms_stage_in_reporting_scope`, `client_in_reporting_scope`, performance context / rows / options |
| Notifications | Ready | own rows only (unchanged) |
| CRM roster | Ready | `crm_roster_jewelos_branch_ids` + CRM migration |
| Task Control, task templates, bulk reassign | Not yet | task_templates read policy and Task Control lists still use role scope |
| FMS builder writes and FMS flow reports | Not yet | flow saves, `get_fms_flow_report` / `get_fms_flow_records`, trigger history |
| Business Reports and CSV exports | Not yet | form / FMS report types in `report_rows_for_profile`, `export_*` |
| CRM project client data | Not yet | every active CRM user still reads every client (original-CRM rule) |
| Store Intelligence | Not yet | admin scope is company-wide |
| Storage | Not yet | FMS context uploads and recording media not reviewed |
| Ask Kiara / FMS AI | Not yet | tools inherit the section RPCs; need franchise eval cases |
| Search, Availability, Dropdown Master | Not yet | not reviewed |

A later migration closes a section by fixing its read paths, adding pgTAP
cases and setting its row to `enforced`.

### Read scope

- The central predicates gain the franchise clause; every RLS policy and RPC
  that already calls them follows automatically.
- A **task** is visible to leaders through its branch (execution owner: doers
  belong to it), its creator's branch (originating owner) or an active
  assignee in their own team. A person always sees work they created, do or
  watch.
- An **FMS run** is visible to leaders through its branch (origin), its
  starter's branch, or a stage assignee in their team; participants always.
- **Form submissions**: Admin role within scope; the manager role reads every
  store in their scope (Directors usually hold the manager role).
- **Definitions** (`form_templates`, `fms_flows`) gain
  `owner_franchise_group_id`: null = shared company-wide (every existing row),
  set = one franchise. A franchise authority creating a definition while
  isolation is on owns it for their franchise; revisions inherit the family
  owner. Only company scope edits a shared form (`form_definition_write_guard`
  on `form_templates` definition columns and on `form_fields`). Super Admin
  moves ownership with `set_definition_owner_franchise_with_audit` (the
  questions of a published version never change). Access through assigned
  work (task, FMS starter, FMS step, readable submission) never depends on the
  definition's franchise, so a cross-location assignee can open the form they
  must fill.
- **Reports**: aggregates filter rows by scope before counting. Each stage /
  assignee row counts once per viewer, so a cross-location task is never
  double-counted. Work without a signed-in person (background report jobs)
  has no actor and sees nothing while isolation is on; giving report jobs
  their owner's scope is part of the pending Business Reports section.

### Assignment scope and cross-location work

| Path | Local rule (isolation on) | Cross-location rule |
|---|---|---|
| Task recipients (`task_assignment_user_in_scope`) | today's tenant / branch / department scope **and** the recipient in a franchise the actor reads | a delegation request naming a store in **another mapped franchise** whose doers all belong to it, by someone holding `tasks.assign_cross_location` + `tasks.assign_others`; inside one franchise today's rules are unchanged |
| FMS explicit handoff (`assert_fms_handoff_recipient`) | recipient in the actor's franchise | only a recipient validated in the same transaction by a cross-location Users question |
| FMS "Assigned To from the form" (`fms_assignment_user_from_submission`) | recipient in the run's franchise | the saved answer of a cross-location question |
| Users answer on submit (`assert_form_user_answer`) | recipient in the submitter's franchise | question saved with **Allow selecting employees from other locations**, submitter holds `tasks.assign_cross_location`, recipient eligible |

- The setting is `form_fields.assignment_scope` (`local` default /
  `cross_location`, Users questions only, check constraint). It is validated in
  `normalize_form_fields`, saved by `replace_form_draft_fields`, copied by
  revisions and duplicates, captured in `template_snapshot`, and read by the
  loaders as `assignmentScope`. Existing forms are unchanged (`local`).
- A Users answer is informational unless the FMS step assigns from that
  question; choosing someone never creates work by itself.
- Lookup: `list_assignment_locations(context)` (franchise and store names) and
  `search_assignment_recipients(context, store, search, offset, limit <= 50)`
  (id, name, designation, store, franchise; no phone, email or HR data). The
  context names the saved question (or `task`) and is re-checked on every call;
  the lookup grants no other read access.
- `tasks.assign_cross_location` (action; default Super Admin, Admin, Manager,
  HR, CRM, Staff; a user / department / designation deny wins).
- Audit: `cross_location_task_assigned` (both owners) and
  `cross_location_recipient_selected` (per submission, origin and destination
  store and franchise).

### Users

- The routed Users page is `TeamDirectoryPage`. Its **Franchises** button
  (Super Admin) opens the panel: organisation tree with employee counts and
  store managers, scope, readiness with section coverage, and history. Phase 1
  had placed the panel on `UserManagementPage`, which no route renders.
- Franchise filter and column once franchises exist. Rows come from
  `user_profiles` under the 0385 directory policies, so a franchise authority
  receives only their scope's rows; the browser never filters out foreign rows.
- **Add user**: Franchise / location -> Store / branch -> Department
  (`userFormLocationChoices`, `departmentsForStore`); one-franchise and
  one-store authorities get theirs chosen. `users.manage_scoped` holders can
  open Add user; scoped-only managers are not offered Admin. The employee
  editor shows the franchise and offers only its stores (moving franchise =
  Super Admin transfer).

### CRM project

- Roster: with isolation on, `crm_sync.staff_roster_fields` sends
  `crm_roster_jewelos_branch_ids` (the stores of the person's franchise); the
  CRM project puts the CRM department on those stores' rosters only. Switching
  isolation, or moving a store while it is on, re-sends the roster.
- CRM client data: shared by every store (owner decision, see the top of this document).

## Phase 3 (migration 0387)

Everything stays inert while isolation is Off: every rule first resolves the
viewer's filter, which is "unrestricted" while isolation is off or for company
scope. Tests: `supabase/tests/0387_franchise_scope_completion.test.sql` (the Phase 2
personas).

### Shared helpers

| Helper | Purpose |
|---|---|
| `org_branch_filter_for(tenant, profile)` / `org_my_branch_filter()` | readable stores, or null when unrestricted; computed once per statement; no actor while on = empty |
| `org_record_in_filter(filter, branch, people[])` | a record visible through its store or one of its people (creator, assignee, requester) |
| `org_task_in_filter`, `org_fms_instance_in_filter` | the 0386 task / run ownership rule with a precomputed filter |
| `org_assert_person_in_my_scope`, `org_assert_task_in_my_scope`, `org_assert_fms_stage_in_my_scope` | write guards; people on the work (creator, doer, watcher, FMS assignee, starter) always pass |
| `org_scope_actor()` | the signed-in person, or for a background report job the requester recorded on the export (service role only) |

### Coverage closed by Phase 3

| Section | Enforcement |
|---|---|
| Task Control, templates, bulk reassign | `task_workspace_page` ids and counts scoped before counting; template directory, Assigning Left and recurring workspace scoped; `task_templates` restrictive read policy and a write guard trigger (every RPC path); reassignment needs the source employee in scope; Task Control edit / delete, recurring follow-up, verification and run-now check the task or schedule; bulk import resolves doers only among assignable people; import batch history follows the importer's store |
| FMS builder and flow reports | `fms_definition_write_guard` on flows, steps, routing rules and default step assignees (owner franchise or company scope; shared workflows only by company scope); `can_manage_fms_flow`; flow report and records refuse a foreign franchise's workflow; trigger history, inspection, retry and samples scoped (summary counts too); handoff picker lists only people the handoff may name; starting from the library needs a visible workflow |
| Business Reports and exports | rows filtered before aggregation in `report_rows_for_profile` and `_v1` (form answers, workflow summary, people, notifications, export history); the report context lets scope authorities report across their scope and refuses filters outside it; background exports run with the requester's scope; export list, download, cancel and retry scoped; dashboard counts (people, availability, runs, reviews, delivery health) and Home activity scoped; filter options list only visible forms, workflows, stores and people |
| CRM project client data | not filtered by franchise: owner decision, every store sees every customer |
| Store Intelligence | everyone keeps their own store; Super Admin (company scope) reads and acts on every store, with or without isolation; sales score rules (rubric, SOP, CRM outcome settings) are company-wide definitions and need company scope while on |
| Storage | task attachment uploads by managers only on tasks in scope; FMS context files follow run scope; leave approval images follow the applicant. Task, form, FMS evidence and report files already followed their scoped record |
| Ask Kiara and FMS AI | tools read through the asker's scoped section RPCs (dashboard, reports, progress, availability); colleague lookup limited to the asker's franchise; evidence workspace, insights and escalation answerers scoped; quota admin people search scoped. Eval cases `fr-*` with `supabase/functions/ask-kiara/eval.franchise.fixture.sql`. FMS AI reads only through the builder, which follows definition ownership |
| Search, Availability, Dropdown Master | availability and leave read policies; marking availability, reviewing, editing and handing over leave check the person; `v_task_users`, `leave_summary_applicants` and `leave_handover_candidates` (owner-run views) apply the boundary themselves; Dropdown Master changes need company scope (one company-wide vocabulary); task search runs inside the scoped task lists |

### Authorization matrix (isolation On)

| Identity | Reads | Writes |
|---|---|---|
| Super Admin (company scope) | everything, every store (including Store Intelligence) | everything; switches isolation |
| Director / Regional Admin / HR (franchise grant) | every store of the franchise (tasks, runs, forms, reports, dashboards, availability); every CRM customer | users of the franchise (0385 rules); work, templates and definitions owned by the franchise; never shared definitions, Dropdown Master or sales score rules |
| Store Manager (manager_id or store grant) | the managed store | the store's users and work |
| Staff | own work, own store (Phase 2 rules); work assigned to them from anywhere; every CRM customer | own work; one-time tasks to another mapped store with `tasks.assign_cross_location`; other-location answers on form questions that allow them |
| Cross-location assignee | that task / step, its form and its files | completing that work |
| No actor (cron, sync) | unchanged automated behaviour | unchanged |
| Background report job | the requester's scope, re-checked as still authorized | export files only |

### Cross-store work inside one franchise

Ordinary task creation gains **Someone at another store** (Tasks > Create Task >
Users): Franchise, then Store, then Employee, using the Forms picker and the
bounded lookup (`search_assignment_recipients`, which now also returns the
department id). The server accepts an explicit request naming another **mapped**
store of the same or another franchise (`org_begin_cross_location_task`), when
the author holds `tasks.assign_cross_location` and `tasks.assign_others` and
every doer belongs to that store. Without that request the local rules (manager:
own branch; staff: own department) are unchanged, and before stores are mapped
nothing changes at all. Each such task is audited (`cross_location_task_assigned`)
and exists once. Repeating schedules stay local.

### CRM project

No franchise filter (owner decision 2026-11-06): every CRM user sees every
customer's details, visits and history, as in the original CRM. Only the CRM
department roster follows the person's franchise while isolation is on
(20261107000100, so walk-in salesperson lists show the right stores).

## Deployment sequence

1. Recheck numbering: production `schema_migrations` and `origin/main` end
   before 0385 (JewelOS) and 20261107000100 (CRM). `origin/main` took 0384 for
   Store Intelligence; these files were renumbered 0385-0387.
2. CRM project: apply `20261107000100_crm_roster_franchise_scope.sql` (inert
   until JewelOS isolation is on).
3. JewelOS project: apply 0385, 0386, then 0387, each in one transaction.
   Redeploy `invite-user` (Phase 1 change).
4. Web deploy (Vercel `mkjewels-os`). No APK.
5. Verify with isolation Off. Nothing changes for staff; Super Admin sees
   every store in Store Intelligence.
6. Owner maps stores (exhibitions: Location type Exhibition, no franchise),
   grants Director / Regional Admin / HR scope, and switches isolation on when
   ready (a separate, owner-run step).

Rollback: switching isolation **off** is always allowed and restores today's
behaviour at once (every franchise rule is gated). The migrations are
forward-only and additive; the Store Intelligence Super Admin widening and the
form-question rule apply regardless of isolation. To undo app behaviour,
redeploy the previous web build.

## Isolation switch in the web app (2026-11-10)

Users > Franchises shows **Franchise isolation** On / Off with **Switch isolation
on** / **Switch isolation off** (Super Admin; Reason required) calling
`set_franchise_enforcement_with_audit` through `setFranchiseIsolation`. The
button is greyed out, naming the stores still without a franchise, until
readiness reports every active store mapped and every section ready; the server
re-checks both. Before this the switch existed only on the server. Employees
are never mapped one by one: a person's franchise is always their store's.

## Owner decisions still open

- When to switch franchise isolation on.
