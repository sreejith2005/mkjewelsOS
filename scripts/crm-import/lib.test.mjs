// Unit tests for the CRM import logic, with synthetic rows only.  node --test scripts/crm-import/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  assertOutsideGit, auditSummary, clientCodeNumber, combinedChecksumInput, contentHashSql, describeDatabaseUrl,
  isLocalDatabaseUrl, nonEmptyUnseededTables, parseArgs, planColumns, planTables, reconcileSeeded, redactError, sequenceTarget,
} from "./lib.mjs";

test("local targets are recognised; remote hosts are not printed", () => {
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:57322/postgres"), true);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@localhost/postgres"), true);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@db.example.supabase.co:5432/postgres"), false);
  assert.equal(isLocalDatabaseUrl("not a url"), false);
  assert.equal(describeDatabaseUrl("postgresql://postgres:secret@127.0.0.1:57322/postgres"), "local 127.0.0.1:57322");
  const remote = describeDatabaseUrl("postgresql://postgres:secret@db.example.supabase.co:5432/postgres");
  assert.equal(remote, "remote (host not printed)");
  assert.doesNotMatch(remote, /secret|example/);
});

test("excluded SSO tables and the Prisma ledger are never copied; a missing target table is reported", () => {
  const plan = planTables(
    ["clients", "_prisma_migrations", "crm_sso_access_grants", "crm_sso_access_audit", "crm_access_grants", "crm_sso_audit_logs", "users", "extra_original"],
    ["clients", "users", "legacy_walkin_ingest_attempts"],
  );
  assert.deepEqual(plan.copy, ["clients", "extra_original", "users"]);
  assert.deepEqual(plan.missing, ["extra_original"]);
  assert.deepEqual(plan.excluded, ["_prisma_migrations", "crm_access_grants", "crm_sso_access_audit", "crm_sso_access_grants", "crm_sso_audit_logs"]);
  assert.deepEqual(plan.targetOnly, ["legacy_walkin_ingest_attempts"]);
});

test("the target may have extra link columns; a missing source column stops the import", () => {
  assert.deepEqual(planColumns(["id", "name"], ["id", "name", "jewelos_profile_id"]), { columns: ["id", "name"], missing: [] });
  assert.deepEqual(planColumns(["id", "legacy_col"], ["id"]).missing, ["legacy_col"]);
});

test("only seeded lookup tables may already hold rows", () => {
  assert.deepEqual(nonEmptyUnseededTables({ lookup_gifts: 7, lead_form_fields: 30, lead_form_field_options: 90, clients: 0 }), []);
  assert.deepEqual(nonEmptyUnseededTables({ lookup_gifts: 7, clients: 2, users: 1 }), ["clients", "users"]);
});

test("seeded rows are classified by natural key and source ids win", () => {
  const source = [{ id: "s1", key: "DIYA" }, { id: "s2", key: "UMBRELLA" }, { id: "s3", key: "ONLY IN SOURCE" }];
  const target = [{ id: "s1", key: "DIYA" }, { id: "t2", key: "UMBRELLA" }, { id: "t9", key: "ONLY IN SEED" }];
  const result = reconcileSeeded(source, target);
  assert.deepEqual({ same: result.same, remapped: result.remapped, seedOnly: result.seedOnly, added: result.added }, { same: 1, remapped: 1, seedOnly: 1, added: 1 });
  assert.deepEqual(result.remap, [{ from: "t2", to: "s2" }]);
});

test("sequences move past the highest value in use and never behind the source", () => {
  assert.equal(sequenceTarget({ sourceLast: "1040", sourceCalled: true, columnMax: "1042" }), "1042");
  assert.equal(sequenceTarget({ sourceLast: "1050", sourceCalled: true, columnMax: "1042" }), "1050");
  assert.equal(sequenceTarget({ sourceLast: "1", sourceCalled: false, columnMax: null }), null);
  assert.equal(sequenceTarget({ sourceLast: null, sourceCalled: false, columnMax: "7" }), "7");
  assert.equal(clientCodeNumber("MKC-000042"), 42n);
  assert.equal(clientCodeNumber("LEGACY-9"), null);
});

test("content hash SQL orders by the primary key and quotes identifiers", () => {
  const sql = contentHashSql("crm", "client_timeline", ["id", "client_id", "event_date"], ["id"]);
  assert.match(sql, /order by t\."id"\)/);
  assert.match(sql, /from "crm"\."client_timeline" as t$/);
  assert.match(contentHashSql("crm", "t", ["a", "b"], []), /order by t\."a", t\."b"\)/);
});

test("the source checksum input is order-independent of object key order", () => {
  const a = combinedChecksumInput({ users: { rows: 2, hash: "h2" }, clients: { rows: 1, hash: "h1" } });
  const b = combinedChecksumInput({ clients: { rows: 1, hash: "h1" }, users: { rows: 2, hash: "h2" } });
  assert.equal(a, b);
  assert.equal(a, "clients:1:h1\nusers:2:h2\n");
});

test("the audit summary carries counts and a checksum only", () => {
  const summary = auditSummary({
    counts: { clients: 3, users: 2 }, sourceChecksum: "abc", excluded: ["_prisma_migrations"], sequences: {}, startedAt: "2026-09-28T00:00:00Z",
    seeded: { lookup_gifts: { same: 1, remapped: 2, seedOnly: 0, added: 1, remap: [{ from: "t", to: "s" }] } },
  });
  assert.equal(summary.total_rows, 5);
  assert.deepEqual(summary.seeded_lookups.lookup_gifts, { same: 1, remapped: 2, seed_only_removed: 0, added: 1 });
  assert.equal(JSON.stringify(summary).includes("\"remap\""), false);
});

test("errors are redacted: quoted values and key values are removed", () => {
  const error = Object.assign(new Error('duplicate key value violates unique constraint "clients_primary_phone_key"\nDETAIL: Key (primary_phone)=(9876543210) already exists.'), { code: "23505", table: "clients", constraint: "clients_primary_phone_key" });
  const text = redactError(error);
  assert.match(text, /code 23505/);
  assert.match(text, /"clients_primary_phone_key"/);
  assert.doesNotMatch(text, /9876543210/);
  assert.match(redactError(new Error("Key (phone)=(98765) exists")), /\(phone\)=\(…\)/);
  assert.doesNotMatch(redactError(new Error("invalid input value 'Asha Mehta'")), /Asha/);
  assert.doesNotMatch(redactError(new Error('bad "Asha Mehta" value')), /Asha/);
});

test("reports are refused inside a Git working tree", () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  assert.throws(() => assertOutsideGit(join(repoRoot, "scripts", "report.json")), /inside a Git working tree/);
  const outside = mkdtempSync(join(tmpdir(), "crm-import-test-"));
  try {
    assert.doesNotThrow(() => assertOutsideGit(join(outside, "report.json")));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("arguments", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--report=C:\\x\\r.json"]), { "dry-run": true, report: "C:\\x\\r.json" });
  assert.throws(() => parseArgs(["positional"]), /unexpected argument/);
});
