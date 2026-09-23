// Reconciles Supabase Auth and user profiles with an approved employee sheet.
//
//   node scripts/reconcile-employee-roster.mjs --dry-run|--apply <roster.tsv> [--report <file>] [--payload <file>]
//
// The sheet is the HR export pasted as tab-separated text: EMPLOYEE NAME,
// BRANCH, DEPARTMENT, DESIGNATION, PERSONAL MOBILE, OFFICIAL MOBILE, PERSONAL
// EMAIL, WORK EMAIL, WEEK OFF, USERROLE, EMPLOYEE CODE and an optional
// INITIAL PASSWORD. The password defaults to the first six digits of the
// personal (else official) mobile. Keep the sheet out of Git: it holds
// personal contact data and, with overrides, passwords.
//
// Kept profiles are updated in place so their linked work survives. Profiles
// missing from the sheet are retired; an exact-name duplicate hands its links
// to the kept record first. Retired profiles with no linked records are then
// deleted. stdout carries counts only; --report writes the per-person plan.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const weekdays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const branchAliases = new Map([["ZAVERI BAZAAR", "ZAVERI BAZAR"]]);
const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normal = (value) => clean(value).toLocaleUpperCase("en-IN");
const compact = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (value) => String(value ?? "").replace(/\D/g, "");

function loadCredentials() {
  const file = new URL("../.env", import.meta.url);
  const env = existsSync(file) ? Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, "")]; })) : {};
  const url = process.env.SUPABASE_URL ?? env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SEED_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or the repository .env).");
  return { url, key };
}

function parseRoster(file) {
  const problems = [];
  const rows = readFileSync(file, "utf8").split(/\r?\n/).map((line, index) => ({ line, rowNumber: index + 1 }))
    .filter(({ line }) => line.trim() && !/^\s*EMPLOYEE NAME\t/i.test(line))
    .map(({ line, rowNumber }) => {
      const [employeeName, branch, department, designation, personalMobile, officialMobile, personalEmail, workEmail, weekOff, level, employeeCode, password] =
        [...line.split("\t"), "", "", "", ""].slice(0, 12).map(clean);
      const [firstName, ...rest] = employeeName.split(" ");
      const lastName = rest.join(" ");
      const initialPassword = password || digits(personalMobile).slice(0, 6) || digits(officialMobile).slice(0, 6);
      const row = {
        rowNumber, employeeName: normal(employeeName), firstName: normal(firstName), lastName: normal(lastName) || null,
        username: `${compact(firstName)}${compact(lastName)}`,
        branch: branchAliases.get(normal(branch)) ?? normal(branch), department: normal(department), designation: clean(designation),
        personalMobile: digits(personalMobile) || null, officialMobile: digits(officialMobile) || null,
        // Personal email is contact data only; a malformed value is left empty.
        personalEmail: emailPattern.test(personalEmail) ? personalEmail.toLowerCase() : null,
        workEmail: workEmail.toLowerCase(), weekOff: weekOff ? [weekOff.toLowerCase()] : [],
        level: level.toUpperCase(), employeeCode: employeeCode || null, initialPassword,
      };
      const invalid = [
        !row.employeeName && "name", !row.branch && "branch", !row.department && "department", !row.designation && "designation",
        !/^[a-z0-9]{2,80}$/.test(row.username) && "username", !emailPattern.test(row.workEmail) && "work email",
        row.personalMobile && row.personalMobile.length !== 10 && "personal mobile",
        row.officialMobile && row.officialMobile.length !== 10 && "official mobile",
        row.weekOff.some((day) => !weekdays.has(day)) && "week off", !["ADMIN", "USER"].includes(row.level) && "user role",
        !/^\S{6,128}$/.test(initialPassword) && "password",
      ].filter(Boolean);
      if (invalid.length) problems.push(`row ${rowNumber}: ${invalid.join(", ")}`);
      return row;
    });
  for (const field of ["workEmail", "username", "employeeCode"]) {
    const values = rows.map((row) => row[field]).filter(Boolean);
    if (new Set(values).size !== values.length) problems.push(`duplicate ${field}`);
  }
  if (problems.length) throw new Error(`The roster is invalid; no changes were made.\n${problems.join("\n")}`);
  return rows;
}

