import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const phoneDigits = (value) => value.replace(/\D/g, "");
const clean = (value) => value.trim().replace(/\s+/g, " ");
const normal = (value) => clean(value).toLocaleUpperCase("en-IN");
const email = (value) => clean(value).toLowerCase();
const weekdays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const branchAliases = new Map([["ZAVERI BAZAAR", "ZAVERI BAZAR"]]);

function loadEnv() {
  return Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")];
    }));
}

function parseRoster(file) {
  const invalidRows = [];
  const rows = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).flatMap((line, index) => {
    const fields = line.split("\t").map(clean);
    if (fields.length !== 10) {
      invalidRows.push(index + 1);
      return [];
    }
    const [employeeName, branch, department, designation, personalMobile, officialMobile, personalEmail, workEmail, weekOff, level] = fields;
    const normalizedWeekOff = weekOff.toLowerCase();
    const normalizedLevel = level.toUpperCase();
    if (!employeeName || !branch || !department || !designation || !emailPattern.test(workEmail) ||
      (personalMobile && phoneDigits(personalMobile).length !== 10) ||
      (officialMobile && phoneDigits(officialMobile).length !== 10) ||
      (normalizedWeekOff && !weekdays.has(normalizedWeekOff)) || !["ADMIN", "USER"].includes(normalizedLevel)) {
      invalidRows.push(index + 1);
      return [];
    }
    const [firstName, ...lastName] = employeeName.split(" ");
    return [{
      rowNumber: index + 1,
      employeeName,
      firstName,
      lastName: lastName.join(" ") || null,
      branch: branchAliases.get(normal(branch)) ?? normal(branch),
      department: normal(department),
      designation: normal(designation),
      personalMobile: personalMobile || null,
      officialMobile: officialMobile || null,
      // The supplied personal-email column is contact data, not the login
      // authority. Preserve a valid value; leave malformed placeholders empty.
      personalEmail: emailPattern.test(personalEmail) ? email(personalEmail) : null,
      workEmail: email(workEmail),
      weekOff: normalizedWeekOff ? [normalizedWeekOff] : [],
      level: normalizedLevel,
    }];
  });
  if (invalidRows.length) throw new Error(`The roster has ${invalidRows.length} invalid row(s); no changes were made.`);
  if (new Set(rows.map((row) => row.workEmail)).size !== rows.length) throw new Error("The roster has duplicate work-email logins.");
  return rows;
}

function addCandidate(map, key, profile) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), profile]);
}

