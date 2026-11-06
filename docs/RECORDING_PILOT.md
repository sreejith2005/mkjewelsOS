# Sales Recording pilot

Sales Recording extends the JewelOS web app and its one Android WebView. The
pilot is disabled until an owner configures the server allowlists and verified
ingestion/worker. No new login, customer database or native navigation is added.

## Authorization and activation

Apply the forward recording migration only through
`PRODUCTION_SWITCH_PLAYBOOK.md`, after checking current `origin/main`, the exact
JewelOS ledger and linked dry-run. Deploy only `recorder-session` and
`recorder-ingest`. This feature does not migrate the separate CRM project.

`module.sales_recording` opens the section. `recording.capture` is an explicit
grant, with no role default; capture also requires active employment, the actor's
current tenant/branch, versioned recording consent and the pilot allowlist.
`recording.review` and `recording.coach` additionally require manager authority
and the same branch. Use the existing permission editor; hiding a page grants
no authorization. Kiara receives app-help text only, no transcript/audio tool.

`recorder_configure(p_enabled,p_employee_ids,p_branch_ids,p_retention_days,
p_coaching_enabled)` is an audited owner RPC protected by
`developer_mode.manage`. Keep it disabled while provisioning. Set selected
active employees and branches only after staged authorization, storage,
processing and retention checks. Disabling new capture does not erase history.

Edge server configuration:

- `RECORDER_UPLOAD_URL`: exact HTTPS ingestion origin, without path/query.
- `RECORDER_STREAM_URL`: exact WSS ingestion origin, without path/query.
- `RECORDER_ALLOWED_ORIGINS`: exact comma-separated HTTPS web origins.
- `RECORDER_INGEST_SECRET`: backend-only shared boundary secret, same value as
  ingestion's `RECORDER_BACKEND_SECRET`; configure through secret management.

See `services/recorder/README.md` for AWS instance-role/S3/KMS/TLS/queue limits,
worker deployment, optional private GPU adapter and alert signal contract. AWS
never receives a Supabase service-role key. The Edge worker exposes only narrow
recorder RPC actions; credentials are never browser configuration or URL fields.
Start the real configured processor/worker before enabling capture. Ingestion
readiness alone does not prove GPU availability, latency or model correctness.

## Capture and recovery

Normal chunks are two seconds of mono PCM16 little endian at 16 kHz. Every chunk
has an immutable session/device/employee/branch/tenant scope, sequence and SHA-256.
Canonical audio does not overlap; the processor alone adds model context.
The server ACK follows private object persistence and the canonical receipt.
Clients remove local bytes only after validating that ACK. Lost ACKs replay the
same bytes/sequence; conflicting hashes and gaps fail closed.

Pause flushes a partial chunk, stops microphone capture and leaves the same
conversation open. Resume is deliberate and retains its durable session ID.
Stop ends capture, flushes the tail and enters **Saving**. A contiguous,
idempotent end-of-stream commit moves it to **Processing**. A final job reconciles
stable segment IDs to **Ready**; exhausted retries or interrupted capture becomes
**Needs attention**. A lost commit ACK can be recovered with another narrowly
scoped ticket even after canonical processing finishes. New audio for a sealed
session remains forbidden.

There is one open session per registered device. Pilot devices are bound to
their employee/tenant/branch; moving a recorder to another employee/branch needs
an explicit reviewed registration decision. An unknown start response keeps its
request UUID in browser storage so a retry returns the same conversation.
Known open sessions on this device are reused. Recording needs no customer.
Optional linking accepts only authorized, already-synced CRM walk-ins verified
against canonical task provenance; arbitrary customer UUIDs are refused.

