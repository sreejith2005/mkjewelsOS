// Reconciliation of an imported CRM (source schema public -> target schema crm), run any time
// after import.mjs. Writes a Markdown report (refused inside a Git working tree) and prints counts:
//   - row counts and content hashes per table (same columns, primary-key order)
//   - foreign-key orphans in the target
//   - client rollups vs a recomputation from client_timeline, on both sides (reported, never fixed)
//   - Storage: every crm.documents path present in the target bucket, plus the copy manifest
//
//   CRM_IMPORT_SOURCE_URL=... CRM_IMPORT_TARGET_URL=... node scripts/crm-import/reconcile.mjs \
//     --out=C:\crm-private\work\reconciliation.md [--storage-manifest=C:\crm-private\work\storage-manifest.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import pg from "pg";

import { applyHashSession, listColumns, listTables, orphanCounts, primaryKey, rollupMismatches, tableHash } from "./db.mjs";
import { assertOutsideGit, describeDatabaseUrl, EXCLUDED_TABLES, parseArgs, redactError } from "./lib.mjs";

const TARGET_BUCKET = "crm-legacy-documents";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = args.source ?? process.env.CRM_IMPORT_SOURCE_URL;
  const targetUrl = args.target ?? process.env.CRM_IMPORT_TARGET_URL;
  if (!sourceUrl || !targetUrl || !args.out) throw new Error("CRM_IMPORT_SOURCE_URL, CRM_IMPORT_TARGET_URL and --out are required");
  assertOutsideGit(args.out);

  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  await applyHashSession(source);
  await applyHashSession(target);
  await source.query("begin isolation level repeatable read read only");
  await target.query("begin isolation level repeatable read read only");

  const md = [`# CRM import reconciliation`, "", `Generated ${new Date().toISOString()}. Source ${describeDatabaseUrl(sourceUrl)} (schema public), target ${describeDatabaseUrl(targetUrl)} (schema crm).`, ""];
  const verdicts = {};

  // 1. Counts and hashes.
  const targetTables = new Set(await listTables(target, "crm"));
  const tables = (await listTables(source, "public")).filter((t) => !EXCLUDED_TABLES.has(t));
  md.push("## Row counts and content hashes", "", "| table | source rows | target rows | rows | hash |", "|---|---:|---:|---|---|");
  let tableFailures = 0;
  for (const table of tables) {
    if (!targetTables.has(table)) { md.push(`| ${table} | - | missing | FAIL | FAIL |`); tableFailures++; continue; }
    const columns = await listColumns(source, "public", table);
    const order = await primaryKey(source, "public", table);
    const s = await tableHash(source, "public", table, columns, order);
    const t = await tableHash(target, "crm", table, columns, order);
    const ok = s.rows === t.rows && s.hash === t.hash;
    if (!ok) tableFailures++;
    md.push(`| ${table} | ${s.rows} | ${t.rows} | ${s.rows === t.rows ? "equal" : "DIFF"} | ${s.hash === t.hash ? "equal" : "DIFF"} |`);
  }
  const targetOnly = [...targetTables].filter((t) => !tables.includes(t)).sort();
  md.push("", `Target-only tables (not in the source, left as they are): ${targetOnly.join(", ") || "none"}.`, "");
  verdicts.tables = { compared: tables.length, failures: tableFailures };

  // 2. Foreign keys.
  const orphans = await orphanCounts(target, "crm");
  const bad = orphans.filter((o) => o.orphans > 0);
  md.push("## Foreign-key integrity (target)", "", `${orphans.length} foreign-key constraints checked; ${bad.length} with orphans.`, "");
  for (const o of bad) md.push(`- ${o.constraint} (${o.child} -> ${o.parent}): ${o.orphans}`);
  verdicts.fk = { constraints: orphans.length, withOrphans: bad.length };

  // 3. Rollups (the stored values are the truth; mismatches are reported, not fixed).
  const rs = await rollupMismatches(source, "public");
  const rt = await rollupMismatches(target, "crm");
  md.push("", "## Client rollups vs recomputation from client_timeline", "",
    "Stored values are copied as-is and are the truth; this only reports where they differ from what `recalculate_client_rollups` would compute today.", "",
    `Clients: source ${rs.clients}, target ${rt.clients}; without any timeline row: ${rs.withoutTimeline} / ${rt.withoutTimeline}; with at least one differing rollup column: ${rs.clientsWithAnyMismatch} / ${rt.clientsWithAnyMismatch}.`, "",
    "| column | clients differing (source) | (target) |", "|---|---:|---:|",
    ...Object.keys(rs.perColumn).map((c) => `| ${c} | ${rs.perColumn[c]} | ${rt.perColumn[c]} |`), "");
  const rollupsIdentical = JSON.stringify(rs) === JSON.stringify(rt);
  md.push(`Source and target rollup results are ${rollupsIdentical ? "identical" : "DIFFERENT"}.`, "");
  if (rs.mismatchedClientIds.length) md.push(`Clients with a differing rollup (first ${rs.mismatchedClientIds.length}, ids only): ${rs.mismatchedClientIds.join(", ")}`, "");
  verdicts.rollups = { identicalBetweenSides: rollupsIdentical, clientsWithAnyMismatch: rs.clientsWithAnyMismatch };

  // 4. Storage.
  const { rows: [docs] } = await target.query(
    `select count(*)::int as documents,
            count(*) filter (where exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = d.storage_path))::int as present
       from crm.documents d`, [TARGET_BUCKET]);
  md.push("## Storage", "", `crm.documents rows: ${docs.documents}; their object present in ${TARGET_BUCKET}: ${docs.present}.`, "");
  verdicts.storage = { documents: docs.documents, present: docs.present };
  if (args["storage-manifest"] && existsSync(args["storage-manifest"])) {
    const manifest = JSON.parse(readFileSync(args["storage-manifest"], "utf8"));
    const verified = manifest.objects.filter((o) => o.verified).length;
    md.push(`Copy manifest: ${manifest.objects.length} source objects, ${verified} verified by size and SHA-256 in the target, ${manifest.objects.filter((o) => o.error).length} errors.`, "");
    verdicts.storage.manifest = { objects: manifest.objects.length, verified };
  } else {
    md.push("No copy manifest supplied: the Storage copy has not been verified.", "");
  }

  const accepted = tableFailures === 0 && bad.length === 0 && docs.present === docs.documents && verdicts.storage.manifest?.verified === verdicts.storage.manifest?.objects && Boolean(verdicts.storage.manifest);
  md.push("## Verdict", "", accepted ? "ACCEPTED" : "NOT ACCEPTED (see the sections above)", "");
  writeFileSync(args.out, md.join("\n"));
  console.log(JSON.stringify({ accepted, ...verdicts }, null, 1));
  await source.query("rollback");
  await target.query("rollback");
  await source.end();
  await target.end();
}

main().catch((error) => {
  console.error(`reconcile failed: ${redactError(error)}`);
  process.exitCode = 1;
});
