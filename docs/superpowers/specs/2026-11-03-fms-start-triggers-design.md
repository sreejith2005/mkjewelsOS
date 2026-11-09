# FMS start modes and automatic start triggers

Status: built 2026-11-03 (JewelOS migration 0374, CRM migration 20261103000200). Implements
Phase D of `2026-11-03-crm-native-section-design.md` in a general form: a workflow can start from
any supported saved submission, not only from a starting form.

## Start modes

Every workflow version (`fms_flows` row) has `start_mode`:

| Mode | How a run starts | First step |
|---|---|---|
| `form` (default, every existing version) | Someone fills the starting form (unchanged paths). | Must be a Form with a published form; assigned to the submitter. |
| `automatic` | A saved submission matches the version's conditions. | Task, Form, Approval, Decision, Notification or Parallel; assigned by its own strategy, or to the person the source names. |
| `manual` | An authorized person presses **Start** on the FMS card (`start_fms_manual_with_audit`). | As above; assigned by its own strategy (optional handoff). |

The trigger is configuration (`fms_flows.start_trigger`, jsonb), never a stage. It is frozen once
the version leaves draft (`fms_flows_start_frozen`), copied into the next revision, exported with
nothing else (import/export carry steps only), and validated at publish
(`assert_fms_start_trigger_publishable`). A BEFORE INSERT guard on `fms_instances` lets an
automatic or manual version start only through its own path, so the existing form-start functions
are untouched and cannot start them.

Three first-step checks were patched by marker (drift stops the migration): the starting-Form
publish rules, the "first step needs no assignment strategy" publish rule, and the resolver rule
that gives the first step to its submitter. All three now apply to form mode only.

## Trigger configuration (`FmsStartTrigger`, `@jewelos/core/fms/startTrigger.ts`)

- `source`: `jewelos_form` (Forms Library or a form built in an FMS step; by form family, any
  published version), `crm_walkin`, `crm_queue`, `crm_lead`, `crm_linked_form` (+ `purpose`).
- `conditions`: a group tree (`and`/`or`, up to 3 nested levels, 25 rules). Each rule: field,
  operator (equals, not equals, contains, does not contain, is empty, is not empty, greater/less
  (or equal), is one of), stored value(s), on/off. Disabled rules and empty groups are skipped; at
  least one switched-on rule is required to publish. Blank, missing and hidden answers are empty.
  Dates compare as calendar dates (`today` allowed); lists count as their length for numbers.
- `mapping`: up to 20 values copied into `fms_instances.context` (field, fixed value, fallback).
  Reserved keys are refused. Phone and file questions are never offered.
