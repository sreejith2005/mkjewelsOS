# Reports (Business Reports 2.0)

Introduced 2026-11-02 (JewelOS migration `0370_business_reports.sql`, CRM migration
`20261102000100_crm_business_reports.sql`). This file is the reference for what each
report reads and how every count is calculated. Keep it in step with the code.

**2026-11-20 (owner):** the seven reports that read the old CRM project (Customer Master
Database, Customer 360° Journey, Leads and Enquiries, CRM Follow-ups, Lead Source and
Conversion, CRM Performance, Salesperson Performance), the "Customer & CRM" category and the
CRM synchronization exceptions export were removed with the old CRM screens. Customer reports
on the customer master database (`customer` schema) come with the next customer work. Their
formulas are in Git history before this date.

## How it fits together

- One page, `/reports` (`apps/web/src/features/reports/ReportsView.tsx`). The catalogue,
  columns, filters and formula notes live in `packages/core/src/reports/catalog.ts`.
- **JewelOS reports** are rows from `report_rows_for_profile` (preview via
  `get_report_data`, export via `request_report_export_with_audit`). Older report keys
  still run in `report_rows_for_profile_v1`, unchanged.
- **One export queue**: every CSV goes through `export_logs`, the private `report-exports`
  bucket, signed 60-second download links, retention and retry. "Your exports" lists them.
- **CSV rules** (`packages/core/src/reports/csv.ts`): UTF-8 with BOM; labelled headers;
  date-times in Asia/Kolkata as `YYYY-MM-DD HH:mm` with "(IST)" in the header; phones
  written as `="+91 9876543210"` so Excel and Google Sheets keep them as text; any other
  value that starts with `= + - @` is prefixed with `'` (formula-injection guard).

## Catalogue and sources

| Category | Report | Key | Source |
|---|---|---|---|
| Forms, FMS & Tasks | All Form Submissions | `form_answers` | JewelOS `form_submissions` (answers + saved `template_snapshot`), linked FMS visit or task |
| | FMS Workflow Journey · Workflow summary | `fms_workflow_summary` | `fms_instances`, `fms_instance_stages`, `fms_instance_outcomes` |
| | FMS Workflow Journey · Stage-wise detail | `fms_stage_visits` | `fms_instance_stages`, `fms_visit_transitions`, the visit's `form_submissions` |
| | FMS Stage Performance | `fms_stage_performance` | `fms_instance_stages` grouped by workflow family and stage key |
| | Pending and Completed Tasks | `work_register` | `task_instances` + `task_assignees`, and FMS stage visits |
| Employee Performance | Employee Task Performance | `employee_task_performance` | `task_instances`/`task_assignees` and FMS stage visits |
| | Employee Availability | `people_availability` | `user_availability` (existing report; leave reasons are never shown) |

Moved out of the business list: Notification delivery health is in **Settings → Report
diagnostics** (administrators). Earlier
report keys (`task_operations`, `task_completion_delay`, `fms_instances_stages`,
`fms_sla`, `form_submissions_reviews`, `people_task_performance`) still work on the server,
keep their past exports downloadable, and stay available to Ask Kiara.

## Definitions and formulas

**Purchase and sale.** A verified purchase is a recorded visit where
`crm_private.walkin_purchase_evidence` is true (saved outcome YES / YES_AND_ORDER_PLACED /
…_AND_BUYING_NEW_PRODUCT, or a saved visit form saying the customer bought). A store visit,
a price check, or a completed FMS negotiation step is never a sale.

**Store Intelligence conversations (migration 0384).** A recorded conversation linked to a
CRM customer appears in the customer's history (`crm_client_activity`, source
`crm_store_conversations`, kind `STORE_CONVERSATION`), so it is in Customer 360° Journey. It is
never a purchase and never a contact. Store Intelligence's "Purchase confirmed in CRM" uses the
purchase rule above, for visits from the recording's India day through the attribution window
(30 days by default); one purchase visit is credited once. The CRM records no sale amounts, so
there is no verified revenue; an estimate (confirmed purchases × configured average ticket) is
shown only in Store Intelligence and always labelled Estimated.

