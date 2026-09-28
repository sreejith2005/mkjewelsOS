// Phase 5/7 CRM data import: original CRM database (schema public) -> JewelOS schema crm.
//
//   CRM_IMPORT_SOURCE_URL=... CRM_IMPORT_TARGET_URL=... node scripts/crm-import/import.mjs --dry-run
//   ... node scripts/crm-import/import.mjs [--report=C:\crm-private\work\import-report.json] [--tenant-id=<uuid>]
//   ... node scripts/crm-import/import.mjs --replace-local        (local target only)
//
// URLs come from the environment (or --source= / --target=) at run time and are never stored or
// printed. One target transaction, all or nothing: triggers off (session_replication_role =
// replica) so no stored value is regenerated, every id and value copied as-is, sequences moved
// past the highest value in use, one public.audit_logs summary row, then reconciliation inside the
// same transaction (row counts, content hashes, foreign keys). --dry-run rolls back after it.
// Output is counts, names, ids and hashes only; see docs/CRM_DATA_MIGRATION_RUNBOOK.md.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

import pg from "pg";
import { from as copyFrom, to as copyTo } from "pg-copy-streams";

import { applyHashSession, columnMax, listColumns, listSequences, listTables, orphanCounts, primaryKey, rowCount, tableHash } from "./db.mjs";
import {
  assertOutsideGit, auditSummary, combinedChecksumInput, describeDatabaseUrl, isLocalDatabaseUrl, nonEmptyUnseededTables,
  parseArgs, planColumns, planTables, quoteIdent, reconcileSeeded, redactError, SEEDED_TABLES, sequenceTarget,
} from "./lib.mjs";

const SOURCE_SCHEMA = "public";
const TARGET_SCHEMA = "crm";

const args = parseArgs(process.argv.slice(2));
const sourceUrl = args.source ?? process.env.CRM_IMPORT_SOURCE_URL;
const targetUrl = args.target ?? process.env.CRM_IMPORT_TARGET_URL;
const dryRun = args["dry-run"] === true;
const replaceLocal = args["replace-local"] === true;
function refuse(message) {
  console.error(`crm-import refused: ${message}`);
  process.exit(1);
}
if (!sourceUrl || !targetUrl) refuse("set CRM_IMPORT_SOURCE_URL and CRM_IMPORT_TARGET_URL (or --source= / --target=)");
if (replaceLocal && !isLocalDatabaseUrl(targetUrl)) refuse("--replace-local is only allowed for a local target");
try {
  if (args.report) assertOutsideGit(args.report);
} catch (error) {
  refuse(error.message);
}

const log = (line) => console.log(line);
log(`source: ${describeDatabaseUrl(sourceUrl)}; target: ${describeDatabaseUrl(targetUrl)}; mode: ${dryRun ? "DRY RUN (rolled back)" : "IMPORT"}${replaceLocal ? " + replace-local" : ""}`);

const source = new pg.Client({ connectionString: sourceUrl, application_name: "crm-import (read-only)" });
const target = new pg.Client({ connectionString: targetUrl, application_name: "crm-import" });

/** {id, key} rows of a seeded table, keyed as SEEDED_TABLES says. */
async function seededKeys(client, schema, table) {
  const s = quoteIdent(schema);
  const sql = table === "lead_form_field_options"
    ? `select o.id::text as id, f.field_key || chr(31) || o.option_value as key from ${s}.lead_form_field_options o join ${s}.lead_form_fields f on f.id = o.field_id`
    : `select id::text as id, ${quoteIdent(SEEDED_TABLES.get(table))}::text as key from ${s}.${quoteIdent(table)}`;
  return (await client.query(sql)).rows;
}

