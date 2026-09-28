// Pure logic of the CRM data import (Phase 5): table selection, lookup/lead-form reconciliation,
// sequence targets, SQL builders, guards and redaction. No I/O here, so it is unit-tested with
// synthetic rows (lib.test.mjs). The importer never prints row values; see redactError.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Original tables that are never imported (SSO artefacts replaced by the identity bridge, and Prisma's ledger). */
export const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  // SSO access grants/audit. The committed SSO migration names them crm_access_grants and
  // crm_sso_audit_logs; production has crm_sso_access_grants and crm_sso_access_audit.
  "crm_access_grants", "crm_sso_audit_logs", "crm_sso_access_grants", "crm_sso_access_audit",
]);

/**
 * Tables that migration 0186_crm_lookup_seed fills in the target before any import, and the
 * natural key each is matched on. They are the only crm tables allowed to be non-empty.
 */
export const SEEDED_TABLES = new Map([
  ["lookup_relations", "label"], ["lookup_sugar_options", "label"], ["lookup_source_of_leads", "label"],
  ["lookup_not_bought_reasons", "label"], ["lookup_beverages", "label"], ["lookup_snacks", "label"],
  ["lookup_gifts", "label"], ["lookup_communities", "label"], ["lookup_product_categories", "label"],
  ["lead_form_fields", "field_key"],
  // Options are keyed by their field's field_key (not its id) and option_value.
  ["lead_form_field_options", "field_key+option_value"],
]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** True when a Postgres URL points at this machine. `--replace-local` is only honoured then. */
export function isLocalDatabaseUrl(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A URL safe to print: host and port for a local target, nothing identifying for a remote one. */
export function describeDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    return LOCAL_HOSTS.has(parsed.hostname) ? `local ${parsed.hostname}:${parsed.port || 5432}` : "remote (host not printed)";
  } catch {
    return "invalid URL";
  }
}

/** Refuses an output path inside a Git working tree: reports hold real data and never belong in a repository. */
export function assertOutsideGit(path) {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(resolve(dir, ".git"))) throw new Error(`refusing to write inside a Git working tree: ${dir}`);
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Postgres errors can quote row values (e.g. "Key (phone)=(...) already exists"). Only the code,
 * the object names and the first line of the message without its quoted values are kept.
 */
export function redactError(error) {
  const parts = [error?.code && `code ${error.code}`, error?.table && `table ${error.table}`, error?.column && `column ${error.column}`, error?.constraint && `constraint ${error.constraint}`]
    .filter(Boolean);
  const message = String(error?.message ?? error).split("\n")[0]
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, "($1)=(…)")
    .replace(/"[^"]*"/g, (quoted) => (/^"[a-z_][a-z0-9_.]*"$/.test(quoted) ? quoted : "\"…\""))
    .replace(/'[^']*'/g, "'…'");
  return [message, ...parts].join("; ");
}

export function quoteIdent(name) {
  return `"${String(name).replaceAll("\"", "\"\"")}"`;
}

/**
 * Chooses the tables to copy. Every source table must exist in the target (else the import
 * stops); target-only tables are reported and left empty.
 */
export function planTables(sourceTables, targetTables) {
  const target = new Set(targetTables);
  const copy = sourceTables.filter((name) => !EXCLUDED_TABLES.has(name)).sort();
  const missing = copy.filter((name) => !target.has(name));
  const excluded = sourceTables.filter((name) => EXCLUDED_TABLES.has(name)).sort();
  const targetOnly = [...target].filter((name) => !sourceTables.includes(name)).sort();
  return { copy, missing, excluded, targetOnly };
}

/**
 * The copied column list for a table: the source's non-generated columns, in source order. The
 * target may have more (the identity-bridge link columns), which stay null; a source column
 * missing from the target stops the import.
 */
export function planColumns(sourceColumns, targetColumns) {
  const target = new Set(targetColumns);
  return { columns: sourceColumns, missing: sourceColumns.filter((name) => !target.has(name)) };
}

/** Tables other than the seeded lookups that already hold rows in the target. */
export function nonEmptyUnseededTables(targetCounts) {
  return Object.entries(targetCounts).filter(([name, count]) => count > 0 && !SEEDED_TABLES.has(name)).map(([name]) => name).sort();
}