**Store Intelligence analytics (migration 0389).** Store Intelligence › Insights, for managers with
*Review branch recordings*. It is not a report key and has no export.
- Source: `recording_session_facts`, one row per recorded conversation, kept current by a queue
  (`recording_fact_queue`) that triggers fill and every read drains (at most 2,000 rows per read).
  The page shows when figures were taken and what is still being counted, transcribed or waiting
  for AI review. The summary is fetched once per filter combination; drill-downs are keyset pages
  of 25 (`recording_analytics_sessions`, metadata only: no summary, transcript, audio or customer).
- Scope: own branch; every branch with `recording.analytics_all_branches` (default Super Admin and
  Admin). Another branch's conversation is listed but cannot be opened from analytics.
- Period: India business days (Asia/Kolkata), inclusive, at most 366 days. Today, This week (from
  Monday), This month (from the 1st) or Custom. The prior period is the same number of days
  immediately before.
- Conversations = recordings started in the period. Customers are never counted from transcript
  chunks or messages.
- Average score = sum of effective scores (manager edit, else AI) ÷ scored conversations. Analysed
  but unscored, not yet analysed, and **removed after retention** (past expiry; their analysis is
  deleted by the 0379 retention rule) are counted separately, never as 0.
- Average length = saved audio ÷ conversations with audio.
- CRM outcome per conversation (0384 rules): *Confirmed* (credited purchase visit; one visit, one
  conversation), *Credited to a later conversation*, *Lost* (verified link, CRM checked, attribution
  window closed, no purchase), *Window still open*, *Waiting for CRM* (link not yet verified or
  not checked) and *No customer linked*. **Eligible** = confirmed + credited elsewhere + lost +
  open. **Confirmed conversion** = confirmed ÷ eligible. Not linked is unknown, not lost.
- Stages need quoted transcript evidence: *Engaged* = analysed without "too little speech";
  *Interest* = engaged with an evidenced product interest; *Price discussed* = interest with an
  evidenced budget or price concern; *Confirmed converted* = engaged and CRM-confirmed (not nested
  under Price). Drop-off = previous stage − stage.
- Product type and metal/design come from fixed keyword rules on the product words
  (`recording_product_categories`, `recording_product_elements`); price band from the evidenced
  budget (`recording_price_band`, a bare number under ₹1,000 gives no band). Personal traits are
  never inferred; CRM demographics are not shared with recordings.
- Minimum sample 5: averages, rates, ranks and tiers below it show "Too few"; no denominator shows
  "No data". Tiers: Strong 80+, Good 60–79, Needs coaching under 60.
- Score vs conversion: Pearson r per conversation (score against confirmed 0/1, eligible and
  scored) and per person (5+ scored and 5+ eligible), with N. Correlation is not causation.
- Verified revenue: none (the CRM records no amounts). Estimated revenue = confirmed × configured
  average ticket. **Opportunity at risk** (hypothetical benchmark) = conversations with evidenced
  interest, a linked customer and no CRM purchase × confirmed conversion × average ticket; shown
  only with a ticket and 5+ eligible.
- Connected time (Device time) = sum of gaps of at most 2 minutes between a phone's contacts, by
  India day, logged from 0389 onward (`recorder_device_days`). Battery is not transmitted.
- Branch priorities are rules in `siBranchActions` (`@jewelos/core`): interrupted recordings,
  5+ waiting reviews, average score under 60, conversion 10+ points under the branches shown,
  interested customers without a purchase, half or more conversations without a linked customer.

**FMS.** Rows come only from steps that actually ran. A repeated stage is a new row with
its visit number. Skipped and stopped steps keep those statuses. *Timing*: on time when
completed at or before the planned time; delayed after it; overdue when open past it.
*Final outcome* is shown on the visit that routed to the End step. Stage-wise answers are
shown to managers and admins, and to the person who submitted them.