- `title`, `assignment` (`stage_rules` | `source_staff`, unresolved -> `review` | `stage_rules`),
  `dueField` (a date field -> that day 21:00 IST, the second-half deadline; blank or past dates keep
  the step's timing), `reentry` (`one_active_per_case` | `one_per_event`), `onCaseClosed`
  (`record_only` | `cancel_run`).

The source catalog (fields, types, option values) exists twice, kept identical by
`startTrigger.test.ts` ("parity with migration 0374"): `FMS_TRIGGER_SOURCES` and
`fms_trigger_source_catalog()`. Form sources add the newest published version's questions.

## Event engine

```
Forms Library:  form_submissions INSERT/UPDATE (status submitted)
                  -> fms_trigger_capture_form_submission (same transaction; errors kept, never fail the form)
CRM:            visit_forms / entry_queue / leads / form_submission_links INSERT (deferred, at commit)
                not_bought_followups status -> done
                  -> crm_private.submission_outbox (immutable snapshot, one per record)
                  -> sync-deliver (pg_cron) -> crm-sync-receive (kind submission.events, shared secret)
                  -> crm_sync_apply_submission_event (service role; crm_sync.inbox dedupes event ids)
Both:           fms_trigger_events (unique tenant + event key, immutable payload)
                  -> fms_trigger_process_event: each published automatic version of that source
                     -> fms_trigger_evaluations (unique event + version): started | not_matched |
                        duplicate | out_of_scope | review | failed
                     -> fms_trigger_start_run -> fms_instances + fms_instance_trigger_sources
                        -> activate_fms_stage_internal (existing engine: assignment, coverage,
                           deadlines incl. 0371 half-day, notifications, checklist)
```

Idempotency and concurrency: the event row is locked per processing; settled evaluations are
never redone; `fms_trigger_one_run_per_event` (event + family) and
`fms_trigger_one_open_run_per_case` (family + case key, open runs only) are unique indexes, so
retries, replays, refreshes and two concurrent deliveries start one run. A finished or cancelled
run releases its case. The case key is the CRM Not Bought case, else the CRM client, else the
record (or the event, for `one_per_event`).

The existing `walkin.changed` stream (coalescing, claim-time snapshot) is unchanged and still
drives walk-in tasks; the new stream is separate and append-only.

Nothing is stored in JewelOS for a source nobody listens to (`no_trigger`). CRM visits older than
two days when saved (imports, backfills) produce no event. Enabling a workflow never processes
history.

Not Bought: the CRM stays authoritative. The event names the open case the CRM created or merged
into; a closed case (purchase auto-close or a done call status) sends
`crm.not_bought_case_closed`, which either notes the closure on the open run's journey
(`record_only`, default) or cancels the run (`cancel_run`), audited.

## The client's CRM gets CRM work (2026-11-09, JewelOS 0395, CRM 20261109000100)

Owner request: work started by a CRM form goes to the CRM who attends the client, not the
salesperson.

- CRM events carry `crm_jewelos_user_id`: the CRM recorded on the walk-in visit, else the CRM the
  Client Queue chose for that client today (round robin); a queue registration names its queue
  CRM; leads have no CRM. `staff_jewelos_user_id` (salesperson) is unchanged.
- `crm_sync_apply_submission_event` stores it as `crm_profile_id` (same tenant only). For CRM
  sources, `source_staff` ("The client's CRM (from the Client Queue)") resolves that active CRM
  first and the salesperson only when no active CRM is known. Forms Library sources are unchanged.
  New CRM-source triggers default to `source_staff`. The builder's test panel previews the same.
- Hand over: whoever holds an open step of a CRM-started run can pass it to another CRM (any
  branch) or a salesperson of the run's branch (`fms_crm_handover_candidates`,
  `handover_fms_step_with_audit`: audited, logged on the journey, old alert closed, new person
  notified). "CRM" and "Sales" use the CRM roster's department rule (`crm_department_choice`).
  Managers keep Reassign.
- Names: when nothing names the work, `fms_work_record_name` falls back to the CRM client's
  name, a written run title, then "Workflow — Step" (`fms_run_display_name`) instead of the FMS
  reference. Task cards never show the long reference; a generic title gets a short "#1234".

## Security

- No browser writes to either project for triggers; CRM and JewelOS keep separate homes.
- `crm_sync_apply_submission_event` is service role only; all internal functions are revoked.
- Builder/monitoring RPCs require `fms.manage` and `fms_builder` enabled; branch managers see
  their branch's events; answers in Inspect and samples need `crm.view` for CRM sources.
- Snapshots carry no phone, address or media. The work page shows copied values to people who
  can read the run; the CRM client id only to `crm.view`.
- Assignees are resolved through the roster grant (CRM user -> active JewelOS profile in the same
  tenant), never by name; an unresolved person goes to review (or the step's own strategy).

## Deploy order (owner-run, see PRODUCTION_SWITCH_PLAYBOOK.md)

1. JewelOS: confirm 0374 is still the next number on the production ledger, apply 0374, deploy
   `crm-sync-receive`.
2. CRM: apply 20261103000200, deploy `sync-deliver`.
3. Merge; Vercel deploys the builder.
4. Create and publish the Not Bought workflow in one branch first; watch Trigger history.

Order matters: a new `sync-deliver` before the new `crm-sync-receive` would get 400 for the new
kind and back off (no data loss; events stay queued). Rollback: pause or archive the automatic
workflow (events stop starting runs immediately); the migrations are additive.
