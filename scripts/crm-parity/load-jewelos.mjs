// Copies the synthetic fixture from the original stack (schema public) into the local JewelOS
// stack (schema crm) row for row, with triggers off, so both apps read identical rows and ids.
// Then adds the JewelOS side of the identity bridge for the synthetic users. Local only: it
// replaces the rows of the local JewelOS crm schema (synthetic data; `supabase db reset`
// restores the seeded state).
import { ORIGINAL_DB_CONTAINER } from "./original-stack.mjs";
import { copyBetween, psql } from "./util.mjs";

export const JEWELOS_DB_CONTAINER = "supabase_db_jewelos";

const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

export const PARITY_USERS = [
  { key: "super_admin", crmUserId: "c0000000-0000-4000-8000-000000000001", profileId: "0d000000-0000-4000-8000-000000000001", jewelosRole: "super_admin", branch: "a", email: "parity-admin@example.invalid" },
  { key: "branch_manager", crmUserId: "c0000000-0000-4000-8000-000000000002", profileId: "0d000000-0000-4000-8000-000000000002", jewelosRole: "manager", branch: "a", email: "parity-manager@example.invalid" },
  { key: "salesperson", crmUserId: "c0000000-0000-4000-8000-000000000003", profileId: "0d000000-0000-4000-8000-000000000003", jewelosRole: "crm", branch: "a", email: "parity-sales@example.invalid" },
  { key: "salesperson_bandra", crmUserId: "c0000000-0000-4000-8000-000000000004", profileId: "0d000000-0000-4000-8000-000000000004", jewelosRole: "crm", branch: "b", email: "parity-sales-bandra@example.invalid" },
];
export const PARITY_PASSWORD = "parity-local-only";

const TENANT_ID = "0e000000-0000-4000-8000-000000000001";
const JEWELOS_BRANCHES = { a: "0b000000-0000-4000-8000-00000000000a", b: "0b000000-0000-4000-8000-00000000000b", c: "0b000000-0000-4000-8000-00000000000c" };
const CRM_BRANCHES = { a: "a0000000-0000-4000-8000-00000000000a", b: "a0000000-0000-4000-8000-00000000000b", c: "a0000000-0000-4000-8000-00000000000c" };

