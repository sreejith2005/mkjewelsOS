# Recorder ingestion and processing

This service extends JewelOS; Supabase owns canonical session identity, consent,
permissions, receipts, jobs and transcript events. It has no service-role key,
legacy tables, public GPU connection, login UI or customer identity heuristic.
The pilot remains disabled until the owner completes activation gates.

## Run and verify locally

Use Python 3.14, create a virtual environment outside the checkout, and install
`python -m pip install -r services/recorder/requirements.lock`. From
`services/recorder`, run `python -m pytest -q`. Tests use real Uvicorn HTTP/HTTPS
and WS/WSS sockets, a generated locally trusted TLS certificate, synthetic SQLite
canonical transactions and private filesystem objects. These adapters live only
under tests and cannot be selected by the production entry point. They do not
prove deployed Supabase, AWS IAM/KMS, GPU inference or Android behaviour.

An additional opt-in test uses actual PostgreSQL recorder RPCs. Provision the
dedicated synthetic local container `jewelos-recorder-contract` with the current
canonical JewelOS schema and permission catalogue (schema-only, no customer
exports). Then, from this directory in PowerShell:

```powershell
$env:RECORDER_POSTGRES_CONTAINER='jewelos-recorder-contract'
python -m pytest -q tests/test_postgres.py
```

The test refuses a different container, copies schema/catalogue into a randomized
new database, applies the checked-in recording migration afresh, and removes only
that test database afterward. It exercises real HTTP/WebSocket ingestion against
canonical ticket/receipt/job/event RPCs, ACK-loss reconnect, partial audio, end
commit and provisional-to-final worker reconciliation. It uses a synthetic
processor, not real GPU inference. The transport-only TLS test separately checks
HTTPS/WSS. No linked/hosted database or shared development database is modified.

## Wire contract

PCM is non-overlapping mono 16-bit little endian at 16000 Hz. Normal chunks are
64000 bytes (2 seconds); every partial flush has a nonzero even byte count.
Sequence begins at zero. Context overlap belongs only in transcription, never
in canonical chunks. All five UUID fields are bound by the redeemed ticket:
`session_id`, `device_id`, `employee_id`, `branch_id`, `tenant_id`.

- HTTPS `POST /v1/connect`, JSON `{ticket}`. Return `ingest_token`, `expires_at`,
  `session`, `next_sequence`. Atomically redeem a single-use 60-second ticket
  through Edge. Ingestion keeps only a token hash plus scope for five minutes.
- HTTPS `POST /v1/chunks`, Bearer ingest token, JSON with all five UUID fields,
  `sequence`, lowercase raw PCM `sha256`, and base64 `data`. Preflight checks
  canonical scope/order/limits; conditionally persist encrypted private object;
  canonical chunk transaction inserts the receipt and provisional job. Only then
  return `{type:'ack',sequence,sha256,next_sequence}`. Lost ACK retries are safe.
- HTTPS `POST /v1/commit`, same Bearer, `{last_sequence}`. Lease determines scope;
  optional matching scope fields may be supplied. Empty stream is `-1`. Commit
  enqueues one final job only after contiguous durable receipts; repeats are safe.
- WSS `/v1/stream`: send `{type:'auth',ticket}` as the first text frame within
  five seconds. No audio is accepted first. Response `{type:'authenticated',...}`
  includes the same connection result. Then send chunk JSON plus `type:'chunk'`,
  or `{type:'commit',last_sequence}`. One operation/ACK at a time. No ticket/JWT
  in URLs, WebSocket subprotocol logs, cookies or query strings.

Refresh an expired lease with a new ticket for the **same durable session**.
Process restart intentionally loses transport leases, never canonical receipts.
An old identical chunk is acknowledged, a different hash conflicts, and gaps
fail. Clients retain encrypted unacknowledged chunks, retry in sequence, obey
429 / Retry-After and never infer that a timeout means a failed durable write.
Pause flushes partial audio and retains the session. Stop flushes every pending
chunk before commit (Saving -> Processing -> Ready/Needs attention).

