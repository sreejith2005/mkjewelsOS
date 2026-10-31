# Audit validation and handoff

> Historical read-only audit snapshot, captured before owner-approved implementation. Current implementation and local validation are recorded in [CRM_FMS_INTEGRATION_IMPLEMENTATION.md](../CRM_FMS_INTEGRATION_IMPLEMENTATION.md). The findings and point-in-time counts below are retained as audit history.

Date: 2026-10-27, Asia/Kolkata. Scope: metadata audit and proposed design only.

## Files added

| Path | Purpose |
| --- | --- |
| `SUPABASE_DATA_INVENTORY.md` | Hosted object enumeration, critical ownership, conservative classification, storage and cleanup proposal |
| `SUPABASE_JEWELOS_CATALOG.json`, `SUPABASE_CRM_CATALOG.json` | Metadata-only catalogs, grant/RLS flags, relation statistics, function signatures, triggers, dependencies and bucket aggregates |
| `SUPABASE_JEWELOS_JOBS.json`, `SUPABASE_CRM_JOBS.json` | Job names/schedules/status; commands intentionally excluded |
| `FORMS_FMS_CONFIGURATION_CATALOG.json` | Actual template/field definitions, option labels/values and saved workflow/stage/route configuration, no answers |
| `CRM_FMS_FIELD_MAPPING_REVIEW.md` | Actual five forms and proposed mappings, with misleading option-token meanings identified |
| `CRM_FMS_INTEGRATION_DESIGN.md` | Existing transaction map, proposed contracts, phases, validation/deployment/rollback/backfill gates |
| `scripts/audit-customer-data-catalog.sql` | Read-only metadata query; uses explicit read-only transaction |
| `scripts/audit-customer-form-definitions.sql` | Read-only form/workflow configuration query; no submissions or selected users |
| `scripts/render-customer-data-inventory.py` | Offline inventory renderer/source-reference triage; no DB/network access |

Paths without a prefix above are relative to `docs/architecture/`. Existing unrelated dirty files were preserved. No generated database types changed in this task. No schema/RPC/RLS/grant/Storage/audit behavior was changed, and no operational/client records were rewritten.

## Commands and actual results

| Command / check | Result |
| --- | --- |
| `git rev-parse --show-toplevel` | Confirmed `C:/Users/MIS/Downloads/MKJewelOS` |
| `git status --short --branch`; `git -C C:/crm status --short --branch`; `git worktree list` | Existing dirty Forms 2.0/CRM work and different branches identified; no checkout/reset/staging |
| `supabase.cmd migration list --linked` | Success; 0347-0349 applied remotely/missing locally, local 0346 pending |
| `supabase.cmd migration list --linked --workdir supabase-crm` | Success; ledger matches this checkout through 20261023000100 |
| `supabase.cmd inspect db table-stats --linked` (and `--workdir supabase-crm`) | Success for both; sizes/estimates inspected, no customer records |
| `supabase.cmd db query --linked --file scripts/audit-customer-data-catalog.sql --output json` | Success; JewelOS 218 relations / 805 function signatures / 185 triggers / 8 buckets |
| Same catalog query with `--workdir supabase-crm --file C:/Users/MIS/Downloads/MKJewelOS/scripts/audit-customer-data-catalog.sql` | Success; CRM 120 relations / 313 function signatures / 93 triggers / 1 bucket |
| `supabase.cmd db query --linked --file scripts/audit-customer-form-definitions.sql --output json` | Success; five templates / 26 fields / eighteen workflow versions; v17 published, v18 draft |
| Metadata-only read-only `cron.job` queries for each project | Success; eight JewelOS and three CRM scheduled jobs; command text excluded |
| Read-only CRM `sheet_sync_settings.two_way` | False; no configuration changed |
| `python scripts/render-customer-data-inventory.py` | Passed; inventory rendered from captured metadata and source references |
| `python -m py_compile scripts/render-customer-data-inventory.py` | Passed |
| JSON parsing, relation/function/trigger totals, all-buckets-private and form/workflow count checks | Passed |
| `git diff --check` | Passed; existing LF/CRLF warning in pre-existing FmsFormAuthoring file |
| Read-only builder review of design, then its policy clarifications | No remaining material planning question or contradiction identified; not implementation approval |
| `docker ps --format '{{.Names}}'` | Failed: Docker Desktop Linux engine pipe unavailable |

The first CRM catalog invocation used a relative `--file` path that the CLI resolved under `supabase-crm`; it failed without querying data and was corrected to an absolute path. Earlier Windows wildcard searches were corrected to supported glob/path usage. No schema dump, production reset, migration application, hosted data change, deployment, publication or backfill was run.

## Additional aggregate counts

Explicit read-only count queries (not planner estimates) returned:

| Project | Object / state | Count |
| --- | --- | ---: |
| JewelOS | form_templates | 5 |
| JewelOS | form_fields | 26 |
| JewelOS | form_submissions | 51 |
| JewelOS | fms_instances | 18 |
| JewelOS | fms_instance_stages | 65 |
| JewelOS | existing roster/master outbox pending | 0 |
| JewelOS | existing roster/master outbox dead | 0 |
| CRM | clients | 1593 |
| CRM | leads | 11 |
| CRM | client_timeline | 2186 |
| CRM | visit_forms | 1997 |
| CRM | crm_contacts | 1 |

Counts are point-in-time observations, not a reconciliation of every source record. The empty existing sync queue does not establish customer synchronization: no FMS customer-event producer/receiver has been implemented.

## What remains unproven

The requested integration is **not implemented or complete**. Full per-object semantic ownership, dynamic dependencies, exact activity timestamps and complete cleanup proof remain open; the inventory labels inferred/unclear ownership explicitly. No source-data reconstruction or customer matching was attempted. No end-to-end, authorization, persistence, pgTAP, Edge runtime, authenticated browser or physical-phone acceptance scenario was run for new functionality.

Next gate is review/approval of the concrete integration design, particularly the four policy proposals under its builder-review section. Then write the implementation plan, reconcile the current source/migration baseline and implement/test phases B-H. Hosted apply/deploy, actual mapping activation, production backfill and destructive cleanup require their distinct later gates. No Android source or APK work is needed for the proposed web integration.