function matchRoster(rows, profiles) {
  const byName = new Map(); const byEmail = new Map(); const byPhone = new Map();
  for (const profile of profiles) {
    addCandidate(byName, normal(profile.employee_name), profile);
    addCandidate(byEmail, email(profile.email), profile);
    addCandidate(byEmail, profile.official_email ? email(profile.official_email) : "", profile);
    addCandidate(byPhone, phoneDigits(profile.personal_mobile ?? ""), profile);
    addCandidate(byPhone, phoneDigits(profile.official_mobile ?? ""), profile);
  }
  const assignments = [];
  const unmatched = []; const ambiguous = []; const used = new Set();
  for (const row of rows) {
    const candidates = [...new Set([
      ...(byName.get(normal(row.employeeName)) ?? []),
      ...(row.personalEmail ? byEmail.get(row.personalEmail) ?? [] : []),
      ...(byPhone.get(phoneDigits(row.personalMobile ?? "")) ?? []),
      ...(byPhone.get(phoneDigits(row.officialMobile ?? "")) ?? []),
    ])];
    const ranked = candidates.map((profile) => ({
      profile,
      score:
        (normal(profile.employee_name) === normal(row.employeeName) ? 3 : 0) +
        (row.personalEmail && (email(profile.email) === row.personalEmail || (profile.official_email && email(profile.official_email) === row.personalEmail)) ? 8 : 0) +
        (email(profile.email) === row.workEmail || (profile.official_email && email(profile.official_email) === row.workEmail) ? 10 : 0) +
        (row.personalMobile && phoneDigits(profile.personal_mobile ?? "") === phoneDigits(row.personalMobile) ? 5 : 0) +
        (row.officialMobile && phoneDigits(profile.official_mobile ?? "") === phoneDigits(row.officialMobile) ? 5 : 0),
    })).sort((left, right) => right.score - left.score);
    const candidate = ranked[0]?.score && ranked[0].score > (ranked[1]?.score ?? 0) ? ranked[0].profile : null;
    if (!candidate) {
      (ranked.length ? ambiguous : unmatched).push(row.rowNumber);
      continue;
    }
    if (used.has(candidate.id)) { ambiguous.push(row.rowNumber); continue; }
    used.add(candidate.id);
    assignments.push({ ...row, profileId: candidate.id, authUserId: candidate.auth_user_id, currentEmail: email(candidate.email) });
  }
  if (unmatched.length || ambiguous.length || assignments.length !== rows.length) {
    throw new Error(`Roster/profile matching failed: unmatched=${unmatched.length}, ambiguous=${ambiguous.length}. No changes were made.`);
  }
  return assignments;
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!file || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: node scripts/reconcile-authoritative-roster.mjs --dry-run|--apply <roster.tsv>");
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SEED_SUPABASE_SERVICE_ROLE_KEY) throw new Error("Production Supabase credentials are missing from .env.");
  const db = createClient(env.SUPABASE_URL, env.SEED_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = parseRoster(file);
  const { data: actor, error: actorError } = await db.from("user_profiles").select("id,tenant_id").eq("user_role", "super_admin").eq("account_status", "active").eq("is_login_enabled", true).single();
  if (actorError || !actor) throw actorError ?? new Error("No active Super Admin exists.");
  const { data: profiles, error: profilesError } = await db.from("user_profiles").select("id,auth_user_id,employee_name,email,official_email,personal_mobile,official_mobile,account_status,is_login_enabled,working_status").eq("tenant_id", actor.tenant_id);
  if (profilesError || !profiles) throw profilesError ?? new Error("Profiles could not be loaded.");
  const assignments = matchRoster(rows, profiles);
  const { data: authResponse, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) throw authError;
  const authById = new Map(authResponse.users.map((user) => [user.id, user]));
  const targetEmails = new Set(assignments.map((row) => row.workEmail));
  const foreignCollisions = authResponse.users.filter((user) => user.email && targetEmails.has(email(user.email)) && !assignments.some((row) => row.authUserId === user.id));
  if (foreignCollisions.length) {
    const collisionIds = new Set(foreignCollisions.map((user) => user.id));
    const collisionProfiles = profiles.filter((profile) => collisionIds.has(profile.auth_user_id));
    const activeProfiles = collisionProfiles.filter((profile) => profile.account_status === "active" && profile.is_login_enabled && profile.working_status !== "resigned").length;
    const orphanedAuthAccounts = foreignCollisions.length - collisionProfiles.length;
    throw new Error(`Work-email collision with ${foreignCollisions.length} unrelated Auth account(s): active_profiles=${activeProfiles}, inactive_or_disabled_profiles=${collisionProfiles.length - activeProfiles}, orphaned_auth=${orphanedAuthAccounts}. No changes were made.`);
  }
  const missingAuth = assignments.filter((row) => !authById.has(row.authUserId));
  if (missingAuth.length) throw new Error(`Missing Auth identities for ${missingAuth.length} roster profile(s). No changes were made.`);
  const emailChanges = assignments.filter((row) => row.currentEmail !== row.workEmail).length;
  const adminAssignments = assignments.filter((row) => row.level === "ADMIN").length;
  const summary = { roster_rows: rows.length, matched_profiles: assignments.length, auth_email_changes: emailChanges, week_off_assignments: assignments.filter((row) => row.weekOff.length).length, admin_level_assignments: adminAssignments, mode: mode.slice(2) };
  if (mode === "--dry-run") { console.log(JSON.stringify(summary)); return; }

  // Supabase Auth has a unique email constraint. Stage every changing account at
  // a private invalid address first, then set the final verified work email.
  const changing = assignments.filter((row) => row.currentEmail !== row.workEmail);
  for (const row of changing) {
    const stagedEmail = `staged-${row.authUserId}@mkjewels.invalid`;
    const { error } = await db.auth.admin.updateUserById(row.authUserId, { email: stagedEmail, email_confirm: true });
    if (error) throw new Error("Auth email staging failed; the roster database update was not started.");
  }
  for (const row of assignments) {
    const { error } = await db.auth.admin.updateUserById(row.authUserId, { email: row.workEmail, email_confirm: true });
    if (error) throw new Error("Auth email finalization failed; stop and reconcile before retrying.");
  }
  const { data: applied, error: applyError } = await db.rpc("apply_complete_authoritative_roster", {
    p_roster: assignments.map(({ profileId, employeeName, firstName, lastName, branch, department, designation, personalMobile, officialMobile, personalEmail, workEmail, weekOff, level }) => ({ profile_id: profileId, employee_name: employeeName, first_name: firstName, last_name: lastName, branch, department, designation, personal_mobile: personalMobile, official_mobile: officialMobile, personal_email: personalEmail, work_email: workEmail, week_off: weekOff, access_level: level })),
  });
  if (applyError) throw new Error("Profile reconciliation failed after Auth email changes; stop and reconcile before retrying.");
  console.log(JSON.stringify({ ...summary, applied_profiles: applied }));
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Roster reconciliation failed."); process.exitCode = 1; });
