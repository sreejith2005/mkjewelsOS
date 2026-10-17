import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Client } from "pg";
import ts from "typescript";

// Scoped generation from the isolated schema. Preserve concurrently edited
// non-FMS generated types instead of replacing either complete Database type.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
assert.equal(root.toLowerCase(), process.cwd().replaceAll("\\", "/").toLowerCase());
const environment = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_jewelos-fms-contract", "--format", "{{json .Config.Env}}"], { encoding: "utf8" }));
const passwordEntry = environment.find(value => value.startsWith("POSTGRES_PASSWORD="));
assert.ok(passwordEntry, "Isolated schema credentials unavailable");
const db = new Client({ host: "127.0.0.1", port: 61322, database: "postgres", user: "postgres", password: passwordEntry.slice("POSTGRES_PASSWORD=".length), connectionTimeoutMillis: 15000 });
const tables = ["fms_stage_assignment_intents", "fms_stage_assignment_decisions"];
const columns = [["fms_flows", "assignment_version"], ["fms_instances", "assignment_version"], ["fms_workflow_mutation_keys", "request_hash"]];
function member(type, name) { assert.ok(ts.isTypeLiteralNode(type)); return type.members.find(item => item.name && item.name.getText().replaceAll('"', "") === name); }
function requiredMember(type, name) { const found = member(type, name); assert.ok(found && ts.isPropertySignature(found) && found.type, `Missing generated ${name}`); return found; }
function typeFor(column) {
  const type = column.udt_name;
  const scalar = type === "jsonb" || type === "json" ? "Json" : type === "bool" ? "boolean" : ["int2", "int4", "int8", "float4", "float8", "numeric"].includes(type) ? "number" : type.startsWith("_") ? `${["_int2", "_int4", "_int8"].includes(type) ? "number" : "string"}[]` : "string";
  return scalar + (column.is_nullable === "YES" ? " | null" : "");
}
async function metadata(table) {
  const result = await db.query("select column_name,udt_name,is_nullable,column_default,is_identity from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [table]);
  assert.ok(result.rows.length, `Missing isolated ${table}`); return result.rows;
}
try {
  await db.connect();
  const additions = new Map();
  for (const table of tables) {
    const rows = await metadata(table);
    const relationships = (await db.query(`select c.conname,ref.relname as referenced_relation,
      array(select a.attname::text from unnest(c.conkey) with ordinality key(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum order by key.n) as columns,
      array(select a.attname::text from unnest(c.confkey) with ordinality key(attnum,n) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum order by key.n) as referenced_columns,
      exists(select 1 from pg_constraint u where u.conrelid=c.conrelid and u.contype in ('u','p') and u.conkey=c.conkey) as one_to_one
      from pg_constraint c join pg_class own on own.oid=c.conrelid join pg_namespace ns on ns.oid=own.relnamespace join pg_class ref on ref.oid=c.confrelid
      where ns.nspname='public' and own.relname=$1 and c.contype='f' order by c.conname`, [table])).rows;
    for (const relationship of relationships) assert.ok(Array.isArray(relationship.columns) && Array.isArray(relationship.referenced_columns), "Invalid relationship column metadata");
    const bodies = ["Row", "Insert", "Update"].map(kind => `        ${kind}: {\n${rows.map(column => `          ${column.column_name}${kind === "Update" || kind === "Insert" && (column.is_nullable === "YES" || column.column_default !== null || column.is_identity === "YES") ? "?" : ""}: ${typeFor(column)}`).join("\n")}\n        }`).join("\n");
    additions.set(table, `      ${table}: {\n${bodies}\n        Relationships: [\n${relationships.map(relation => `          { foreignKeyName: ${JSON.stringify(relation.conname)}; columns: ${JSON.stringify(relation.columns)}; isOneToOne: ${relation.one_to_one}; referencedRelation: ${JSON.stringify(relation.referenced_relation)}; referencedColumns: ${JSON.stringify(relation.referenced_columns)} }`).join(",\n")}\n        ]\n      }`);
  }
  const addedColumns = [];
  for (const [table, name] of columns) addedColumns.push([table, (await metadata(table)).find(column => column.column_name === name)]);
  for (const file of ["packages/core/src/database.types.ts", "packages/api-client/src/database.types.ts"]) {
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const database = ast.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database");
    assert.ok(database && ts.isTypeAliasDeclaration(database));
    const publicType = requiredMember(database.type, "public").type;
    const tableType = requiredMember(publicType, "Tables").type;
    const edits = [];
    for (const [table, body] of additions) {
      const current = member(tableType, table);
      edits.push(current ? { start: current.getStart(), end: current.end, text: body.trimStart() } : { start: tableType.end - 1, end: tableType.end - 1, text: `${body}\n    ` });
    }
    for (const [table, column] of addedColumns) {
      assert.ok(column, `Missing isolated column ${table}`);
      const rowTypes = requiredMember(tableType, table).type;
      for (const kind of ["Row", "Insert", "Update"]) {
        const row = requiredMember(rowTypes, kind).type;
        const text = `${column.column_name}${kind === "Row" ? "" : "?"}: ${typeFor(column)}`;
        const current = member(row, column.column_name);
        edits.push(current ? { start: current.getStart(), end: current.end, text } : { start: row.end - 1, end: row.end - 1, text: `  ${text}\n        ` });
      }
    }
    let next = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    await writeFile(file, next);
  }
  console.log("Synchronized FMS assignment tables and columns from isolated schema; unrelated generated members preserved.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Scoped FMS type generation failed"); process.exitCode = 1;
} finally { await db.end().catch(() => {}); }
