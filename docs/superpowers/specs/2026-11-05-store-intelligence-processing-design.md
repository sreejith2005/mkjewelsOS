# Store Intelligence processing and MK Sales Score

Owner decision 2026-11-05 (chat): build processing on the merged Sales Recording
pipeline (`recorder_*`, migration 0377, `services/recorder`). That pipeline stays
the only capture, audio, chunk and transcription-job system. The unmerged
`feat/store-intelligence` branch (`C:\jsi`) is not shipped: its sessions, chunks
and jobs would duplicate the recorder. Its good ideas (rubric versions, score
dimensions with `insufficient_data`/`not_applicable`, suggested-only outcomes,
append-only coaching) are carried into this layer.

Phase 1 (this change) is backend only: schema, server contracts, shared scoring
rules, worker analysis stage and the evaluation harness. The manager review
screen, live real-audio benchmarks and SOP content loading are later phases.

## What the legacy pipeline taught us

Kept from `mk-jewels-store-sales` (studied, not imported):

- Streaming partial capture with prepended audio context; trailing-word overlap
  removal (`strip_transcript_overlap`, at most 12 words) when a processor says its
  text includes that context.
- Raw original-language text, a readable Hinglish display line (Roman script, no
  academic transliteration) and optional English translation as separate fields.
- Conservative classification rules from `qwen3_triage.py`: asking the price or
  making charges is not a price objection; an objection needs clear resistance;
  short or garbled fragments yield no signal; a different but working sales style
  is not an SOP failure; closing off-script is positive; HIGH only for a concrete
  factual contradiction of the supplied knowledge.
- Structured JSON output, schema validation, bounded retries, and an
  insufficient-data result instead of guessed scores (fewer than 25 words or two
  lines).

Dropped: identity by salesperson name or PIN, `dominant_speaker()` treating the
longest speaker as the employee, logging raw transcripts and model responses,
silent fallback to another provider, 0–10 scores for every dimension regardless
of evidence, a customer-satisfaction guess, a local SQLite store.

## Data model (migration 0379)

All tables are in the JewelOS project, RLS-enabled, with no direct client or
service-role table writes. Writes go through audited `security definer` RPCs.

| Table | Purpose |
|---|---|
| `recording_transcript_revisions` | Immutable revisions. `machine` revisions come from the final transcription job; `manual_correction` revisions name their base, author and reason. |
| `recording_transcript_segments` | Immutable segment rows per revision. Stable `segment_id` across revisions, session `start_ms`/`end_ms`, `source_sequence` + `source_offset_ms` into the canonical audio chunk, speaker + confidence + source, language, `raw_text`, `display_text`, `translation_en`, STT confidence. |
| `recording_sop_versions` | Versioned SOP clause sets (`draft` -> `approved` -> `retired`). Approved content is immutable. |
| `recording_rubric_versions` | Versioned rubric dimensions and weights (sum 100). One `active` per tenant. MK Sales Score v1 is seeded. |
| `recording_analysis_jobs` | Durable leased jobs. Idempotent on transcript revision + rubric version + SOP version + `job_version`. |
| `recording_analyses` | Immutable analysis output, score status, raw total, assessed weight, model/provider/prompt version, explicit fallback, status reasons, superseded analysis. |
| `recording_score_dimensions` | Per-dimension status, rating 0–10, configured and effective weight, points, reason and evidence. |
| `recording_analysis_reviews` | Append-only manager approve / flag / unflag / edit / comment rows. An edit stores overrides and a server-computed reviewed total; it never changes the analysis. |

`recorder_config.analysis_enabled` (default `false`) keeps the layer dark until
the owner enables it with `recording_configure_analysis`.

### Transcript states

- **Provisional**: `recorder_segments` rows with `is_final=false`, written by
  live chunk jobs. Display only. Never analysed or scored.
- **Final (machine)**: the final job writes `recorder_segments` (`is_final=true`)
  and then `transcript_finalize`, which creates a machine revision. Same content
  (SHA-256 of canonical segments) is idempotent; reprocessing with different
  output creates the next machine revision. Segment IDs are deterministic
  (`uuid5(session:sequence:index)`), so the index-0 segment of each chunk keeps
  the recorder segment identity and evidence links survive reconciliation.
- **Corrected**: a manager correction copies the base revision, changes only the
  named segments' text or speaker, keeps every `segment_id`, timestamp and
  source offset, and records author and reason. Originals stay readable.

### Speakers

The worker labels a segment `employee` or `customer` only when the processor
returns that role with confidence ≥ 0.85. Otherwise it is `unknown`. The table
enforces the same threshold for `diarization` labels. Managers can correct
speakers through a correction revision (`speaker_source='manual'`). Nothing is
ever attributed to the employee because they spoke the most.

## MK Sales Score v1

| Key | Dimension | Weight |
|---|---|---|
| `greeting_sop` | Greeting & SOP | 15 |
| `product_knowledge` | Product Knowledge | 20 |
| `needs_discovery` | Needs Discovery & Listening | 15 |
| `objection_handling` | Objection Handling | 15 |
| `pricing_value` | Pricing & Value Communication | 10 |
| `closing_follow_up` | Closing & Follow-up | 15 |
| `personalization_empathy` | Personalization & Empathy | 10 |

Each dimension is `assessed` (rating 0–10 with at least one evidence quote),
`not_applicable` (the situation did not arise, for example no objection was
raised) or `insufficient_evidence`. No neutral 5/10 defaults.

Server formula (`recording_compute_score`, mirrored by
`packages/core/src/salesScore/score.ts` and tested for parity):

```text
assessed_weight   = Σ configured_weight of assessed dimensions
effective_weight  = configured_weight / assessed_weight × 100   (assessed only)
points            = rating / 10 × effective_weight
raw_total         = round(Σ points, 2)                          (0–100)
```

