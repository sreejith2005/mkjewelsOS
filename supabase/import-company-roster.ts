import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type RosterRow = {
  rowNumber: number;
  managerEmail: string;
  name: string;
  branch: string;
  department: string;
  designation: string;
  personalMobile: string;
  officialMobile: string;
  loginEmail: string;
  officialEmail: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const normal = (value: string) => clean(value).toUpperCase();
const branchAlias: Record<string, string> = { "ZAVERI BAZAAR": "ZAVERI BAZAR" };
const code = (value: string, fallback: string) => normal(value).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || fallback;
const splitName = (value: string) => { const [first, ...rest] = clean(value).split(" "); return { first, last: rest.join(" ") }; };
const phone = (value: string) => {
  if (/^\+?[0-9][0-9 ()-]{7,19}$/.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
};

function roster(file: string): { rows: RosterRow[]; skipped: number } {
  const rows = readFileSync(resolve(file), "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split("\t").map(clean));
  let skipped = 0;
  const parsed = rows.flatMap((fields, index) => {
    if (fields.length !== 9) { skipped++; return []; }
    const [managerEmail, name, branch, department, designation, personalMobile, officialMobile, personalEmail, officialEmail] = fields;
    const loginEmail = emailPattern.test(personalEmail) ? personalEmail.toLowerCase() : officialEmail.toLowerCase();
    if (!name || !branch || !department || !emailPattern.test(loginEmail)) { skipped++; return []; }
    return [{ rowNumber: index + 1, managerEmail: emailPattern.test(managerEmail) ? managerEmail.toLowerCase() : "", name, branch, department, designation, personalMobile, officialMobile, loginEmail, officialEmail: emailPattern.test(officialEmail) ? officialEmail.toLowerCase() : "" }];
  });
  if (new Set(parsed.map((row) => row.loginEmail)).size !== parsed.length) throw new Error("Roster contains duplicate login emails.");
  return { rows: parsed, skipped };
}

async function main() {
  const [file] = process.argv.slice(2);
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SEED_SUPABASE_SERVICE_ROLE_KEY;
  if (!file || !url || !serviceKey) throw new Error("Usage requires roster file, SUPABASE_URL, and SEED_SUPABASE_SERVICE_ROLE_KEY.");
  const rosterData = roster(file);
  const rows = rosterData.rows;
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: actor, error: actorError } = await db.from("user_profiles").select("id,tenant_id").eq("user_role", "super_admin").eq("account_status", "active").limit(1).single();
  if (actorError || !actor) throw actorError ?? new Error("No active super_admin exists.");
  const [branchResult, profileResult] = await Promise.all([
    db.from("branches").select("id,name").eq("tenant_id", actor.tenant_id),
    db.from("user_profiles").select("id,email,reports_to_user_id").eq("tenant_id", actor.tenant_id),
  ]);
  if (branchResult.error || profileResult.error) throw branchResult.error ?? profileResult.error;
  const branchIds = new Map((branchResult.data ?? []).map((branch) => [normal(branch.name), branch.id]));
  const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.email.toLowerCase(), profile]));
  let created = 0; let existing = 0; let reportingLines = 0;
  for (const row of rows) {
    if (profiles.has(row.loginEmail)) { existing++; continue; }
    const branchId = branchIds.get(branchAlias[normal(row.branch)] ?? normal(row.branch));
    if (!branchId) throw new Error("A roster branch is not configured in JewelOS.");
    let { data: department, error: departmentError } = await db.from("departments").select("id").eq("tenant_id", actor.tenant_id).eq("name", row.department).or(`branch_id.is.null,branch_id.eq.${branchId}`).maybeSingle();
    if (!department && !departmentError) ({ data: department, error: departmentError } = await db.from("departments").insert({ tenant_id: actor.tenant_id, branch_id: branchId, name: row.department, code: code(row.department, "GENERAL"), is_active: true, created_by: actor.id, updated_by: actor.id }).select("id").single());
    if (departmentError || !department) throw departmentError ?? new Error("Could not prepare department.");
    let designationId: string | null = null;
    if (row.designation) {
      const value = code(row.designation, "EMPLOYEE").toLowerCase();
      let { data: designation, error: designationError } = await db.from("dropdown_masters").select("id").eq("tenant_id", actor.tenant_id).eq("master_type", "designation").eq("value", value).maybeSingle();
      if (!designation && !designationError) ({ data: designation, error: designationError } = await db.from("dropdown_masters").insert({ tenant_id: actor.tenant_id, master_type: "designation", label: row.designation, value, is_active: true, created_by: actor.id, updated_by: actor.id }).select("id").single());
      if (designationError || !designation) throw designationError ?? new Error("Could not prepare designation.");
      designationId = designation.id;
    }
    const { data: auth, error: authError } = await db.auth.admin.createUser({ email: row.loginEmail, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true });
    if (authError || !auth.user) throw authError ?? new Error("Could not create employee identity.");
    const name = splitName(row.name);
    const { data: profileId, error: profileError } = await db.rpc("invite_profile_with_audit_v2", { p_auth_user_id: auth.user.id, p_creator_profile_id: actor.id, p_email: row.loginEmail, p_employee_name: row.name, p_branch_id: branchId, p_department_id: department.id, p_designation_id: designationId, p_personal_mobile: phone(row.personalMobile), p_official_mobile: phone(row.officialMobile), p_week_off: [], p_user_role: "staff", p_buddy_id: null });
    if (profileError || !profileId) { await db.auth.admin.deleteUser(auth.user.id); throw new Error(`Roster row ${row.rowNumber} was rejected: ${profileError?.message ?? "employee profile could not be created"}`); }
    const { error: nameError } = await db.from("user_profiles").update({ first_name: name.first, last_name: name.last, updated_by: actor.id }).eq("id", profileId).eq("tenant_id", actor.tenant_id);
    if (nameError) throw nameError;
    profiles.set(row.loginEmail, { id: profileId, email: row.loginEmail, reports_to_user_id: null });
    created++;
  }
  for (const row of rows) {
    const employee = profiles.get(row.loginEmail); const manager = profiles.get(row.managerEmail);
    if (!employee || !manager || employee.id === manager.id || employee.reports_to_user_id === manager.id) continue;
    const { error } = await db.from("user_profiles").update({ reports_to_user_id: manager.id, updated_by: actor.id }).eq("id", employee.id).eq("tenant_id", actor.tenant_id);
    if (error) throw error;
    const { error: auditError } = await db.from("audit_logs").insert({ tenant_id: actor.tenant_id, actor_user_id: actor.id, action: "roster_reporting_line_imported", module: "user_management", record_id: employee.id, new_value: { reports_to_user_id: manager.id } });
    if (auditError) throw auditError;
    reportingLines++;
  }
  console.log(JSON.stringify({ valid_roster_rows: rows.length, skipped_rows: rosterData.skipped, created, existing, reporting_lines: reportingLines }));
}

void main().catch((error: unknown) => {
  const safe = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "code" in error
      ? `Roster import failed with database code ${String(error.code)}: ${"message" in error && typeof error.message === "string" ? error.message : "no message"}`
      : "Roster import failed.";
  console.error(safe);
  process.exitCode = 1;
});