// Picks the one profile each sheet row refers to. Work email and phones
// outrank the name, so a stale duplicate never wins over the maintained record.
function matchRoster(rows, profiles) {
  const matches = new Map(); const problems = [];
  for (const row of rows) {
    const ranked = profiles.map((profile) => ({
      profile,
      score: (compact(profile.employee_name) === compact(row.employeeName) ? 3 : 0)
        + ([profile.email, profile.official_email].some((value) => value && value.toLowerCase() === row.workEmail) ? 10 : 0)
        + (row.personalMobile && [profile.personal_mobile, profile.official_mobile].some((value) => digits(value).endsWith(row.personalMobile)) ? 5 : 0)
        + (row.officialMobile && row.officialMobile !== row.personalMobile && [profile.personal_mobile, profile.official_mobile].some((value) => digits(value).endsWith(row.officialMobile)) ? 5 : 0),
    })).filter((item) => item.score > 0).sort((left, right) => right.score - left.score);
    if (!ranked.length) continue; // a new employee
    if (ranked[0].score === ranked[1]?.score) { problems.push(`row ${row.rowNumber} is ambiguous`); continue; }
    if ([...matches.values()].includes(ranked[0].profile)) { problems.push(`row ${row.rowNumber} matches an already matched profile`); continue; }
    matches.set(row, ranked[0].profile);
  }
  if (problems.length) throw new Error(`Roster matching failed; no changes were made.\n${problems.join("\n")}`);
  return matches;
}