async function main() {
  const startedAt = new Date().toISOString();
  await source.connect();
  await target.connect();
  await applyHashSession(source);
  await applyHashSession(target);
  // One consistent, read-only snapshot of the source for the whole run.
  await source.query("begin isolation level repeatable read read only");
  await target.query("begin");
  await target.query("set local session_replication_role = replica");
  await target.query("set local statement_timeout = 0");
  await target.query("set local lock_timeout = '30s'");

  const sourceTables = await listTables(source, SOURCE_SCHEMA);
  const targetTables = await listTables(target, TARGET_SCHEMA);
  const plan = planTables(sourceTables, targetTables);
  if (plan.missing.length) throw new Error(`source tables missing from ${TARGET_SCHEMA}: ${plan.missing.join(", ")}`);
  log(`tables: ${plan.copy.length} to copy; excluded: ${plan.excluded.join(", ") || "none"}; target-only (left empty): ${plan.targetOnly.join(", ") || "none"}`);

  // Guard: only the seeded lookups may already hold rows.
  const targetCounts = {};
  for (const table of targetTables) targetCounts[table] = await rowCount(target, TARGET_SCHEMA, table);
  const occupied = nonEmptyUnseededTables(targetCounts);
  if (occupied.length && !replaceLocal) throw new Error(`target ${TARGET_SCHEMA} already holds data in: ${occupied.join(", ")} (refusing; --replace-local exists for local targets only)`);
  if (replaceLocal) {
    await target.query(`truncate ${targetTables.filter((t) => !SEEDED_TABLES.has(t)).map((t) => `${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(t)}`).join(", ")}`);
    log(`replace-local: emptied ${targetTables.length - SEEDED_TABLES.size} unseeded tables (${occupied.length} held rows)`);
  }

  // Seeded lookups: classify, then replace the seeded rows with the source rows (source ids kept).
  const seeded = {};
  for (const table of SEEDED_TABLES.keys()) {
    if (!plan.copy.includes(table)) continue;
    seeded[table] = reconcileSeeded(await seededKeys(source, SOURCE_SCHEMA, table), await seededKeys(target, TARGET_SCHEMA, table));
  }
  for (const table of ["lead_form_field_options", "lead_form_fields", ...[...SEEDED_TABLES.keys()].filter((t) => t.startsWith("lookup_"))]) {
    if (seeded[table]) await target.query(`delete from ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)}`);
  }

  // Copy every table, same columns and values, triggers off.
  const columnsByTable = {};
  const counts = {};
  for (const table of plan.copy) {
    const { columns, missing } = planColumns(await listColumns(source, SOURCE_SCHEMA, table), await listColumns(target, TARGET_SCHEMA, table));
    if (missing.length) throw new Error(`${TARGET_SCHEMA}.${table} lacks source columns: ${missing.join(", ")}`);
    columnsByTable[table] = columns;
    const list = columns.map(quoteIdent).join(", ");
    await pipeline(
      source.query(copyTo(`copy (select ${list} from ${quoteIdent(SOURCE_SCHEMA)}.${quoteIdent(table)}) to stdout`)),
      target.query(copyFrom(`copy ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)} (${list}) from stdin`)),
    );
    counts[table] = await rowCount(target, TARGET_SCHEMA, table);
  }
  log(`copied ${Object.values(counts).reduce((a, b) => a + b, 0)} rows in ${plan.copy.length} tables`);

  // Sequences: past the highest value in use and never behind the source.
  const sourceSequences = new Map((await listSequences(source, SOURCE_SCHEMA)).map((s) => [s.name, s]));
  const sequences = {};
  for (const seq of await listSequences(target, TARGET_SCHEMA)) {
    const src = sourceSequences.get(seq.name);
    const max = seq.owner_table ? await columnMax(target, TARGET_SCHEMA, seq.owner_table, seq.owner_column, seq.owner_type) : null;
    const value = sequenceTarget({ sourceLast: src?.last_value ?? null, sourceCalled: Boolean(src?.called), columnMax: max });
    if (value !== null) await target.query("select setval($1::regclass, $2::bigint, true)", [`${TARGET_SCHEMA}.${quoteIdent(seq.name)}`, value]);
    sequences[seq.name] = { source_last_value: src?.last_value ?? null, column_max: max, set_to: value, next: value === null ? "start" : (BigInt(value) + 1n).toString() };
  }

  // Reconciliation inside the transaction: counts and content hashes over the copied columns.
  const tables = {};
  const sourceHashes = {};
  for (const table of plan.copy) {
    const order = await primaryKey(source, SOURCE_SCHEMA, table);
    const s = await tableHash(source, SOURCE_SCHEMA, table, columnsByTable[table], order);
    const t = await tableHash(target, TARGET_SCHEMA, table, columnsByTable[table], order);
    sourceHashes[table] = s;
    tables[table] = { source_rows: s.rows, target_rows: t.rows, rows_equal: s.rows === t.rows, hash_equal: s.hash === t.hash, hash: s.hash };
  }
  const sourceChecksum = createHash("sha256").update(combinedChecksumInput(sourceHashes)).digest("hex");
  const orphans = (await orphanCounts(target, TARGET_SCHEMA)).filter((o) => o.orphans > 0);
  const failures = Object.entries(tables).filter(([, r]) => !r.rows_equal || !r.hash_equal).map(([name]) => name);

  // The one audit row for the import (counts and checksum; no customer values).
  const tenantId = args["tenant-id"] ?? (await target.query("select case when count(*) = 1 then min(id::text) end as id from public.tenants")).rows[0].id;
  const summary = auditSummary({ counts, sourceChecksum, seeded, excluded: plan.excluded, sequences, startedAt });
  await target.query(
    "insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value) values ($1, null, 'crm.legacy_data_import', 'crm', null, null, $2::jsonb)",
    [tenantId, JSON.stringify(summary)],
  );

  const report = {
    mode: dryRun ? "dry-run" : "import", started_at: startedAt, finished_at: new Date().toISOString(),
    source_checksum_sha256: sourceChecksum, excluded_tables: plan.excluded, target_only_tables: plan.targetOnly,
    tables, seeded, sequences, fk_orphans: orphans, audit_tenant_id: tenantId,
    accepted: failures.length === 0 && orphans.length === 0,
  };
  for (const [name, r] of Object.entries(tables)) log(`  ${name.padEnd(34)} ${String(r.source_rows).padStart(7)} -> ${String(r.target_rows).padStart(7)}  rows ${r.rows_equal ? "=" : "DIFF"}  hash ${r.hash_equal ? "=" : "DIFF"}`);
  for (const [name, r] of Object.entries(seeded)) log(`  seeded ${name}: same ${r.same}, remapped ${r.remapped}, seed-only removed ${r.seedOnly}, added ${r.added}`);
  for (const [name, s] of Object.entries(sequences)) log(`  sequence ${name}: source ${s.source_last_value ?? "-"}, column max ${s.column_max ?? "-"}, next ${s.next}`);
  log(`FK orphans: ${orphans.length ? orphans.map((o) => `${o.constraint}=${o.orphans}`).join(", ") : "none"}`);
  log(`source checksum sha256: ${sourceChecksum}`);
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2));

  if (!report.accepted) {
    await target.query("rollback");
    throw new Error(`reconciliation failed (${failures.length} table differences, ${orphans.length} FK constraints with orphans); rolled back`);
  }
  if (dryRun) {
    await target.query("rollback");
    log("DRY RUN: reconciliation passed; rolled back, nothing written");
  } else {
    await target.query("commit");
    log("IMPORT COMMITTED");
  }
  await source.query("rollback");
}

main()
  .catch(async (error) => {
    await target.query("rollback").catch(() => {});
    console.error(`crm-import failed: ${redactError(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  });
