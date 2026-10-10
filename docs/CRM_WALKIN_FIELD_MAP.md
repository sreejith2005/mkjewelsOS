# Walk-in persistence and verification

Owner incident: 2026-10-07. CRM records live in the **CRM Supabase project**, not the JewelOS project. Client-profile UI is a view of those records; there is no separate client-profile database.

## Data-team field map

| Form information | Persisted source | Client profile |
| --- | --- | --- |
| Client MKC UUID/code, primary/billing phone, name, gender, DOB, anniversary, address, geography, community, preferences, potential, next visit | `public.clients`; complete submitted values also in the submission snapshot | Existing contact/personal/address/preferences/potential cards |
| Visit UUID/reference/date, branch, CRM name, selected salesperson, full purchase/repair/order/exchange/return outcome | `public.client_timeline` | Visit statistics, last visit and timeline |
| Seen, bought and order categories, product requirement, remark | `client_timeline`; latest timeline projects onto `clients.last_*` | Product interests and timeline |
| Product counts and tags, other-category text, came-for categories, new purchases/orders and attending salesperson | `visit_forms.category_details`; snapshot retains every submitted field | Saved walk-in details |
| Occupation, bridal status, wedding month/year, communication preference, lead source, reference name/phone, client type | `public.visit_forms` typed columns plus snapshot | Saved walk-in details |
| Companions and family relationships | `visit_forms.companions`; existing household/client identity triggers | Family card plus saved walk-in details |
| Not-bought reasons, free-text reason, CRM approach and marketing message | `visit_forms` typed columns plus snapshot | Saved walk-in details |
| Exact Instagram/review/testimonial/feedback/thank-you/referral answer and NO reason | Boolean/reason columns plus `additional_fields.engagement_answers` (the full answer vocabulary) | CRM status card and saved walk-in details |
| Referrals and count | `additional_fields.referrals`, count, existing `referrals`/calling/identity triggers | Saved walk-in details and existing referral workflow |
| Other beverage/sugar/snack/gift, gift history, other store, requested designs | `additional_fields`, submitted snapshot, `clients.gift_history` | Preferences and saved walk-in details |
| Images, testimonial video, optional remark photos | Private `crm-documents` Storage bytes; `public.documents` client/visit/actor/path/MIME; snapshot documents include purpose and original filename; proof columns store Storage path | On-demand signed image/video viewing, 300-second URLs |
| Every submitted field, including unfamiliar future/legacy keys | `visit_forms.additional_fields.submitted_fields` (native RPC snapshot); legacy ingestion also keeps `legacy_submitted_fields` | Expandable saved walk-in details |
| Actor and operation history | `crm_private.audit_logs`; existing edit log | Existing profile edit log; private audit available only through authorized operations |

`submitted_fields` contains the original payload, not a regenerated profile. A normalized outcome can therefore be compared with the original answers. Dates and internal IDs stay in the snapshot. Signed URLs are not persisted as permanent proof URLs; Storage paths are.

## Corrected behavior

Selected staff resolves to exactly one active synced selected-branch user (attendance is independent of CRM queue allocation), independently from the authenticated audit actor. A malformed/unknown selection fails the transaction. Full outcome tokens survive, including purchases made during repair/order visits and purchase-plus-order visits. Purchase and order counts include those combinations.

Submission waits for every upload, including optional photos; failed uploads must be retried or removed. The RPC checks object existence, owner, client/visit path, MIME and size before linking documents. A missing or invalid object rolls back the whole visit. Media cannot silently disappear from a successful submission.

No public bucket, grant expansion, client-side authorization fallback, or new fake persistence is introduced. Existing RPC RLS and audit transactions remain. Private helper functions are not exposed through PostgREST. No new public table/column or RPC signature is added by the corrective migration.

## Live incident evidence and recovery limits

Read-only check of `MKC-104273` on 2026-10-07: two stored timeline visits, both `NO`; two saved forms; one normalized saved `REPAIR_PICKUP`; seen categories present in one timeline and in the other form's legacy fields; zero linked documents. The legacy form itself says NO. This does not establish the user's intended purchase or prove an upload happened. Do not manufacture a YES answer or a media attachment.