The browser uses AudioWorklet and an AES-GCM IndexedDB queue with a non-extractable
key. The native service uses private Android Keystore AES-GCM files and an atomic
manifest. Both have a 64 MiB unacknowledged queue bound and four-hour pilot limit;
capture pauses before capacity exhaustion. Unacknowledged audio is not evicted.
After a crash, open the same account/device, inspect the interruption, and
deliberately Resume or Stop. Credentials are memory-only, so native recovery may
need JewelOS open to renew a ticket. Do not clear browser/app data or uninstall
before queued audio is saved. An abrupt process/device failure can interrupt the
current unflushed hardware buffer; recovery must remain marked interrupted.

Web capture depends on browser background support and does not continue after
closing a tab. Native capture starts only after a deliberate action with the
activity visible and permission granted, then uses a persistent foreground
notification with Stop. Native code compiles separately from web code; a web
deploy cannot install a new foreground service into an older APK.

Device health means recent upload or a reported recorder state. A stale ping is
labelled stale, not proof that the microphone is active or the phone is online.
Battery reporting is omitted. Health/error logs contain fixed codes and bounded
metadata, never audio, complete transcripts, tickets or provider credentials.

## Transcript, coaching and retention

The active screen polls an authenticated, permission-filtered snapshot at a
throttled cadence. Snippets are labelled Provisional. Stable segment IDs and
monotonic revisions prevent duplication; final text supersedes provisional text.
Optional coaching requires both tenant and worker opt-in, complete final context,
supported critical codes, at least 99% provider confidence and exact canonical
evidence. Ambiguous/provisional/ungrounded output produces no alert. The server
deduplicates and rate-limits alerts; only authorized managers receive them.

Audio is private S3 SSE-KMS data, with exact scoped object keys and short signed
worker reads. No public playback endpoint is added. Configure matching bucket
lifecycle and canonical retention (default seven days, configurable 1–90).
Lifecycle expiration is asynchronous. Worker reconciliation expires transcript/
alert content, releases expired interrupted device slots and recovers expired
job leases. Job retries back off and dead-letter after five attempts.

## Store Intelligence analysis and MK Sales Score (migration 0379)

Design: `docs/superpowers/specs/2026-11-05-store-intelligence-processing-design.md`.
Dark until **Turn analysis on** in **Sales score settings** (Developer Mode
authority; `recording_configure_analysis`) and the analysis worker runs. On the
conversation screen a Ready recording shows the score, evidence, review actions
and transcript corrections; migration 0380 adds the read-only settings call.
Evidence plays the moment for managers (0381).

- Final transcripts become immutable revisions with speaker, offsets, language,
  display/translation text and STT confidence. Manager corrections
  (`recording_correct_transcript`) create new revisions; the original stays.
- Each analysis pins transcript revision, rubric version, SOP version,
  `job_version`, model and prompt version. The server computes the 0–100 score
  over assessed dimensions only; too little evidence gives no score, doubtful
  audio, unknown speakers, a fallback model or a HIGH SOP finding give
  **needs review**.
- Managers with `recording.review` in the branch approve, flag, comment or edit
  (`recording_review_analysis`); edits are separate rows with a reviewed total,
  never a rewrite. The recorded employee sees only approved or edited analyses.
- `recording_request_rescore` and `recording_request_reprocess` are explicit and
  audited; earlier analyses stay. `recording.manage_rubric` (Super Admin, Admin)
  creates rubric and SOP versions; an SOP needs a second approver unless the
  Super Admin approves.
- Retention removes transcript revisions, analyses and reviews with the
  recording. Rubric and SOP versions are kept.
- AI output is a recommendation. Nothing writes CRM, marks a purchase or changes
  reports. Ask Kiara has no access to transcripts or scores.

Evidence playback (0381): managers who can review hear the moment behind an
evidence button or **Play** beside a transcript line. Each listen is a single-use
grant written to the audit log (`recording_audio_played`); the recorded employee
cannot pull audio, and nothing plays after retention. It needs 0381, both
`recorder-session` and `recorder-ingest` redeployed, and the recorder service
image that has `POST /v1/playback`.

