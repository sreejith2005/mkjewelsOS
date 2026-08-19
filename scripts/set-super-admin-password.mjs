import fs from "node:fs";

const password = process.env.JEWELOS_NEW_PASSWORD;
if (!password || password.length < 8) throw new Error("Set JEWELOS_NEW_PASSWORD to at least 8 characters through the secure PowerShell prompt.");

const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.trim().startsWith("#"))
  .map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")];
  }));

const url = env.SUPABASE_URL;
const key = env.SEED_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Production Supabase credentials are missing from .env.");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const usersResponse = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
if (!usersResponse.ok) throw new Error("Unable to look up the Super Admin account.");
const { users } = await usersResponse.json();
const user = users.find((candidate) => candidate.email?.toLowerCase() === "mis@mkjewels.in");
if (!user) throw new Error("The Super Admin account mis@mkjewels.in was not found.");

const updateResponse = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ password, email_confirm: true }),
});
if (!updateResponse.ok) throw new Error("Unable to set the Super Admin password.");
const profileResponse = await fetch(`${url}/rest/v1/user_profiles?select=id,tenant_id&auth_user_id=eq.${user.id}`, { headers });
const profiles = profileResponse.ok ? await profileResponse.json() : [];
if (profiles.length === 1) {
  await fetch(`${url}/rest/v1/audit_logs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ tenant_id: profiles[0].tenant_id, actor_user_id: profiles[0].id, action: "super_admin_password_set_locally", module: "user_management", record_id: profiles[0].id, new_value: { password_stored: false } }),
  });
}
console.log("Super Admin password updated. You can now sign in as mis@mkjewels.in.");
