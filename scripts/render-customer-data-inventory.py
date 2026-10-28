"""Render metadata-only catalog captures; does not connect to any database."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "architecture"


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8-sig"))


def business(project, schema, name):
    if schema not in {"public", "crm", "crm_sync", "crm_private"}:
        return "A", "Supabase/platform", "Managed platform metadata or infrastructure; retain."
    if project == "JewelOS" and (schema == "crm" or name.startswith("crm_") or name in {"clients", "client_timeline", "client_assignments", "client_interactions", "client_documents", "client_followups"}):
        return "F", "Legacy CRM / integration", "Retain pending caller, import, reporting and rollback dependency review."
    if any(x in name for x in ("audit", "history", "edit_log", "mutation_keys", "stage_logs", "contributions", "import_keys")):
        return "C", "History / accountability", "Historical evidence or replay protection; retain."
    if any(x in name for x in ("browse_state", "realtime_events", "cache")):
        return "D", "Read projection / delivery", "Derived state; do not remove without tested rebuild and consumer review."
    if schema in {"crm_sync", "crm_private"} or "sync_" in name:
        return "A", "Integration", "Protected synchronization, identity, configuration or retry state; retain."
    if project == "CRM" and name not in {"users", "branches", "_prisma_migrations"} and not name.startswith("lookup_"):
        return "B", "CRM", "Customer identity, evidence, relations or customer workflow; retain."
    for prefix, module in (("fms_", "FMS"), ("form_", "Forms"), ("task_", "Tasks"), ("notification", "Notifications"), ("kiara_", "Ask Kiara"), ("leave", "Availability"), ("report", "Reports"), ("user", "Users / access"), ("dropdown", "Dropdown Master")):
        if name.startswith(prefix):
            return "A", module, "Module persistence or configuration; retain."
    return "F", "Ownership review", "Purpose not individually established; retain and investigate."


def safe(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


sources = []
for base in ("apps/web/src", "packages/core/src", "packages/data/src", "packages/api-client/src", "packages/crm-ui/src", "supabase/migrations", "supabase/functions", "supabase-crm/supabase/migrations", "supabase-crm/supabase/functions"):
    folder = ROOT / base
    if folder.exists():
        for path in folder.rglob("*"):
            if path.suffix in {".ts", ".tsx", ".sql"} and "database.types" not in path.name and "node_modules" not in path.parts:
                sources.append((path.relative_to(ROOT).as_posix(), path.read_text(encoding="utf-8-sig", errors="replace")))

catalogs = [("JewelOS", load("SUPABASE_JEWELOS_CATALOG.json")), ("CRM", load("SUPABASE_CRM_CATALOG.json"))]
lines = ["# Supabase data inventory", "", "Captured 2026-10-27 (Asia/Kolkata). Metadata-only read-only hosted audit; no customer answers or file paths were exported.", "", "## Evidence and limits", "", "The JSON catalogs enumerate every captured non-system relation, function signature, non-internal trigger, foreign key, view dependency and Storage bucket, including Supabase-managed schemas. Jobs are captured separately without commands or credentials. Relation sizes include indexes and TOAST. `estimated_rows` is planner metadata, not an exact count; -1 means unknown. Analyze timestamps are maintenance timestamps, not business activity. Empty/old objects are not evidence of redundancy.", "", "Classifications below are conservative triage, with purpose inferred from module and source references unless the critical-contract review below says otherwise. Source references are lexical evidence, not proof that a deployed caller executes a read or write. Dynamic SQL, runtime function-body dependencies, provider delivery, all private grants, per-function business purposes and historical reporting dependencies still require review. This is not a completed deletion audit or a full per-object semantic/dependency audit.", "", "A = operational; B = customer; C = historical/audit; D = derived/cache; E = proven candidate pending approval; F = unclear ownership. No object is currently approved for deletion.", "", "## Critical contracts", "", "| Project | Objects | Purpose and retention |", "| --- | --- | --- |", "| JewelOS | form_templates, form_fields, form_submissions, form_submission_files | Versioned definitions, original answers and private upload linkage. Retain all evidence. |", "| JewelOS | fms_instances, fms_instance_stages, fms_stage_logs, fms_visit_transitions | Running work, visit identities, routing and actual historical transitions. Retain. |", "| JewelOS | fms_starter_assignments, fms_workflow_mutation_keys | Exact starter ownership and retry results. Retain; never infer assignments from template IDs. |", "| JewelOS | crm_sync.outbox / inbox / walkin_state | Roster/master snapshots and inbound walk-in task delivery. Reuse authentication/leases, not snapshot coalescing for customer history. |", "| CRM | clients, client_phone_index, households, referrals | Existing MKC/MKF/MKREF identity and relationships; authoritative customer home. |", "| CRM | leads, lead_call_history, lead_stage_history, crm_contacts | Enquiries and explicitly recorded activity; retain individual attempts. |", "| CRM | client_timeline, visit_forms, documents, client_edit_log | Visit outcomes, original saved answers, private media links and field-change history. Retain. |", "| CRM | crm_private.lead_profile_contributions | Existing provenance and conservative projection evidence. Extend compatibly. |", "| CRM | crm_client_activity, crm_client_activity_summary, crm_client_browse_state | Existing invoker activity and incremental bounded browsing. Preserve consumers; derived projection is not source evidence. |", "| CRM | crm_private.sync_inbox / sync_outbox / sheet_sync_* | Delivery identity, retries, Sheet mappings, run/error evidence and one-way switch. Retain. |", "", "## Hosted snapshot", ""]
for project, catalog in catalogs:
    lines += [f"### {project}", "", f"Captured UTC: `{catalog['captured_at']}`. {len(catalog['relations'])} relations, {len(catalog['functions'])} function signatures, {len(catalog['triggers'])} non-internal triggers. Counts include managed infrastructure.", "", "Schemas: " + ", ".join(f"`{s}`" for s in catalog["schemas"]) + ".", "", "| Object | Kind | Class / module | RLS | Estimated rows | Total bytes | Source reference (first lexical match) |", "| --- | --- | --- | --- | ---: | ---: | --- |"]
    for rel in catalog["relations"]:
        category, module, purpose = business(project, rel["schema"], rel["name"])
        pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(rel["name"]) + r"(?![A-Za-z0-9_])")
        refs = [p for p, content in sources if pattern.search(content)] if rel["schema"] in {"public", "crm", "crm_private", "crm_sync"} else []
        rel["audit_class"] = category
        rel["audit_module"] = module
        rel["audit_purpose"] = purpose
        rel["lexical_source_references"] = refs
        rows = rel["estimated_rows"]
        lines.append(f"| `{rel['schema']}.{rel['name']}` | {rel['kind']} | {category} / {module} | {rel['rls']} | {rows if rows is not None and rows >= 0 else 'unknown'} | {rel['bytes'] if rel['bytes'] is not None else '-'} | {safe(refs[0]) if refs else 'not established'} |")
    lines += ["", "Relation kinds: r = table; p = partitioned table; v = view; m = materialized view; f = foreign table. RLS false on a private object is not by itself a browser-access finding; schema USAGE, table grants and exposed API schemas must also be evaluated. Catalogs include anon/authenticated schema and SELECT privilege flags.", "", "| Bucket | Public | Objects | Reported object bytes |", "| --- | --- | ---: | ---: |"]
    for b in catalog["buckets"] or []:
        lines.append(f"| `{b['id']}` | {b['public']} | {b['object_count']} | {b['reported_bytes'] or 0} |")
    lines += ["", "Object sizes are Storage metadata estimates, not independently verified file bytes or account billing totals. All captured buckets are private. No files were downloaded.", "", "| Scheduled job | Schedule | Active |", "| --- | --- | --- |"]
    for j in load(f"SUPABASE_{'JEWELOS' if project == 'JewelOS' else 'CRM'}_JOBS.json"):
        lines.append(f"| `{j['jobname']}` | `{j['schedule']}` | {j['active']} |")
    lines += ["", "A job being active does not prove successful execution. Times are stored cron expressions; timezone/settings and run outcomes were not inspected.", ""]
    (OUT / f"SUPABASE_{'JEWELOS' if project == 'JewelOS' else 'CRM'}_CATALOG.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

lines += ["## Dependency map", "", "```mermaid", "flowchart LR", "  Forms[Forms definitions and original submissions] --> FMS[FMS instances, visits and logs]", "  FMS --> Tasks[Tasks, assignees and notifications]", "  Users[Users and Dropdown Master] --> Sync[Existing roster/master sync]", "  Sync --> Access[CRM staff and master mirrors]", "  Sheets[Google Sheets] --> CRM[CRM clients, leads, visits and history]", "  CRM --> Browse[CRM activity and browse projections]", "  CRM --> Walkin[Walk-in outbox]", "  Walkin --> Tasks", "  FMS -. proposed immutable customer events .-> CRM", "```", "", "## Storage assessment and cleanup proposal", "", "JewelOS audit_logs dominates the inspected relation storage (roughly 501 MiB including indexes). Retention is a business/accountability decision; do not delete or partition it on size alone. Gather growth snapshots, audit consumers and retention requirements first. Task attachments and Kiara knowledge account for most captured object bytes. Maintain private signed access and review existing lifecycle contracts before proposing archival.", "", "| Candidate | Confidence / impact | Required evidence | Archive / rollback |", "| --- | --- | --- | --- |", "| JewelOS legacy crm schema and public legacy CRM/import structures | F; possible old copies, but retain | Exact counts, ID/hash comparison, dynamic SQL/callers, reports, sync/rollback consumers, approved cutover | Verified encrypted backup, restore drill, explicit retention and separate approval |", "| Derived browse/realtime projections | D; consumers currently rely on delivery and paging | Rebuild source coverage, replay boundaries, lag and query-plan evidence | Snapshot/checkpoint plus tested rebuild; no current deletion proposal |", "| Delivered/dead sync events | A/C; replay and investigation evidence | Receiver reconciliation, replay horizon, oldest pending/dead age and operational policy | Archive immutable IDs/digests and outcomes; preserve pending/dead work |", "| Audit, form submissions, FMS visits/logs and customer history | Essential C/B; retain | Approved retention and reporting requirements | No cleanup recommended in this task |", "| Private Storage objects | B/C; keep all captured objects | Link/orphan scan across historical sources, signed access, retention, actual bytes | Copy/checksum/restore verification and explicit approval before any removal |", "", "No table, column, row, bucket, object or migration was deleted, rewritten or applied. Routine next steps are repeated metadata snapshots, query-plan review and dependency review; vacuum/index changes also require impact review rather than being inferred from one snapshot.", "", "## Release boundary", "", "Hosted JewelOS has migrations 0347 (optional Otherwise/form handoff), 0348 (form handoff replacement), 0349 (run names), absent from this checkout; local untracked 0346 is not applied. Same-repository Git commits afa30e0, b436ca0 and dcaff09 contain those later migrations and were read without changing the worktree. CRM linked ledger matches this checkout through 20261023000100. C:/crm has a divergent dirty local migration history, including older filenames/numbers; do not apply that checkout wholesale or renumber applied migrations.", "", "Docker Desktop Linux engine was unavailable during this audit. Local replay/pgTAP, authenticated browser/device flows and end-to-end delivery are not proven. No hosted mutation, deployment or backfill was attempted.", ""]
(OUT / "SUPABASE_DATA_INVENTORY.md").write_text("\n".join(lines), encoding="utf-8")
print("Rendered metadata inventory and conservative source-reference classifications.")