Enable order: apply 0379, deploy `recorder-ingest`, set
`RECORDER_FINALIZE_TRANSCRIPTS=true` on the recorder worker, load and approve an
SOP version, start the analysis worker, run the evaluation report with the chosen
analyzer, then enable analysis for the pilot tenant.

## Store Intelligence workspace (migration 0383)

The menu entry is now **Store Intelligence** (same page id `sales_recording` and
path `/sales-recording`). Screens: Today, the recording flow
(`/sales-recording/record`), Conversations and a conversation's Summary /
Transcript / Coaching / Actions tabs (`/sales-recording/conversations/<id>?tab=`),
and for managers Coaching, Insights, Devices; Settings for managers and admins.
0383 adds read-only, branch-scoped functions behind them
(`recording_today`, `recording_conversations_page`, `recording_conversation_card`,
`recording_devices_page`, `recording_insights`, `recording_coaching_lists`,
`recording_workspace_settings`, `recording_session_action_tasks`) that reuse
`recorder_can_read` and the 0379 rule that employees see only approved or edited
analyses. The one write, `recording_create_action_task`, turns a suggested next
action into a checklist task for the recorded employee through
`create_manual_task_with_mode_with_audit` and records the link in
`recording_action_tasks` (unique per analysis and action, so a second tap returns
the same task); it is audited as `recording_action_task_created`.

Outcomes shown are what the conversation said, never a CRM sale: walk-in linking
records only the queue reference, and the CRM purchase result is not synced to
JewelOS. Device status is from heartbeats only; battery and location are not
collected. The conversation player reuses the 0381 audited one-minute windows and
asks for the next window when one ends.
## Validation and release gates

Focused commands, from the repository root:

```powershell
pnpm.cmd --filter @jewelos/core exec vitest run src/recording.test.ts src/permissions/catalog.migration.test.ts
pnpm.cmd --filter web exec vitest run src/features/recording src/features/storeIntelligence
deno test supabase/functions/_shared/recorder/boundary.test.ts
```

Run `python -m pytest -q` from `services/recorder` in an isolated environment
installed from its lockfile. The optional real-Postgres test requires the
dedicated synthetic Docker database described in that test; it refuses a
different container and creates/drops only randomized isolated test databases.
It exercises real HTTP/WebSocket transport against canonical recorder RPCs,
partial PCM, replay after ACK loss, end commit, leased jobs and final replacement.
This is separate from deployed Edge JWT, IAM/KMS and real GPU evidence.

Run the recording pgTAP file on a dedicated local database with current schema,
then full repository tests, typecheck, build and whitespace checks. Complete
desktop and phone-width browser QA with unsupported/denied, consent, red state,
meter, pause/resume, network/reconnect, history selection during capture and Stop.
Synthetic mocked browser APIs prove rendered/client behaviour, not hosted auth.

Physical interruption steps are maintained in `apps/mobile/README.md`: visible
start, permission denial, Home, screen lock, calls, battery saver, lost internet,
lease expiry, kill/relaunch, notification Stop, partial flush and queue full.
Without a connected phone these are unverified; compilation is not device proof.
Native updates use only `scripts/release-mobile.ps1` after its documented gates.
Never hand-build or publish a replacement public APK to bypass them.

Pilot p50/p95 lag is unmeasured until the real deployment runs. Follow the
measurement matrix in the ingestion README (1/3/5 sessions, warm/cold workers,
disconnects, at least 100 chunks per case); record missing events and failures
alongside percentiles. Do not promise zero latency or invent pilot numbers.

Owner staging checklist: consent/permissions and cross-branch denial; same-session
reconnect and ACK replay; final partial/notification Stop; provisional-to-final
replacement; dead-letter/readiness/retention alarms; optional walk-in and coaching
authorization; mobile layout and native interruption matrix. Merge, hosted
migration/function/web deployment and signed APK publication are distinct gates.
