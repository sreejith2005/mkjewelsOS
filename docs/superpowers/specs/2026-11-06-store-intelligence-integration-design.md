# Store Intelligence integration: CRM customer, outcomes, follow-ups

Owner request 2026-11-06. JewelOS migration `0384_store_intelligence_integration.sql`,
CRM migration `20261106000200_crm_store_conversations.sql`. Builds on the recorder
(0377), analysis (0379), playback (0381) and workspace (0383) layers and on the
two-project CRM design (2026-10-01) and the customer outbox (0354/0356, CRM 20261027).

## Boundaries

- The CRM project stays the customer home. JewelOS stores only: the chosen CRM
  identifiers (`target_kind`, `target_id`, and the CRM-acknowledged `crm_client_id`),
  how they were matched (`match_basis`, `candidate_count`), a minimal display cache
  (code, name) with its source (`crm_search` / `walkin_task` / `crm_ack`) and expiry
  (7 days unconfirmed, 30 days after acknowledgement), and delivery state.
- Audio, transcripts, scores and AI text never leave JewelOS. The CRM payload has a
  fixed key allowlist (no transcript, summary or answers) checked on both sides.
- Nothing claims "synced" or "confirmed" without the CRM's answer.

## Customer link

1. The browser searches the CRM through the existing login bridge
   (`crm_store_conversation_candidates`, as the CRM user; active CRM users only).
   Exact identifiers only: `MKC-` client code, `MKREF-` visit reference, or a full phone
   number normalised with the CRM's own `phone_key`. Names are never searched. Every
   client on that phone is returned (families share numbers); an unconverted lead is
   offered only when no client holds the number. Nothing is created or merged.
2. A person chooses one candidate. `recording_link_crm_customer` (salesperson or branch
   reviewer, with `crm.view`) stores a **pending** link, idempotent on the request key,
   and queues `store_conversation.linked` in `crm_sync.recording_events`. Audited.
3. `crm-customer-sync` (existing cron, secret and endpoint) delivers it to CRM
   `sync-receive` → `crm_apply_store_conversation_event`. The CRM checks the source
   tenant is approved (existing `customer_sources`), the JewelOS actor is an active CRM
   user of that tenant, and the target exists; then writes an immutable
   `crm_store_conversations` row that `crm_client_activity` shows as a read-only
   **Store conversation** with a JewelOS path. It answers `accepted` (with its own
   client id, code and name), `rejected` (fixed reason), `retry`, or
   `source_unapproved`.
4. `crm_sync_finish_recording_event` records the answer: accepted → link **verified**
   and display replaced by the CRM's; rejected → link **rejected**; source unapproved →
   **held** and retried hourly (never dead); errors → backoff, **failed** after 10
   attempts with an audited **Send again**.
5. Correction needs a reason: the old link ends (`corrected`), its `unlinked` event goes
   first (the claim holds later events for the same conversation), then the new link.
   Unlink also needs a reason. Links and CRM rows are append-only; the CRM row can only
   be withdrawn once.
6. The earlier walk-in picker (`recorder_link_customer`) now also creates a link, so its
   CRM entry and outcome checks follow; its own checks are unchanged.

## Outcomes

- **AI-suggested** intent comes from the analysis (`sales_outcome`): Converted /
  Not converted / Follow up / Unknown, always labelled "(AI-suggested)".
- **CRM-confirmed**: for verified links the sender asks
  `crm_store_conversation_outcomes` for the first visit in
  `[start of the recording's India day, + attribution days)` where
  `crm_private.walkin_purchase_evidence` is true (docs/REPORTS.md). Re-checked every 6
  hours until the window closes (+1 day). Stored in `recording_crm_outcomes` with the
  check time.
- Deduplication: a purchase visit is credited to the latest live, verified
  conversation that started on or before it; others show "credited to a later
  conversation". Insights count distinct purchase visits.
- States: Pending CRM confirmation (no link, link pending/refused, not checked yet),
  Purchase confirmed in CRM, No purchase in CRM yet, No purchase recorded in CRM
  (window closed).
- Revenue: the CRM records no sale amounts, so **verified revenue is always empty**.
  Estimated = CRM-confirmed purchase visits × configured average ticket
  (`recorder_config.estimated_ticket_inr`, blank by default; Admin/Super Admin,
  audited). Always labelled Estimated with its formula.

## Follow-ups

`recording_create_follow_up` (review first; same release rule as 0383):

- One piece of work per suggestion per conversation: `action_key` =
  md5 of the normalised action text, unique per session, checked against the 0383
  `recording_action_tasks` too, under one advisory lock shared with the 0383 button.
  Retries replay the request key; rescores and the older button find the same work.
- Task path: `create_manual_task_with_mode_with_audit` (existing authoring and
  assignment rules, assignment notifications); optional coaching reminder = a branch
  manager as watcher (not the creator: In Loop watchers cannot edit).
- FMS path only when the person picks a published **manual-start** flow:
  `start_fms_manual_with_audit` with idempotency key
  `md5('recording-follow-up:'||session||':'||action_key)::uuid`; no form submission is
  created; triggered flows keep their real trigger conditions.
- Due: chosen India day + First half (15:00) / Second half (21:00), or
  `day_half_deadline(now())`. The 0383 exact-time path stays for the older button.
- Recommended method (call / WhatsApp / visit / other) is text in the task; nothing is
  sent to the customer. The source analysis and transcript never change; the task
  description carries the evidence path and CRM customer.

## Readiness

`recording_session_integration` returns four lines per conversation (client match, CRM
activity sync, task/FMS, notification outcome from the in-app `notifications` rows or
the provider event queue). `recording_integration_health` gives branch counts to
reviewers. No customer details in either beyond the linked name/code.

## Ask Kiara

No new tool. Recording, customer-link and outcome data stay outside Kiara; follow-up
tasks are ordinary Tasks that Kiara's existing task tools already read under Tasks
authorization. Help content updated in `appHelp.ts` and the review doc.

## Validation (local)

pgTAP: `supabase/tests/0384_store_intelligence_integration.test.sql`,
`supabase-crm/supabase/tests/20261106_crm_store_conversations.test.sql`; Deno:
`crm-customer-sync/recording.test.ts`, `sync-receive/recording.test.ts`; Vitest: core
`salesScore/integration.test.ts`, CRM UI journey tests, web Store Intelligence tests.
Hosted delivery, the cron, and production CRM approval are separate gates.