async function main() {
  const [mode, file, ...options] = process.argv.slice(2);
  const option = (name) => { const at = options.indexOf(name); return at >= 0 ? options[at + 1] : undefined; };
  const reportFile = option("--report"); const payloadFile = option("--payload");
  if (!file || !["--dry-run", "--apply"].includes(mode) || options.length % 2 || options.some((value, at) => at % 2 === 0 && !["--report", "--payload"].includes(value))) {
    throw new Error("Usage: node scripts/reconcile-employee-roster.mjs --dry-run|--apply <roster.tsv> [--report <file>] [--payload <file>]");
  }
  const { url, key } = loadCredentials();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = parseRoster(file);

  const { data: actor, error: actorError } = await db.from("user_profiles").select("id,tenant_id")
    .eq("user_role", "super_admin").eq("account_status", "active").eq("is_login_enabled", true)
    .order("created_at").limit(1).single();
  if (actorError || !actor) throw new Error("No active Super Admin exists.");
  const { data: profiles, error: profilesError } = await db.from("user_profiles")
    .select("id,auth_user_id,employee_name,employee_code,username,email,official_email,personal_mobile,official_mobile,account_status")
    .eq("tenant_id", actor.tenant_id);
  if (profilesError || !profiles) throw new Error("Profiles could not be loaded.");
  const { data: authPage, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) throw new Error("Auth users could not be loaded.");
  const authById = new Map(authPage.users.map((user) => [user.id, user]));

  const matches = matchRoster(rows, profiles);
  const newRows = rows.filter((row) => !matches.has(row));
  const kept = new Set(matches.values());
  const keptByName = new Map([...matches].map(([row, profile]) => [compact(row.employeeName), profile]));
  const retire = profiles.filter((profile) => !kept.has(profile) && profile.id !== actor.id && profile.account_status !== "left")
    .map((profile) => ({ profile, mergeInto: keptByName.get(compact(profile.employee_name)) ?? null }));

  const targetEmails = new Set(rows.map((row) => row.workEmail));
  const keptAuthIds = new Set([...kept].map((profile) => profile.auth_user_id));
  const collisions = authPage.users.filter((user) => user.email && targetEmails.has(user.email.toLowerCase()) && !keptAuthIds.has(user.id));
  if (collisions.length) throw new Error(`${collisions.length} work email(s) already belong to another Auth account; no changes were made.`);
  if ([...kept].some((profile) => !authById.has(profile.auth_user_id))) throw new Error("A matched profile has no Auth identity; no changes were made.");

  const emailChanges = [...matches].filter(([row, profile]) => authById.get(profile.auth_user_id).email?.toLowerCase() !== row.workEmail);
  const summary = {
    mode: mode.slice(2), target_host: new URL(url).host, roster_rows: rows.length, matched: matches.size, new_accounts: newRows.length,
    auth_email_changes: emailChanges.length, retire: retire.length, duplicates_merged: retire.filter((item) => item.mergeInto).length,
  };
  if (reportFile) {
    const lines = [
      ...[...matches].map(([row, profile]) => `KEEP\t${row.employeeName}\t${profile.employee_code} ${profile.employee_name}\t${profile.username} -> ${row.username}\t${authById.get(profile.auth_user_id).email} -> ${row.workEmail}\tcode ${row.employeeCode ?? profile.employee_code}`),
      ...newRows.map((row) => `NEW\t${row.employeeName}\t\t${row.username}\t${row.workEmail}`),
      ...retire.map(({ profile, mergeInto }) => `${mergeInto ? "MERGE" : "RETIRE"}\t${profile.employee_name}\t${profile.employee_code}\t${profile.username}\t${profile.email}${mergeInto ? `\t-> ${mergeInto.employee_code}` : ""}`),
    ];
    writeFileSync(reportFile, `${lines.join("\n")}\n`);
  }
  // The exact RPC arguments, so the database step can be rehearsed in a
  // rolled-back transaction. New employees join only once they exist.
  const reconcilePayload = () => ({
    p_roster: [...matches].map(([row, profile]) => ({
      profile_id: profile.id, employee_name: row.employeeName, first_name: row.firstName, last_name: row.lastName, username: row.username,
      work_email: row.workEmail, personal_email: row.personalEmail, personal_mobile: row.personalMobile, official_mobile: row.officialMobile,
      branch: row.branch, department: row.department, designation: row.designation, week_off: row.weekOff, access_level: row.level,
      employee_code: row.employeeCode,
    })),
    p_retire: retire.map(({ profile, mergeInto }) => ({ profile_id: profile.id, merge_into_profile_id: mergeInto?.id ?? null })),
  });
  if (payloadFile) writeFileSync(payloadFile, JSON.stringify(reconcilePayload()));
  if (mode === "--dry-run") { console.log(JSON.stringify(summary)); return; }

  // 1. New employees go through the same audited creation contract as the
  //    Users screen, then are completed by the roster reconciliation below.
  const lookup = async (table, column, value, extra = (query) => query) => {
    const { data } = await extra(db.from(table).select("id").ilike(column, value)).limit(1).maybeSingle();
    return data?.id ?? null;
  };
  for (const row of newRows) {
    const branchId = await lookup("branches", "name", row.branch, (query) => query.eq("tenant_id", actor.tenant_id).eq("is_active", true));
    const departmentId = await lookup("departments", "name", row.department, (query) => query.eq("tenant_id", actor.tenant_id).eq("is_active", true));
    const designationId = await lookup("dropdown_masters", "label", row.designation, (query) => query.eq("master_type", "designation").eq("is_active", true));
    if (!branchId || !departmentId || !designationId) throw new Error(`Row ${row.rowNumber}: organisation mapping is invalid.`);
    const { data: created, error: createError } = await db.auth.admin.createUser({ email: row.workEmail, password: row.initialPassword, email_confirm: true });
    if (createError || !created.user) throw new Error(`Row ${row.rowNumber}: the Auth account could not be created.`);
    const { data: profileId, error: profileError } = await db.rpc("create_user_profile_with_coverage_and_audit", {
      p_auth_user_id: created.user.id, p_creator_profile_id: actor.id, p_personal_email: row.workEmail, p_first_name: row.firstName,
      p_last_name: row.lastName ?? "", p_official_email: row.workEmail, p_branch_id: branchId, p_department_id: departmentId,
      p_designation_id: designationId, p_personal_mobile: row.personalMobile ?? "", p_official_mobile: row.officialMobile,
      p_week_off: row.weekOff, p_user_role: "staff", p_buddy_id: null, p_secondary_buddy_id: null, p_reports_to_user_id: null,
    });
    if (profileError || !profileId) {
      await db.auth.admin.deleteUser(created.user.id);
      throw new Error(`Row ${row.rowNumber}: the profile could not be created; its Auth account was removed.`);
    }
    const { error: identityError } = await db.rpc("set_new_user_work_identity_with_audit", { p_profile_id: profileId, p_username: row.username, p_personal_email: row.personalEmail ?? "" });
    if (identityError) throw new Error(`Row ${row.rowNumber}: the username could not be set; rerun to complete.`);
    matches.set(row, { id: profileId, auth_user_id: created.user.id });
  }

  // 2. Auth has a unique email constraint: stage changing accounts at a
  //    private invalid address, then set the final work email.
  for (const [, profile] of emailChanges) {
    const { error } = await db.auth.admin.updateUserById(profile.auth_user_id, { email: `staged-${profile.auth_user_id}@mkjewels.invalid`, email_confirm: true });
    if (error) throw new Error("Auth email staging failed; profiles were not changed.");
  }
  for (const [row, profile] of emailChanges) {
    const { error } = await db.auth.admin.updateUserById(profile.auth_user_id, { email: row.workEmail, email_confirm: true });
    if (error) throw new Error("Auth email finalisation failed; rerun to complete.");
  }

  // 3. Profiles, duplicates and leavers in one audited transaction.
  const { data: result, error: reconcileError } = await db.rpc("reconcile_employee_roster_with_audit", reconcilePayload());
  if (reconcileError || !result) throw new Error(`Profile reconciliation failed after Auth email changes; rerun to complete. ${reconcileError?.message ?? ""}`);

  // 4. Passwords, only after every login identity is final.
  let passwordFailures = 0;
  for (const [row, profile] of matches) {
    const { error } = await db.auth.admin.updateUserById(profile.auth_user_id, { password: row.initialPassword });
    if (error) passwordFailures += 1;
  }

  // 5. Delete retired accounts that own nothing; deleting the Auth user
  //    cascades to its profile. Anything still linked stays as a left account.
  let deleted = 0;
  for (const item of result.deletable) {
    const { error } = await db.auth.admin.deleteUser(item.auth_user_id);
    if (!error) deleted += 1;
  }

  // 6. Postflight: every roster profile is active with a matching Auth email.
  const { data: after } = await db.from("user_profiles").select("id,auth_user_id,email,username,account_status,is_login_enabled").in("id", [...matches.values()].map((profile) => profile.id));
  const { data: authAfter } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authEmail = new Map(authAfter.users.map((user) => [user.id, user.email?.toLowerCase()]));
  const unhealthy = (after ?? []).filter((profile) => profile.account_status !== "active" || !profile.is_login_enabled || !profile.username || authEmail.get(profile.auth_user_id) !== profile.email).length
    + (matches.size - (after ?? []).length);
  console.log(JSON.stringify({ ...summary, updated: result.updated, retired: result.retired, deleted, retained_left: result.retired - deleted, password_failures: passwordFailures, unhealthy_profiles: unhealthy }));
  if (passwordFailures || unhealthy) process.exitCode = 1;
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Roster reconciliation failed."); process.exitCode = 1; });