Existing records are not silently rewritten by the migration. Recovery must compare each original saved form/Sheet row with the timeline and client projection, resolve selected staff without guessing, preserve record IDs and references, and write an audit event in the same transaction. Review a recovery preview before applying. Files never uploaded cannot be recovered from a metadata record; old external Drive proof URLs are not evidence of copied Supabase Storage bytes.

The legacy Apps Script `crm-walkin-ingest` endpoint still explicitly rejects `filesPayload` with 422 and saves no visit. This is a known separate upload-bridge gap, not verified support. Native/web walk-in media uses private Supabase Storage. The separate Sheet-sync worker preserves external proof URLs; importing their bytes requires a reviewed bridge rather than treating them as Supabase files.

## Validation record

- `pnpm.cmd --dir C:\crm --filter @jewelos/crm-ui test`: 114 tests / 27 files passed; generated scoped CSS current.
- `pnpm.cmd --dir C:\crm --filter @jewelos/crm-ui typecheck`: passed.
- `pnpm.cmd --dir C:\crm --filter web build`: passed after final pagination changes; existing large-chunk warning.
- `deno test --allow-env --allow-net --config supabase-crm/supabase/functions/crm-walkin-ingest/deno.json` with mapper/worker test files: 23 passed.
- All 18 CRM migrations replayed successfully into isolated synthetic database `crm_walkin_validation_20261007` on local Docker stack `supabase_db_mkcrm`. Existing Auth/Storage/extensions scaffolding was retained; platform ACLs/admin access restored to match the source stack. No running application database was reset.
- Full local pgTAP: 11 suites / 427 assertions passed. Final compatibility addition: persistence suite 50 assertions passed (428 total including unchanged suites). PostgreSQL exit status and TAP `not ok` were both checked.
- Independent read-only review found no remaining important findings after corrections to unanswered actions, backdated gifts, failed-photo removal, date reordering and pagination.
- Android CRM uses the same `/crm` surface through `CrmWebViewScreen`; no APK-contained code changes. Physical-device/media-picker and authenticated rendered QA are unproven.
- Five already-applied prerequisite migrations and their updated tests were restored unchanged from current same-repository worktrees. Migration ledger was not repaired or rewritten. Generated types were refreshed against the linked CRM schema.
- `git diff --check`: passed. Hosted migration list/dry-run: only `20261007001000_crm_walkin_persistence.sql` pending.
- Owner explicitly instructed using `walk-in_crm` (`fsydcsyqnddacjfoutfe`) instead of a separate staging project. Pre-change schema backup is outside Git at `C:\crm-private\walkin-schema-before-20261007001000.sql`. The correction does not rewrite existing rows.

## Remaining verification and recovery

Authenticate as a controlled staff account and exercise all form sections plus image/video upload, saved document rows, private bytes and signed viewing at desktop/phone width. Static/unit/database checks do not substitute for this run. Historical reconciliation and the legacy Apps Script file-upload bridge remain separate incomplete work; no unsupported media path is described as fixed.

## Hosted release evidence

2026-10-07: corrective migration applied successfully to `walk-in_crm` / `fsydcsyqnddacjfoutfe`; changed `crm-walkin-ingest` function deployed by explicit name. No secrets/config/jobs changed and no historical data repair applied. A clean release snapshot based on current `origin/main` passed its 110 CRM tests (26 suites), scoped CSS check, and web typecheck/build; differing test totals reflect unrelated branch tests, not failed tests. Generated CSS was regenerated for that exact release snapshot. Unrelated worktree edits were excluded.

Customer purchase intentions not present in saved source data and missing media bytes remain unrecoverable without original evidence. Legacy Apps Script `filesPayload` support is still incomplete. Authenticated rendered form/private upload/download and physical phone verification remain outstanding.