If `assessed_weight` is below the rubric's `min_assessed_weight` (default 50),
the status is `insufficient_evidence` and there is no total. The analysis keeps
raw ratings, configured and effective weights, rubric version, SOP version,
model, prompt version and evidence.

Status precedence: `insufficient_evidence` (too few words, too little assessed
weight, or the analyzer said so) > `needs_review` > `scored`. `needs_review`
reasons are computed in SQL from durable data: `low_stt_confidence` (mean below
0.6), `speaker_unverified` (over half of speech time `unknown`),
`fallback_model`, `high_policy_finding`, `analyzer_low_confidence`. A
`needs_review` analysis keeps its computed total but is not shown to the
employee until a manager approves it.

Upsell is a separate evidenced signal (`upsell_opportunity`), never a dimension
penalty.

## Analysis output contract

`services/recorder/contracts.py` (pydantic, `extra='forbid'`) is the worker-side
schema; `services/recorder/contracts/*.schema.json` are the exported
machine-readable JSON Schemas (a test fails if they drift). SQL validates again.

- `summary` (1 short paragraph), `key_points` (3–5),
  `product_interests`, `customer_requirements` (explicit budget, occasion,
  requirement only: `stated` facts with evidence), `customer_concerns`,
  `competitor_mentions`, `purchase_blockers`, `coaching_strengths`,
  `coaching_gaps`, `coaching_interventions` (1–3), `next_best_actions` (reason +
  evidence).
- `signals`: `objection`, `price_concern`, `stock_gap`, `competitor_mention`,
  `customer_questions`, `conversion_signal`, `next_step`, `drop_off`,
  `upsell_opportunity`, each `{detected, confidence, reason, evidence}`, plus
  `sales_outcome` (`unknown|enquiry|follow_up|reported_purchase|no_purchase`)
  with confidence. A detected signal needs evidence.
- `policy_findings`: `{severity, clause_id, statement, evidence}` cited against
  the pinned approved SOP version. SQL rejects an unknown clause and rejects
  `high` unless every evidence segment is speaker `employee`.
- `dimensions`: one entry per rubric key.

Every evidence item is `{segment_id, quote}`. SQL checks the segment belongs to
the analysed revision and that the quote appears in its text (after the same
redaction the prompt used), then stores the segment's `start_ms`/`end_ms`, so
time offsets are server-derived and the UI can seek audio and highlight text.

No field exists for age, gender, emotion, religion, caste or other sensitive
attributes, and the prompt forbids inferring them.

## Jobs, retries and fallback

- `analysis_claim` leases one job for 5 minutes (skip-locked, one per session).
- The worker short-circuits insufficient transcripts without calling a model.
- Invalid model JSON gets up to two repair attempts inside the lease.
- An optional fallback analyzer runs only when configured; its use is stored
  as `fallback_used` + `fallback_reason` and forces `needs_review`.
- `analysis_fail` records a fixed error code and backs off (10 s × 2^n, max
  15 min); a job dies after 5 attempts. A dead job never blocks the recording.
- `analysis_reconcile` recovers expired leases and applies retention.
- Logs and errors contain fixed codes only: no transcript, quote, prompt or
  model response text.

## Redaction

Phone numbers, e-mail addresses, Aadhaar-like 12-digit numbers, PAN, card-like
13–19 digit numbers and UPI handles are masked before text enters a prompt
(`services/recorder/redact.py`) and in analytics extracts
(`packages/core/src/salesScore/redact.ts`). Stored transcripts keep the
original for authorized review. The SQL quote check accepts a quote that
matches the redacted text.

## Review, correction and rescoring

- `recording_review_analysis`: approve, flag, unflag, comment, or edit with
  dimension overrides (rating/status/reason). Requires manager authority,
  `recording.review` and branch scope. Audited.
- `recording_correct_transcript`: new revision as above. Audited. Does not
  rescore by itself.
- `recording_request_rescore`: enqueues a job for a chosen transcript revision,
  rubric version and SOP version. Same inputs return the existing job. Previous
  analyses stay; the new one links to the one it supersedes.
  `compareAnalyses` in core produces the change list.
- `recording_request_reprocess`: re-queues the dead final transcription job
  while the audio is still retained.
- Rubric and SOP versions: `recording.manage_rubric` (Super Admin, Admin).
  SOP approval must be by someone other than the author unless Super Admin.

AI output is a recommendation. Nothing here writes CRM, marks a purchase or
changes reports.

## Visibility

Managers with `recording.review` in the session's branch see everything for
the session. The recorded employee sees their own transcript and only
analyses a manager has approved.

## Evaluation (`services/recorder/eval`)

Fixed synthetic reference conversations (Hinglish and English, no customer
data) with human rubric labels; deterministic variants (ASR word substitution,
dropout, unknown speakers, truncation). `run_eval.py` reports score standard
deviation across repeats and variants, per-dimension MAE against human labels,
status agreement and Cohen's kappa, signal precision/recall, and failure
examples. Real noisy store audio, Marathi and Gujarati are opt-in benchmark
sets added by the owner; until measured they are not called production quality.

## Not in Phase 1

Manager review UI (Phase 2, migration 0380) and evidence click-to-seek audio
(Phase 3, migration 0381: audited single-use playback grants, served by the
recorder service; see `services/recorder/README.md`) are now built. Still open:
real STT/diarization
model deployment and latency numbers; loading MK Jewels SOP text as an approved
version (owner review step); Ask Kiara read tool (none added; Kiara gets no
transcript or score access). CRM customer links, CRM-confirmed outcomes and follow-up
Tasks/FMS are in `2026-11-06-store-intelligence-integration-design.md` (migration 0384).