/**
 * Seeded-lookup reconciliation. The seeded rows are replaced by the source rows, so every row
 * keeps its SOURCE id. For the record, each seeded row is classified by its natural key:
 *   same     - same key, same id
 *   remapped - same key, different id (target seed id -> source id)
 *   seedOnly - key not in the source (removed; nothing can reference it, the rest of crm is empty)
 *   added    - key only in the source
 * Rows are {id, key}. Returns counts plus the remap list (ids only).
 */
export function reconcileSeeded(sourceRows, targetRows) {
  const sourceByKey = new Map(sourceRows.map((row) => [row.key, row.id]));
  const targetKeys = new Set(targetRows.map((row) => row.key));
  const remap = [];
  let same = 0;
  let seedOnly = 0;
  for (const row of targetRows) {
    if (!sourceByKey.has(row.key)) seedOnly++;
    else if (String(sourceByKey.get(row.key)) === String(row.id)) same++;
    else remap.push({ from: String(row.id), to: String(sourceByKey.get(row.key)) });
  }
  const added = sourceRows.filter((row) => !targetKeys.has(row.key)).length;
  return { same, remapped: remap.length, seedOnly, added, remap };
}

/**
 * Where a sequence must stand after the load: never below the source's position and never
 * below the highest value already used, so the next value is max+1 and no code is reused.
 * `sourceLast` is null when the source sequence was never called.
 */
export function sequenceTarget({ sourceLast, sourceCalled, columnMax }) {
  const candidates = [columnMax, sourceCalled ? sourceLast : null].filter((value) => value !== null && value !== undefined).map(BigInt);
  if (candidates.length === 0) return null; // untouched: nextval still returns the start value
  return candidates.reduce((a, b) => (a > b ? a : b)).toString();
}

/** Numeric part of a client code such as MKC-000042; codes in another shape are ignored. */
export function clientCodeNumber(code) {
  const match = /^MKC-(\d+)$/.exec(code ?? "");
  return match ? BigInt(match[1]) : null;
}

/**
 * Content hash of a table over the given columns, ordered by the primary key (or every column
 * when there is none). Both sides run the same statement with the same session settings
 * (UTC, ISO dates, extra_float_digits), so equal rows give equal hashes.
 */
export function contentHashSql(schema, table, columns, orderColumns) {
  const cols = columns.map((name) => `t.${quoteIdent(name)}`).join(", ");
  const order = (orderColumns.length ? orderColumns.map((name) => `t.${quoteIdent(name)}`).join(", ") : cols);
  return `select count(*)::bigint as rows, md5(coalesce(string_agg(md5(row(${cols})::text), '' order by ${order}), '')) as hash from ${quoteIdent(schema)}.${quoteIdent(table)} as t`;
}

/** Session settings that make text renderings identical on both sides. */
export const HASH_SESSION_SQL = "set timezone = 'UTC'; set datestyle = 'ISO, MDY'; set intervalstyle = 'postgres'; set extra_float_digits = 3; set bytea_output = 'hex';";

/** One checksum over the per-table source hashes, in table order (sha-256 hex of "table:rows:hash\n"...). */
export function combinedChecksumInput(tableHashes) {
  return Object.keys(tableHashes).sort().map((name) => `${name}:${tableHashes[name].rows}:${tableHashes[name].hash}\n`).join("");
}

/** The single audit summary written for an import: counts and a checksum, never customer values. */
export function auditSummary({ counts, sourceChecksum, seeded, excluded, sequences, startedAt }) {
  return {
    kind: "crm_legacy_data_import",
    started_at: startedAt,
    tables: Object.keys(counts).length,
    rows: counts,
    total_rows: Object.values(counts).reduce((sum, n) => sum + n, 0),
    source_checksum_sha256: sourceChecksum,
    seeded_lookups: Object.fromEntries(Object.entries(seeded).map(([name, r]) => [name, { same: r.same, remapped: r.remapped, seed_only_removed: r.seedOnly, added: r.added }])),
    excluded_tables: excluded,
    sequences,
  };
}

/** Parses `--name=value` / `--flag` arguments. */
export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unexpected argument: ${arg}`);
    out[match[1]] = match[2] ?? true;
  }
  return out;
}