Limits: 90000-byte JSON frames/body; 64000 decoded PCM bytes; 7200 sequences;
256 leases, 32 in-flight ingestion operations, 128 sockets, 20 connection
attempts/minute/IP with a bounded 1024-address window. Uvicorn bounds its receive
queue to two frames and total concurrency to 128. Reverse proxy/WAF must enforce
matching limits and IP rate rules across replicas; app limits are per process.
Do not run unrestricted public Uvicorn or trust arbitrary forwarded IP headers.
Operations time out after 20 seconds. A rejected/cancelled transfer is retried
by hash; an orphan from a write/receipt crash expires under the same retention.

## Production configuration and boundary

Required environment variables (inject from approved secret manager; never log):

| Variable | Meaning |
| --- | --- |
| `RECORDER_EDGE_URL` | HTTPS JewelOS `/functions/v1/recorder-ingest` |
| `RECORDER_BACKEND_SECRET` | Dedicated `x-recorder-secret`, same as Edge `RECORDER_INGEST_SECRET` |
| `RECORDER_BUCKET` | Private pilot audio bucket |
| `RECORDER_KMS_KEY_ARN` | Dedicated SSE-KMS key |
| `RECORDER_ORIGINS` | Comma-separated exact HTTPS JewelOS origins |
| `RECORDER_GPU_URL` | Optional explicitly enabled private HTTPS processor endpoint |
| `RECORDER_GPU_TOKEN` | Dedicated private processor credential, worker only |
| `RECORDER_GPU_HOSTS` | Exact private DNS hostname allowlist, worker only |
| `RECORDER_COACHING_ENABLED` | Optional worker critical signal producer; only exact `true` enables, plus tenant opt-in |

No JWT, Supabase service-role credential or AWS static key belongs on ingestion.
AWS uses its dedicated instance/task role. Secret rotation requires coordinated
Edge + backend replacement; existing upload clients need no broad credential.

`recorder-ingest` receives `{action,payload}` and its dedicated secret. Allowlisted
production actions used here are `redeem`, `check_chunk`, `chunk`, `commit`,
`claim_job`, `event`, `alert`, `finish_job`, `health`, `reconcile`. The Edge alone calls
narrow `recorder_ingest(text,jsonb)`; there is no arbitrary SQL/table adapter.
Worker claim returns `{job:null}` or `{job:{id,kind,sequence,lease_token,session,
chunks,last_sequence,...}}`. Finish includes job ID, worker UUID, lease token,
success and a fixed non-sensitive error code. No raw dependency error is stored.

Run ingestion behind TLS using `Caddyfile` and the Dockerfile command, or:

```text
python -m uvicorn production:app --factory --host 127.0.0.1 --port 8080 --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-access-log --ws-max-size 90000 --ws-max-queue 2 --limit-concurrency 128
```

Caddy must be in the same network namespace for the supplied loopback binding.
For separated containers, explicitly bind the private container interface and
trust only the proxy IP/CIDR; firewall 8080 from clients. Do not use `*` trusted
forwarders. TLS certificates/public DNS/load-balancing are deployment work,
not provisioned by the storage Terraform. No request/response body capture in
APM, proxy, traces or exception logs. Disable credential/header logging.

Run one bounded worker with `python production.py`. Scale by a measured number
of worker processes; PostgreSQL owns leases and only one job per session at a
time. GPU processing has a 100-second overall deadline, below the 120-second
job lease, and HTTP inference deadline 85 seconds. DB retry/backoff and five
attempt dead-letter limits are authoritative. The worker calls internal `reconcile`
at startup and every minute between bounded jobs to recover expired leases and
stale sessions through the same secret boundary. An independent minute scheduler
is still recommended when all workers are unavailable. Monitor queue pending age, pending/leased/dead
counts, upload failures, worker lease expiries and process readiness. Never log
audio, whole transcript, signed URLs, request bodies or credentials.

`/healthz` reports process liveness only. `/readyz` checks private object access,
canonical boundary, lease/inflight capacity and queue pending/dead counts; 503
requires attention. It does **not** prove a model is running or microphone
capture is occurring. Processing is unavailable without configured healthy
workers; do not activate the pilot before measuring worker health/capacity.
No stale ping is presented as "online" and no battery claim is made here.
Device health records `recent_upload`, `paused`, `stale`, `unknown` or
`needs_attention`; an upload receipt never proves the microphone is capturing.

