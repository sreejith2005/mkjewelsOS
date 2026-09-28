// D5 (owner decision 2026-09-28): a unique tie-breaker - the table's primary key, in the same
// direction as the last sort key - is added to every ORDER BY in the ported CRM that can tie, so
// results are deterministic and the dashboard's 1000-row paging cannot skip or duplicate rows.
//
// This list is the single definition of those edits:
//   - the port (packages/crm-ui/src and migration 0190) carries them, each marked
//     `crm-port: deterministic order` (checked by deterministic-order.test.mjs);
//   - the parity harnesses apply the SAME edits to the ORIGINAL at run time only: UI_EDITS to a
//     temporary copy of the original app (original-copy.mjs) and SQL_EDITS to the function
//     definitions in the throwaway/restored original database (applySqlEditsToOriginal). The
//     original under sreejith-crm/ is never edited.
//
// Orders that cannot tie are left alone: lookup `label`, `branches.name` (unique), and
// `crm_allocation.crm_name` when filtered by one branch (unique per branch).

export const MARK = "crm-port: deterministic order";

/** Edits to original UI files (paths relative to the original web-app / packages/crm-ui/src). */
export const UI_EDITS = [
  {
    file: "app/(crm)/clients/page.tsx",
    find: '.order("created_at", { ascending: false }).limit(1000)',
    replace: `.order("created_at", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */.limit(1000)`,
    count: 1,
  },
  {
    file: "app/(crm)/clients/[clientId]/page.tsx",
    find: '.order("created_at", { ascending: false }).order("event_date", { ascending: false })',
    replace: `.order("created_at", { ascending: false }).order("event_date", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */`,
    count: 1,
  },
  {
    file: "app/(crm)/clients/[clientId]/page.tsx",
    find: 'edited_by").eq("client_id", clientId).order("created_at", { ascending: false })',
    replace: `edited_by").eq("client_id", clientId).order("created_at", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */`,
    count: 1,
  },
  {
    file: "app/(crm)/dashboard/page.tsx",
    find: '.order("event_date", { ascending: false }).range(offset, offset + 999)',
    replace: `.order("event_date", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */.range(offset, offset + 999)`,
    count: 1,
  },
  {
    file: "app/(crm)/followups/page.tsx",
    find: '.order("created_at",{ascending:false})',
    replace: `.order("created_at",{ascending:false}).order("id",{ascending:false}) /* ${MARK} */`,
    count: 1,
  },
  {
    file: "app/(crm)/leads/new/page.tsx",
    find: '.order("display_order")',
    replace: `.order("display_order").order("id") /* ${MARK} */`,
    count: 2,
  },
  {
    file: "app/(crm)/queue/page.tsx",
    find: '.order("display_order")',
    replace: `.order("display_order").order("id") /* ${MARK} */`,
    count: 2,
  },
  {
    file: "app/(crm)/queue/page.tsx",
    find: '.eq("active", true).order("created_at")',
    replace: `.eq("active", true).order("created_at").order("id") /* ${MARK} */`,
    count: 1,
  },
  {
    file: "app/(crm)/queue/page.tsx",
    find: '.order("created_at", { ascending: false })',
    replace: `.order("created_at", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */`,
    count: 2,
  },
  {
    file: "app/(crm)/referrals/page.tsx",
    find: '.order("created_at", { ascending: false })',
    replace: `.order("created_at", { ascending: false }).order("id", { ascending: false }) /* ${MARK} */`,
    count: 1,
  },
  {
    // The roster query is not filtered by branch, so crm_name can repeat across branches.
    file: "app/(crm)/visits/new/page.tsx",
    find: '.select("branch_id,crm_name").eq("active", true).order("crm_name")',
    replace: `.select("branch_id,crm_name").eq("active", true).order("crm_name").order("id") /* ${MARK} */`,
    count: 1,
  },
];

/** Edits to original SQL function bodies (schema-neutral text; `fn` is the unqualified name). */
export const SQL_EDITS = [
  {
    fn: "browse_clients",
    find: "ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name\n",
    replace: `ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name, client.client_id -- ${MARK}\n`,
    count: 1,
  },
  {
    fn: "search_clients",
    find: "ORDER BY (pi.phone = right(input.digits, 10)) DESC LIMIT 1",
    replace: `ORDER BY (pi.phone = right(input.digits, 10)) DESC, pi.phone DESC /* ${MARK} */ LIMIT 1`,
    count: 1,
  },
  {
    fn: "search_clients",
    find: "c.last_visit_date DESC NULLS LAST, c.primary_name LIMIT",
    replace: `c.last_visit_date DESC NULLS LAST, c.primary_name, c.client_id /* ${MARK} */ LIMIT`,
    count: 1,
  },
  {
    fn: "create_not_bought_followup_from_visit_form",
    find: 'ORDER BY "created_at" FOR UPDATE LIMIT 1;',
    replace: `ORDER BY "created_at", "id" /* ${MARK} */ FOR UPDATE LIMIT 1;`,
    count: 1,
  },
];

function occurrences(text, needle) {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Applies the edits for one file/function to `text`; throws unless every `find` occurs exactly `count` times. */
export function applyEdits(text, edits, label) {
  let out = text;
  for (const edit of edits) {
    const found = occurrences(out, edit.find);
    if (found !== edit.count) throw new Error(`${label}: expected ${edit.count} x ${JSON.stringify(edit.find)}, found ${found}`);
    out = out.split(edit.find).join(edit.replace);
  }
  return out;
}

export function uiEditsByFile() {
  const map = new Map();
  for (const edit of UI_EDITS) map.set(edit.file, [...(map.get(edit.file) ?? []), edit]);
  return map;
}

/**
 * Applies SQL_EDITS to the ORIGINAL database's functions in `schema` (the throwaway or restored
 * local copy only). `query` is a pg-style `(sql, params) => Promise<{ rows }>`. Idempotent: a
 * function that already carries the marker is left alone.
 */
export async function applySqlEditsToOriginal(query, schema = "public") {
  const applied = [];
  const byFn = new Map();
  for (const edit of SQL_EDITS) byFn.set(edit.fn, [...(byFn.get(edit.fn) ?? []), edit]);
  for (const [fn, edits] of byFn) {
    const { rows } = await query(
      "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2",
      [schema, fn],
    );
    if (rows.length !== 1) throw new Error(`original function ${schema}.${fn}: expected 1 definition, found ${rows.length}`);
    if (rows[0].def.includes(MARK)) continue;
    await query(applyEdits(rows[0].def, edits, `${schema}.${fn}`));
    applied.push(fn);
  }
  return applied;
}
