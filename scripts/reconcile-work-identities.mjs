import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const compact = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#") && line.includes("=")).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const mode = process.argv[2];
if (!['--dry-run', '--apply'].includes(mode)) throw new Error('Usage: node scripts/reconcile-work-identities.mjs --dry-run|--apply');
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL; const key = env.SEED_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Configured Supabase audit credentials are unavailable.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: profiles, error: profileError } = await db.from('user_profiles').select('id,auth_user_id,first_name,last_name,employee_name,email').order('id');
if (profileError || !profiles) throw profileError ?? new Error('Profiles could not be loaded.');
const { data: response, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (authError) throw authError;
const emails = new Map(response.users.map((user) => [user.id, user.email?.toLowerCase() ?? '']));
if (profiles.some((profile) => !emails.has(profile.auth_user_id))) throw new Error('One or more profiles has no Auth identity. No changes were made.');
const prepared = profiles.map((profile) => { const parts = profile.employee_name.trim().split(/\s+/); const first = compact(profile.first_name || parts[0]); const last = compact(profile.last_name || parts.slice(1).join(' ')); const username = `${first}${last}`; if (!first || !username) throw new Error('A profile cannot produce a username. No changes were made.'); return { profile, first, last, username }; });
const duplicate = (values) => new Set(values).size !== values.length;
if (duplicate(prepared.map((item) => item.username))) throw new Error('Generated usernames are not unique. No changes were made.');
const firstCounts = new Map(); for (const item of prepared) firstCounts.set(item.first, (firstCounts.get(item.first) ?? 0) + 1);
const identities = prepared.map((item) => ({ profile_id: item.profile.id, auth_user_id: item.profile.auth_user_id, username: item.username, work_email: firstCounts.get(item.first) === 1 ? `${item.first}mkjewels@gmail.com` : `${item.first}.${item.last}mkjewels@gmail.com` }));
if (duplicate(identities.map((item) => item.work_email))) throw new Error('Generated work emails are not unique. No changes were made.');
const changing = identities.filter((item) => emails.get(item.auth_user_id) !== item.work_email);
console.log(JSON.stringify({ target_host: new URL(url).host, profiles: profiles.length, auth_email_changes: changing.length, first_name_fallbacks: identities.filter((item) => item.work_email.split('@')[0].includes('.')).length, mode: mode.slice(2) }));
if (mode === '--dry-run') process.exit(0);
for (const item of changing) { const { error } = await db.auth.admin.updateUserById(item.auth_user_id, { email: `staged-${item.auth_user_id}@mkjewels.invalid`, email_confirm: true }); if (error) throw new Error('Auth email staging failed; profile rows were not changed.'); }
for (const item of identities) { const { error } = await db.auth.admin.updateUserById(item.auth_user_id, { email: item.work_email, email_confirm: true }); if (error) throw new Error('Auth email finalization failed; stop and reconcile before retrying.'); }
const { data: applied, error: applyError } = await db.rpc('apply_work_identity_with_audit', { p_identities: identities });
if (applyError) throw new Error('Profile identity reconciliation failed after Auth email changes; stop and reconcile before retrying.');
console.log(JSON.stringify({ applied_profiles: applied }));