Release commit: `a3560fd518eb185e3bc11d778ab897247f3ac9e2`, pushed to `origin/main` as a fast-forward over the latest released base. Vercel deployment `dpl_CTfQufbdAWKpmqbrXZpYs2SSAom9` is Ready and aliases `https://mkjewels-os.vercel.app`. Public `/crm` returns 200 and three corrective UI markers are present in hosted assets. Hosted post-change schema dump contains the salesperson, full snapshot, media validation, date refresh, projection trigger and combined-purchase rollup markers. Anonymous client read, walk-in RPC and unauthenticated ingest each returned 401. These are deployment/anonymous-access checks, not authenticated form or physical-device evidence.

## Historical reconciliation follow-up (2026-10-07)

Read-only pagination covered 1,575 clients, 2,178 timeline entries and all 1,989 saved forms, with 147 distinct source keys. 931 timeline outcomes were unset. A conservative evidence comparison found purchase-cache mismatches; a final service preview determines the exact repair scope after excluding placeholder categories and explicit non-purchase outcomes. 189 timeline entries have no saved form; absence is reported rather than filled with invented answers.

Migration 20261007001300 adds authenticated `get_walkin_salespeople` (active synced branch staff, selected UUID), protected evidence helpers and service-only `crm_reconcile_saved_walkins`. The latter defaults to read-only counts. Apply locks affected clients and changed visits/forms, rejects concurrent source drift, preserves original fields, and records form/timeline plus client-projection before/after audits. Recovery normalizes valid original outcomes including upsales, fills missing categories/tags/counts/engagement/gifts/months, and refreshes cached statistics/actions/gifts. Explicit NO, native false and placeholder categories do not imply a purchase. Historic salesperson labels are displayed from saved answers; no account links are guessed or rewritten. Original snapshots remain authoritative.

All 11 existing document rows were verified against private Storage: 11 accessible, nonempty files, all 11 MIME matches. Saved external proof links remain external; their existence does not establish copied Supabase bytes. Browser upload and physical phone checks remain unproven. The Apps Script file bridge is still unsupported and must not be described as repaired.

Local current-main CRM database suite: 452 assertions passed, including 35 reconciliation cases. A legacy synthetic referral fixture was corrected to use the same name when asserting the published name-plus-phone identity contract; authorization was not relaxed. Focused attendance/error/profile tests: 28 passed. Independent read-only review found no remaining important findings after conservative purchase, exchange attendance, unchanged gift and locked audit-snapshot corrections.

The category audit found 2,100 arrays containing duplicate labels with differing capitalization. Case-insensitive category sets matched all 2,424 populated source/category pairs. Recovery uses the original comma-separated labels only when the complete category sets match (or the array is missing), preserves conflicting categories, and excludes placeholders. Native snapshots are excluded from this historical reconciliation.

The field audit found 65 named wedding months missing their typed month and three reference-phone formatting differences explained by stored country codes. Other reviewed populated typed scalar fields and product tags matched source answers. 207 historical gift answers were placeholders; placeholders remain saved answers but do not become gifts received.

Hosted follow-up: migrations 20261007001300 and 20261007001400 applied to the owner-approved CRM project. Read-only preview checked 254,641 saved source fields. Audited recovery corrected 1,977 visits and refreshed 1,354 client projections; nine timeline-only caches were then repaired through the same service contract. Final full-timeline comparison: zero total-visit mismatches and zero purchase-count mismatches. MKC-104251 now has one purchase and one repair visit, retains REPAIR_PLACED and has two distinct bought categories after duplicate reconciliation. MKC-104273 retains zero purchases and its saved REPAIR_PICKUP outcome; purchase intentions absent from its source were not invented.

Post-repair preservation check: all 1,989 original forms present, zero original-answer changes and zero unexpected typed-field changes. Document count remains 11. A repeat mapping preview found zero pending changes. Audit counts: 1,977 visit repairs and 1,363 client projections. The first REST apply timed out and rolled back (zero repair audits); the successful administrative session used the exact audited RPC with a bounded timeout. Backups and detailed evidence remain outside Git. The forward timeline-only migration changes no inputs/grants and preserves missing forms.
