/* Local/admin roster importer. Usage: pnpm tsx supabase/import-roster.ts <tab-separated-file> */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(async () => {
const [file] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SEED_SUPABASE_SERVICE_ROLE_KEY;
if (!file || !url || !key) throw new Error("Usage requires a file plus SUPABASE_URL and SEED_SUPABASE_SERVICE_ROLE_KEY.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const aliases: Record<string, string> = { "ZAVERI BAZAAR": "ZAVERI BAZAR", "HOUSE KEEPING": "HOUSEKEEPING" };
const rows = readFileSync(resolve(file), "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
  const [email, name, branch, department, designation] = line.split("\t").map((value) => value.trim());
  return { email: email.toLowerCase(), name, branch: aliases[normalise(branch)] ?? normalise(branch), department: aliases[normalise(department)] ?? normalise(department), designation: normalise(designation) };
});
const valid = rows.filter((row) => row.email && row.name && row.branch && row.department);
const skipped = rows.length - valid.length;
const { data: actor, error: actorError } = await db.from("user_profiles").select("id,tenant_id").eq("user_role", "super_admin").eq("account_status", "active").limit(1).single();
if (actorError || !actor) throw actorError ?? new Error("No active super admin exists.");
const { data: branches, error: branchesError } = await db.from("branches").select("id,name").eq("tenant_id", actor.tenant_id);
if (branchesError) throw branchesError;
const branchByName = new Map(branches.map((branch) => [normalise(branch.name), branch.id]));
let inserted = 0; let existing = 0;
for (const row of valid) {
  const branchId = branchByName.get(row.branch);
  if (!branchId) throw new Error(`Unknown branch: ${row.branch}`);
  const code = row.department.replace(/[^A-Z0-9]/g, "").slice(0, 12) || "GENERAL";
  let { data: department, error: departmentError } = await db.from("departments").select("id").eq("tenant_id", actor.tenant_id).eq("name", row.department).maybeSingle();
  if (!department && !departmentError) ({ data: department, error: departmentError } = await db.from("departments").insert({ tenant_id: actor.tenant_id, name: row.department, code, is_active: true, created_by: actor.id, updated_by: actor.id }).select("id").single());
  if (departmentError || !department) throw departmentError ?? new Error("Department create failed");
  let designationId: string | null = null;
  if (row.designation) { const value = row.designation.toLowerCase().replace(/[^a-z0-9]+/g, "_"); let { data, error } = await db.from("dropdown_masters").select("id").eq("tenant_id", actor.tenant_id).eq("master_type", "designation").eq("value", value).maybeSingle(); if (!data && !error) ({ data, error } = await db.from("dropdown_masters").insert({ tenant_id: actor.tenant_id, master_type: "designation", label: row.designation, value, is_active: true, created_by: actor.id, updated_by: actor.id }).select("id").single()); if (error || !data) throw error ?? new Error("Designation create failed"); designationId = data.id; }
  const { data: prior, error: priorError } = await db.from("user_profiles").select("id").eq("email", row.email).maybeSingle(); if (priorError) throw priorError; if (prior) { existing++; continue; }
  const { data: auth, error: authError } = await db.auth.admin.createUser({ email: row.email, email_confirm: false }); if (authError || !auth.user) throw authError ?? new Error("Auth user create failed");
  const { error: profileError } = await db.rpc("invite_profile_with_audit_v2", { p_auth_user_id: auth.user.id, p_creator_profile_id: actor.id, p_email: row.email, p_employee_name: row.name, p_branch_id: branchId, p_department_id: department.id, p_designation_id: designationId, p_personal_mobile: "", p_official_mobile: "", p_week_off: [], p_user_role: "staff", p_buddy_id: null }); if (profileError) throw profileError;
  inserted++;
}
console.log(JSON.stringify({ inserted, existing, skipped }, null, 2));
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