## Private storage and retention

`infra/` defines a private bucket, blocked public ACL/policies, enforced TLS,
SSE-KMS and key policy conditions, exact recordings-prefix IAM and configurable
1..90-day lifecycle (pilot default seven days). Run Terraform fmt/validate/plan
with the owner before applying; this work does not apply infrastructure. Use
remote encrypted Terraform state and pin the reviewed provider lock on plan.
Existing business buckets should be imported/reviewed, never replaced blindly.

Objects are immutable conditional puts at
`recordings/{tenant}/{branch}/{employee}/{device}/{session}/{sequence}-{sha256}.pcm`.
S3 stores an actual SHA256 checksum and exact PCM format metadata. Canonical
metadata is in Supabase. Configure Supabase retention to match bucket lifecycle;
object expiration is asynchronous, so do not promise deletion at an exact time.
Only workers mint two-minute signed reads for exact canonical object keys. No
public playback route is implemented; a future playback feature requires an
authorized audited Edge grant, never accepting an arbitrary object key. Keep
bucket versioning off unless noncurrent-version expiration is also reviewed.

## Optional GPU protocol, incremental events and alerts

The processor implementation is `services/recorder-processor` (faster-whisper or
IndicConformer, pyannote speakers, `bench.py` for store-audio benchmarks). It also
returns `provider`, `model` and `diarization_provider`, which `PrivateGPU` passes
through to the transcript revision.

The GPU endpoint is a new verified **private** adapter, not legacy public Flask.
It must require the dedicated worker bearer on every call, use HTTPS, remain
reachable only from the worker network, disable body logging, restrict outbound
object reads to approved private S3 signed URLs, and never accept user names as
identity. Its request is `{job_id,session_id,kind,format,chunks}` where each chunk
includes sequence/hash/byte_count and a two-minute signed URL. Response:
`{segments:[{sequence,text,started_ms,ended_ms,critical_signal?}]}`. Every requested canonical
sequence must have a result (empty text is allowed for silence). Final jobs must
return every canonical chunk, reconciling earlier text by its sequence. Large
conversations that cannot finish within the job lease need a measured bounded
processor implementation before activation; do not increase deadlines beyond
leases or silently truncate.

Worker supplies at most the preceding canonical chunk as provisional model
context. The adapter must trim overlap text and align returned sequences to
original audio. Stable UUIDv5 segment IDs derived from session+sequence and
revision 1 provisional / revision 2 final make job retries idempotent. Final
replaces provisional, never appends duplicate segment IDs. Text is written only
through authenticated canonical event RPCs; the screen reads its scoped snapshot
at a throttled cadence. This service does not expose an anonymous transcript feed.

Manager coaching remains optional and disabled by server configuration. The
canonical alert action validates final evidence, opt-in, deduplication and a
60-second per-session limit; manager+coach permission filters consumers. This
worker emits alerts only when `RECORDER_COACHING_ENABLED=true`, the tenant opts in,
and the complete final result has persisted. The optional provider `critical_signal`
must contain `code` (`critical_compliance` or `critical_customer_safety`), numeric
`confidence` between 0.99 and 1, `unambiguous:true`, and `evidence_text` exactly equal
to the full trimmed segment text (at least 20 characters). Missing, uncertain,
ungrounded, provisional or incomplete results produce no alert. SQL independently
requires the active final-job lease and final canonical segment. No business score
or sale outcome is inferred. Validate the private provider's evidence behavior
with the owner before enabling either coaching switch.

## Finalized transcript revisions (migration 0379)

With `RECORDER_FINALIZE_TRANSCRIPTS=true` the final job also calls
`transcript_finalize`, creating an immutable machine revision
(`recording_transcript_revisions/segments`). Leave it unset until migration 0379
and the matching `recorder-ingest` are deployed; otherwise final jobs would fail.