function quoteIdent(name) {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

export async function copyFixtureToJewelos() {
  const tables = psql(ORIGINAL_DB_CONTAINER, "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name;")
    .split("\n").map((line) => line.trim()).filter((name) => name && !EXCLUDED_TABLES.has(name));
  const portTables = new Set(psql(JEWELOS_DB_CONTAINER, "select table_name from information_schema.tables where table_schema = 'crm' and table_type = 'BASE TABLE';").split("\n").map((line) => line.trim()));
  const missing = tables.filter((name) => !portTables.has(name));
  if (missing.length) throw new Error(`Original tables missing from JewelOS schema crm: ${missing.join(", ")}`);

  psql(JEWELOS_DB_CONTAINER, `set session_replication_role = replica; truncate ${[...portTables].filter(Boolean).map((name) => `crm.${quoteIdent(name)}`).join(", ")};`, { user: "supabase_admin" });
  for (const table of tables) {
    const columns = psql(ORIGINAL_DB_CONTAINER, `select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '${table}' and is_generated = 'NEVER';`);
    await copyBetween(
      ORIGINAL_DB_CONTAINER, `copy (select ${columns} from public.${quoteIdent(table)}) to stdout`,
      JEWELOS_DB_CONTAINER, `set session_replication_role = replica; copy crm.${quoteIdent(table)} (${columns}) from stdin;`,
    );
  }
  const sequences = psql(ORIGINAL_DB_CONTAINER, "select sequencename || '|' || coalesce(last_value::text, '') from pg_sequences where schemaname = 'public';").split("\n").filter(Boolean);
  for (const line of sequences) {
    const [name, value] = line.split("|");
    if (value) psql(JEWELOS_DB_CONTAINER, `select setval('crm.${name}', ${value}, true);`);
  }
  const counts = psql(JEWELOS_DB_CONTAINER, `select string_agg(relname || '=' || n_live, ', ' order by relname) from (select c.relname, (xpath('/row/c/text()', query_to_xml('select count(*) as c from crm.' || quote_ident(c.relname), false, true, '')))[1]::text::int as n_live from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relkind = 'r') t where n_live > 0;`);
  return { tables: tables.length, counts };
}

export function createJewelosIdentity() {
  const users = PARITY_USERS.map((user) => `('${user.crmUserId}', '${user.profileId}', '${user.email}', '${user.jewelosRole}', '${JEWELOS_BRANCHES[user.branch]}', '${user.key}')`).join(",\n");
  psql(JEWELOS_DB_CONTAINER, `
begin;
insert into public.tenants(id, name, slug) values ('${TENANT_ID}', 'CRM Parity (synthetic)', 'crm-parity-synthetic') on conflict (id) do nothing;
insert into public.branches(id, tenant_id, name, code) values
  ('${JEWELOS_BRANCHES.a}', '${TENANT_ID}', 'JewelOS Andheri Parity', 'PARA'),
  ('${JEWELOS_BRANCHES.b}', '${TENANT_ID}', 'JewelOS Bandra Parity', 'PARB'),
  ('${JEWELOS_BRANCHES.c}', '${TENANT_ID}', 'JewelOS Colaba Parity', 'PARC')
on conflict (id) do nothing;
insert into public.departments(id, tenant_id, branch_id, name, code) values
  ('0f000000-0000-4000-8000-00000000000a', '${TENANT_ID}', '${JEWELOS_BRANCHES.a}', 'Parity Sales A', 'PARDA'),
  ('0f000000-0000-4000-8000-00000000000b', '${TENANT_ID}', '${JEWELOS_BRANCHES.b}', 'Parity Sales B', 'PARDB')
on conflict (id) do nothing;
create temporary table parity_users(auth_id uuid, profile_id uuid, email text, role text, branch_id uuid, key text) on commit drop;
insert into parity_users values
${users};
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', auth_id, 'authenticated', 'authenticated', email, crypt('${PARITY_PASSWORD}', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from parity_users on conflict (id) do nothing;
insert into auth.identities(id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), auth_id, auth_id::text, jsonb_build_object('sub', auth_id::text, 'email', email), 'email', now(), now(), now()
from parity_users where not exists (select 1 from auth.identities i where i.user_id = parity_users.auth_id);
insert into public.user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select profile_id, auth_id, '${TENANT_ID}', branch_id,
  case when branch_id = '${JEWELOS_BRANCHES.b}' then '0f000000-0000-4000-8000-00000000000b'::uuid else '0f000000-0000-4000-8000-00000000000a'::uuid end,
  'Parity JewelOS ' || key, '0000000000', email, 'PARITY-' || upper(key), role::user_role, 'active', 'active', true, '{}'
from parity_users
on conflict (id) do update set user_role = excluded.user_role, branch_id = excluded.branch_id, account_status = 'active', is_login_enabled = true, working_status = 'active';
commit;
`);
  // The identity bridge links (0182). Owner-side here because this is a local synthetic
  // fixture; production links go through crm.link_jewelos_profile / link_jewelos_branch.
  psql(JEWELOS_DB_CONTAINER, `
update crm.branches set jewelos_branch_id = case id
  when '${CRM_BRANCHES.a}' then '${JEWELOS_BRANCHES.a}'::uuid
  when '${CRM_BRANCHES.b}' then '${JEWELOS_BRANCHES.b}'::uuid
  when '${CRM_BRANCHES.c}' then '${JEWELOS_BRANCHES.c}'::uuid end
where id in ('${CRM_BRANCHES.a}', '${CRM_BRANCHES.b}', '${CRM_BRANCHES.c}');
${PARITY_USERS.map((user) => `update crm.users set jewelos_profile_id = '${user.profileId}' where id = '${user.crmUserId}';`).join("\n")}
`);
}

/** Fixture ids the states navigate to (clients, queue entries), read from the original. */
export function fixtureIds() {
  const rows = psql(ORIGINAL_DB_CONTAINER, "select name || '|' || id from parity_fixture.ids order by name;").split("\n").filter(Boolean);
  return Object.fromEntries(rows.map((row) => row.split("|")));
}
