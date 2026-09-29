// Catalog reads, hashes and integrity checks shared by import.mjs and reconcile.mjs.
// Every function takes a connected pg client and returns counts, names and hashes only.
import { contentHashSql, HASH_SESSION_SQL, quoteIdent } from "./lib.mjs";

export async function applyHashSession(client) {
  await client.query(HASH_SESSION_SQL);
}

export async function listTables(client, schema) {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE' order by table_name",
    [schema],
  );
  return rows.map((row) => row.table_name);
}

/** Non-generated columns in ordinal order. */
export async function listColumns(client, schema, table) {
  const { rows } = await client.query(
    "select column_name from information_schema.columns where table_schema = $1 and table_name = $2 and is_generated = 'NEVER' order by ordinal_position",
    [schema, table],
  );
  return rows.map((row) => row.column_name);
}

export async function primaryKey(client, schema, table) {
  const { rows } = await client.query(
    `select a.attname from pg_index i
       join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
       join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
     where i.indisprimary and n.nspname = $1 and c.relname = $2 order by k.ord`,
    [schema, table],
  );
  return rows.map((row) => row.attname);
}

export async function rowCount(client, schema, table) {
  const { rows } = await client.query(`select count(*)::bigint as n from ${quoteIdent(schema)}.${quoteIdent(table)}`);
  return Number(rows[0].n);
}

export async function tableHash(client, schema, table, columns, orderColumns) {
  const { rows } = await client.query(contentHashSql(schema, table, columns, orderColumns));
  return { rows: Number(rows[0].rows), hash: rows[0].hash };
}

/**
 * Rows whose foreign-key columns (all non-null) have no parent, per FK constraint of the schema.
 * Needed because a load with session_replication_role = replica does not check foreign keys.
 */
export async function orphanCounts(client, schema) {
  const { rows: constraints } = await client.query(
    `select con.conname, cn.nspname as child_schema, cc.relname as child_table, pn.nspname as parent_schema, pc.relname as parent_table,
            array(select a.attname from unnest(con.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as child_cols,
            array(select a.attname from unnest(con.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as parent_cols
       from pg_constraint con
       join pg_class cc on cc.oid = con.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
       join pg_class pc on pc.oid = con.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
      where con.contype = 'f' and cn.nspname = $1 order by con.conname`,
    [schema],
  );
  const results = [];
  for (const c of constraints) {
    const notNull = c.child_cols.map((col) => `ch.${quoteIdent(col)} is not null`).join(" and ");
    const join = c.child_cols.map((col, i) => `p.${quoteIdent(c.parent_cols[i])} = ch.${quoteIdent(col)}`).join(" and ");
    const { rows } = await client.query(
      `select count(*)::bigint as n from ${quoteIdent(c.child_schema)}.${quoteIdent(c.child_table)} ch
        where ${notNull} and not exists (select 1 from ${quoteIdent(c.parent_schema)}.${quoteIdent(c.parent_table)} p where ${join})`,
    );
    results.push({ constraint: c.conname, child: `${c.child_schema}.${c.child_table}`, parent: `${c.parent_schema}.${c.parent_table}`, orphans: Number(rows[0].n) });
  }
  return results;
}

/** Sequences of a schema with their owning column (if any) and position. */
export async function listSequences(client, schema) {
  const { rows } = await client.query(
    `select s.sequencename as name, s.last_value::text as last_value, (s.last_value is not null) as called,
            t.relname as owner_table, a.attname as owner_column, format_type(a.atttypid, a.atttypmod) as owner_type
       from pg_sequences s
       join pg_namespace n on n.nspname = s.schemaname
       join pg_class sc on sc.relname = s.sequencename and sc.relnamespace = n.oid
       left join pg_depend d on d.objid = sc.oid and d.deptype in ('a', 'i') and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
       left join pg_class t on t.oid = d.refobjid
       left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      where s.schemaname = $1 order by s.sequencename`,
    [schema],
  );
  return rows;
}