**Pending and Completed Tasks.** Due = revised deadline when set, else planned time.
Delay = completed time − due. FMS steps without a deadline are not due work.

**Employee Task Performance** (work due in the period).
- Assigned = tasks and FMS steps due in the period where the person is a current
  (active) assignee. Shared work counts once for each assignee.
- Completed / Pending (open, not yet due) / Overdue (open, past due).
- On-time completed = completed at or before due; Delayed completed = after due.
- Completion % = completed ÷ assigned. On-time % = on-time ÷ completed.
- Average delay = mean minutes late over delayed completions only.
- Reassigned work counts for the current assignee; each recurring occurrence is one task;
  reopened work counts by its current state. Rejected tasks, skipped/stopped FMS steps and
  FMS steps without a deadline are excluded. Source records and audit history are not
  changed.
- Since migration 0382 the rows come from `performance_work_rows_v1`, the one source the
  Dashboard's **Employee performance**, Task Control's employee progress
  (`get_employee_task_progress`) and this report share, so the same person, scope and
  period give the same counts and scores everywhere (see "Employee task performance" below).

**Employee task performance (Dashboard, Task Control, this report — migration 0382).**
- One row = one active doer (`task_assignees.role_at_task = 'doer'`, `is_active`) on one task
  occurrence, or one assignee in `fms_instance_stages.assigned_to` on one FMS **person step**
  visit (`form`, `task`, `approval`). End, branch, notification and parallel nodes are never work.
- Cohort: deadline in the period, in India time. Tasks: `coalesce(revised, due, planned)`
  (= `task_effective_due_datetime`). FMS: the visit's `planned_datetime`.
- Every cohort row is in exactly one bucket: **on time** (completed at or before the
  deadline), **late**, **completed with no completion time** (counts as completed, never on
  time), **in progress** (`in_progress`/`in_review`, not yet due), **pending** (any other open
  status, not yet due), **overdue** (open, deadline passed). Completed + remaining = assigned.
- **Excluded** (counted and listed, never scored): rejected tasks/steps, skipped
  (`condition_skipped`) and stopped (`workflow_closed`) FMS visits, open steps of cancelled runs.
- **Work not done %** = completed ÷ assigned × 100 − 100; **Work not done on time %** = on time ÷
  completed × 100 − 100; assigned 0 → No data; nothing completed → −100. Calculated only by
  `taskPendingScore` / `taskDelayedScore` in `@jewelos/core`.
- Shown beside the cohort, never inside it: open work whose deadline passed before the period
  (current backlog), and pending FMS start forms (standing assignments with no occurrence history).
- People are filtered by their current branch and department. Company-wide view needs the
  `dashboard.view_team_performance` permission (default Super Admin and Admin); everyone else sees
  only their own work. Every count opens `get_task_performance_records_v1` with the same filter.

## Access

- Report roles and row scope are enforced in the database (`report_allowed_for_role`,
  `reporting_context_for_actor`, per-report scope). Admins see the company, managers their
  branch, others their own work. HR sees employee performance and availability, not form
  answers. The page only hides what the server would refuse.
- Every queued export re-checks the requester when it runs (`reports.view` +
  `reports.export`, active login), not only when it was requested.
- Franchise isolation (0387, inert while off): rows are limited to the viewer's franchise
  or stores before any count or total, so a Mumbai Director never sees Ahmedabad rows and
  a cross-location task is counted once. Directors, HR and Store Managers report across
  their scope; store and person filters outside it are refused. A queued export runs with
  the requester's scope, never company-wide and never empty for lack of a signed-in person.
  CRM customer data stays company-wide (owner decision 2026-11-06).
- Form answers come from the saved submission snapshot; hidden-by-condition answers export
  blank; attachments export file names only (never a storage path or signed URL).