Processors may return `{segments, provider, model, diarization_provider}`
instead of a bare list (`contracts/processor_response.schema.json`). A chunk
segment may carry `utterances` with `offset_ms`/`end_offset_ms` relative to the
chunk where the utterance starts, original-language `text`, readable
`display_text` (Roman-script Hinglish or English, no academic
transliteration), optional `translation_en`, `language`, STT `confidence`,
`speaker_role` + `speaker_confidence`, and `includes_context` when the text may
repeat the previous chunk tail (the worker then removes the repeated words).
Chunk-level `text` is still required for the live display. An utterance that
runs into later chunks stays anchored to its first chunk; the later chunks
return empty text.

Speakers are `employee`/`customer` only at diarization confidence ≥ 0.85;
otherwise `unknown`. The worker never picks the employee by speaking time.
Benchmark diarization on store audio before trusting any labels; managers can
correct speakers through a correction revision.

## Analysis worker (Store Intelligence)

A separate process: `python production.py analysis`. It claims
`recording_analysis_jobs`, sends one redacted prompt (`prompts.py`,
`PROMPT_VERSION`) to a private analyzer, validates the JSON
(`contracts/analysis_model_response.schema.json`, evidence quotes, rubric keys,
SOP clause IDs, HIGH-finding speaker rule), retries with up to two repair
prompts, and submits. The database computes the score and status. Fewer than 25
words or 2 spoken segments never reaches a model.

| Variable | Meaning |
|---|---|
| `RECORDER_EDGE_URL`, `RECORDER_BACKEND_SECRET` | Same boundary as the recorder worker. |
| `RECORDER_ANALYZER_URL`, `_TOKEN`, `_HOSTS`, `_PROVIDER`, `_MODEL` | Required private analyzer. Request `{system,user,response_format:'json',temperature:0}`, response `{content}`. Provider/model labels are stored on each analysis. |
| `RECORDER_ANALYZER_FALLBACK_*` | Optional second analyzer, same variables. Its use is stored (`fallback_used`, `fallback_reason`) and forces manager review. |
| `RECORDER_ANALYSIS_JOB_VERSIONS` | Comma list the worker accepts (default `mk-sales-v1`). Unknown versions dead-letter instead of running with the current prompt. |

Errors are fixed codes; nothing logs transcript, quote, prompt or model text.
The analyzer must not retain prompts (configure zero retention with any vendor).

Evaluation: `python -m evaluation.run_eval analysis --repeats 3 --out report.json`
(same analyzer variables) reports score spread across repeats and noisy variants,
agreement with human labels, signal precision/recall and failure examples.
`python -m evaluation.run_eval wer --pairs pairs.jsonl` reports STT WER/CER by
language and noise. Bundled fixtures are synthetic Hindi/Hinglish and English;
real store audio, Marathi and Gujarati sets are owner-provided, kept outside Git,
and must be measured before being called production quality.

## Pilot measurement and device gates

No p50/p95 number is claimed by this implementation. Measure on the actual
pilot deployment and devices. Use synthetic consented scripts and record only
segment UUID, sequence, monotonic capture-end, durable ACK and provisional/final
arrival timestamps (no text/audio/tokens in metrics). With client clock only,
`provisional_arrival - audio_chunk_end` includes capture batching, upload, queue,
model and authenticated event polling. Report p50/p95, sample count, failures,
max queue depth, polling interval, phone/network class, model version, cold/warm
start and concurrency. Measure at least 100 chunks each for 1/3/5 simultaneous
sessions, warm/cold model and induced 5/30/120-second disconnects. Report failed
or missing provisional segments separately; do not omit them to improve percentiles.
Acceptance lag thresholds require owner agreement after these measurements.

Use the existing Android shell's device matrix: deliberate start while visible,
mic/notification denial, screen lock, Home, phone call, battery saver, network
loss/resume, app process kill/relaunch, notification Stop, repeated ticket renewal,
64-MiB queue full, pause partial flush and final stop. Compare manifest checksums
and canonical sequence count before/after recovery. Restart ingestion and worker
between ACK/object/receipt boundaries. Confirm the same durable session survives
and no duplicate audio/text appears. Browser closure cannot guarantee continued
capture; test browser unsupported/permission/network states independently.

Release only after Supabase authorization tests, staged AWS/IAM/TLS processing,
web tests and physical Android proof. Native release uses only the documented
`scripts/release-mobile.ps1` after all gates. Nothing here deploys or publishes.