/** Highest value in use by a sequence's owning column: integers directly, client codes (MKC-<n>) by their number. */
export async function columnMax(client, schema, table, column, type) {
  const col = quoteIdent(column);
  const sql = /int|numeric/.test(type)
    ? `select max(${col})::text as m from ${quoteIdent(schema)}.${quoteIdent(table)}`
    : `select max((regexp_match(${col}, '^MKC-(\\d+)$'))[1]::bigint)::text as m from ${quoteIdent(schema)}.${quoteIdent(table)}`;
  const { rows } = await client.query(sql);
  return rows[0].m;
}

/**
 * Client rollups compared with a recomputation from client_timeline, using the rules of
 * crm.recalculate_client_rollups (counts by buy_status, first/last event_date, and the latest
 * event's fields by event_date, created_at, id; a client without timeline rows keeps the column
 * defaults, i.e. empty category arrays). Returns mismatch counts per column only; the
 * stored values are the truth and are never changed.
 */
export async function rollupMismatches(client, schema) {
  const s = quoteIdent(schema);
  const columns = {
    total_visits: "coalesce(a.total_visits, 0)",
    total_purchase_visits: "coalesce(a.total_purchase_visits, 0)",
    total_non_purchase_visits: "coalesce(a.total_non_purchase_visits, 0)",
    total_repair_visits: "coalesce(a.total_repair_visits, 0)",
    total_order_visits: "coalesce(a.total_order_visits, 0)",
    first_visit_date: "a.first_visit_date",
    last_visit_date: "a.last_visit_date",
    last_buy_status: "l.buy_status",
    last_branch_id: "l.branch_id",
    last_crm_name: "l.crm_name",
    last_salesperson_id: "l.salesperson_id",
    last_remark: "l.remark",
    last_product_requirement: "l.product_requirement",
    last_seen_categories: "case when l.client_id is null then array[]::text[] else l.seen_categories end",
    last_bought_categories: "case when l.client_id is null then array[]::text[] else l.bought_categories end",
    last_order_categories: "case when l.client_id is null then array[]::text[] else l.order_categories end",
  };
  const selects = Object.entries(columns).map(([name, expr]) =>
    `count(*) filter (where c.${quoteIdent(name)} is distinct from ${expr})::bigint as ${quoteIdent(name)}`).join(",\n");
  const any = Object.entries(columns).map(([name, expr]) => `c.${quoteIdent(name)} is distinct from ${expr}`).join(" or ");
  const recomputed = `
    with a as (
      select t.client_id, count(*)::integer as total_visits,
        count(*) filter (where t.buy_status in ('YES', 'YES_AND_ORDER_PLACED'))::integer as total_purchase_visits,
        count(*) filter (where t.buy_status in ('NO', 'PRODUCT_RETURN', 'STORE_VISIT', 'PRICE_CALCULATION'))::integer as total_non_purchase_visits,
        count(*) filter (where t.buy_status::text like 'REPAIR_PLACED%' or t.buy_status::text like 'REPAIR_PICKUP%')::integer as total_repair_visits,
        count(*) filter (where t.buy_status::text like 'ORDER_PLACED%' or t.buy_status::text like 'ORDER_PICKUP%')::integer as total_order_visits,
        min(t.event_date) as first_visit_date, max(t.event_date) as last_visit_date
      from ${s}.client_timeline t group by t.client_id
    ), l as (
      select distinct on (t.client_id) t.*
      from ${s}.client_timeline t order by t.client_id, t.event_date desc, t.created_at desc, t.id desc
    )`;
  const joined = `from ${s}.clients c left join a on a.client_id = c.client_id left join l on l.client_id = c.client_id`;
  const { rows } = await client.query(`${recomputed}
    select count(*)::bigint as clients,
      count(*) filter (where a.client_id is null)::bigint as clients_without_timeline,
      count(*) filter (where ${any})::bigint as clients_with_any_mismatch,
      ${selects}
    ${joined}`);
  const result = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
  const { clients, clients_without_timeline: withoutTimeline, clients_with_any_mismatch: clientsWithAnyMismatch, ...perColumn } = result;
  const { rows: ids } = await client.query(`${recomputed} select c.client_id::text as id ${joined} where ${any} order by c.client_id limit 50`);
  return { clients, withoutTimeline, clientsWithAnyMismatch, perColumn, mismatchedClientIds: ids.map((row) => row.id) };
}
