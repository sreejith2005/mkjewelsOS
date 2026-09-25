// End-to-end workflow parity: the same salesperson flow in both apps (queue -> walk-in with a
// proof upload -> not-bought follow-up -> referral follow-up -> profile edit), then the rows
// each app wrote are compared, with generated ids and timestamps normalised. On JewelOS the
// audit rows are checked too (mutating RPC rows, the 0185 direct-write row, no values).
import { PNG } from "pngjs";

import { ORIGINAL_DB_CONTAINER } from "./original-stack.mjs";
import { JEWELOS_DB_CONTAINER } from "./load-jewelos.mjs";
import { psql } from "./util.mjs";

export const WORKFLOW_PHONE = "9100000777";
const CLIENT = "Parity Workflow Client";
const REFERRAL = "Parity Workflow Referral";

function proofPng() {
  const png = new PNG({ width: 12, height: 12 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 201; png.data[i + 1] = 162; png.data[i + 2] = 74; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
}

function kolkataDate(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts;
}

async function selectFirstReal(locator) {
  const value = await locator.evaluate((select) => [...select.options].find((option) => option.value)?.value ?? "");
  await locator.selectOption(value);
}

export async function runWorkflow(page, origin) {
  const idle = () => page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.goto(`${origin}/crm/queue`);
  await idle();
  await page.getByRole("button", { name: /^CLIENT/ }).click();
  await page.locator("form").filter({ hasText: "REGISTER CLIENT" }).getByRole("textbox").first().fill(CLIENT);
  await page.getByLabel("Mobile Number").fill(WORKFLOW_PHONE);
  await page.getByRole("button", { name: "REGISTER CLIENT" }).click();
  await page.getByText(/Client registered\. Client ID:/).waitFor({ timeout: 30_000 });
  await idle();
  await page.getByRole("row", { name: new RegExp(CLIENT) }).getByRole("link", { name: /ADD WALKIN ENTRY|MAKE WALK-IN ENTRY/ }).click();
  await page.waitForURL(/\/crm\/visits\/new\?queue=/, { timeout: 60_000 });
  await idle();
  await page.getByLabel("Visit date and time").waitFor();

  await page.getByLabel("Salesperson attending the client").selectOption({ index: 1 });
  await page.getByLabel("Gender").selectOption("FEMALE");
  await page.getByLabel("Same as mobile number").check();
  await page.getByLabel("State").fill("Maharashtra");
  await page.getByLabel("City").fill("Mumbai");
  await page.getByLabel("Pincode").fill("400001");
  await page.getByLabel("Address").fill("Parity Workflow Street");
  await selectFirstReal(page.getByLabel("Community / caste"));
  await page.getByLabel("Occupation").selectOption("BUSINESS OWNER");
  await page.getByLabel("Bridal / non-bridal").selectOption("NON BRIDAL");
  await page.getByLabel("Communication preference").selectOption("CALL");
  await page.getByLabel("Client bought any product?").selectOption("NO");
  await page.locator("#visit-details input[type=checkbox]").first().check();
  for (const kind of ["Instagram follow", "Google review", "Testimonial", "Feedback form", "Thank-you note"]) {
    await page.locator(".legacy-walkin-card .grid", { has: page.locator("b", { hasText: new RegExp(`^${kind}$`) }) }).locator("select").first().selectOption("no");
  }
  await page.locator(".legacy-walkin-card .grid", { has: page.locator("b", { hasText: /^Referrals$/ }) }).locator("select").first().selectOption("yes");
  await page.getByLabel("How many referrals?").selectOption("1");
  await page.getByLabel("Referral 1 name").fill(REFERRAL);
  await page.getByLabel("Referral 1 number").fill("9100000778");
  await page.getByLabel("Referrals proof image").setInputFiles({ name: "parity-proof.png", mimeType: "image/png", buffer: proofPng() });
  await page.getByText("parity-proof.png uploaded").waitFor({ timeout: 30_000 });
  await page.getByLabel("Next visit date").fill(kolkataDate(3));
  await page.getByRole("button", { name: "Submit complete visit" }).click();
  await page.waitForURL(/\/crm\/queue\?completed=/, { timeout: 60_000 });
  await idle();

  await page.goto(`${origin}/crm/followups`);
  await idle();
  await page.getByRole("button", { name: "ALL PENDING FOLLOW UP", exact: true }).click();
  const followupRow = page.getByRole("row", { name: new RegExp(CLIENT) });
  await followupRow.getByRole("button", { name: "FOLLOW UP FORM" }).click();
  await followupRow.getByLabel("Follow Up Status").selectOption("INTERESTED - NEED FOLLOW UP");
  await followupRow.getByLabel("Next Follow Up Date").fill(kolkataDate(4));
  await followupRow.getByLabel("Follow Up Remark").fill("Parity workflow follow-up");
  await followupRow.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Follow-up saved.").waitFor({ timeout: 30_000 });
  await idle();

  await page.goto(`${origin}/crm/referrals`);
  await idle();
  await page.getByRole("button", { name: "ALL PENDING", exact: true }).click();
  const referralRow = page.getByRole("row", { name: new RegExp(REFERRAL) });
  await referralRow.getByRole("button", { name: "FOLLOW UP FORM" }).click();
  await referralRow.getByLabel("Follow Up Status").selectOption("VISIT PLANNED");
  await referralRow.getByLabel("Next Follow Up Date").fill(kolkataDate(2));
  await referralRow.getByLabel("Follow Up Remark").fill("Parity workflow referral call");
  await referralRow.getByRole("button", { name: "SAVE FOLLOW UP" }).click();
  await page.getByText("Referral follow-up saved.").waitFor({ timeout: 30_000 });
  await idle();

  await page.goto(`${origin}/crm/clients?search=${WORKFLOW_PHONE}`);
  await idle();
  await page.getByRole("link", { name: "View Client Profile" }).first().click();
  await page.getByRole("button", { name: "EDIT PROFILE" }).waitFor({ timeout: 60_000 });
  await idle();
  await page.getByRole("button", { name: "EDIT PROFILE" }).click();
  await page.locator("label", { hasText: /^city$/i }).locator("input").fill("Pune");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
}

const ROWS_SQL = (schema) => `
with c as (select client_id from ${schema}.clients where primary_phone = '${WORKFLOW_PHONE}'),
t as (select id from ${schema}.client_timeline where client_id in (select client_id from c)),
f as (select id from ${schema}.not_bought_followups where client_id in (select client_id from c)),
r as (select id from ${schema}.referrals where given_by_client_id in (select client_id from c)),
rc as (select id from ${schema}.referral_calling where referral_id in (select id from r))
select json_build_object(
  'clients', (select json_agg(x) from ${schema}.clients x where client_id in (select client_id from c)),
  'entry_queue', (select json_agg(x order by x.status) from ${schema}.entry_queue x where mobile = '${WORKFLOW_PHONE}'),
  'client_timeline', (select json_agg(x) from ${schema}.client_timeline x where id in (select id from t)),
  'visit_forms', (select json_agg(x) from ${schema}.visit_forms x where client_timeline_id in (select id from t)),
  'documents', (select json_agg(x) from ${schema}.documents x where client_id in (select client_id from c)),
  'not_bought_followups', (select json_agg(x) from ${schema}.not_bought_followups x where id in (select id from f)),
  'not_bought_history', (select json_agg(x order by x.created_at) from ${schema}.not_bought_history x where followup_id in (select id from f)),
  'referrals', (select json_agg(x) from ${schema}.referrals x where id in (select id from r)),
  'referral_calling', (select json_agg(x) from ${schema}.referral_calling x where id in (select id from rc)),
  'referral_calling_history', (select json_agg(x order by x.created_at) from ${schema}.referral_calling_history x where referral_calling_id in (select id from rc)),
  'client_edit_log', (select json_agg(json_build_object('field_name', x.field_name, 'old_value', x.old_value, 'new_value', x.new_value, 'edited_by', x.edited_by) order by x.id) from ${schema}.client_edit_log x where client_id in (select client_id from c))
);`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g;
const FIXED_USER_IDS = new Set(["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002", "c0000000-0000-4000-8000-000000000003", "c0000000-0000-4000-8000-000000000004", "a0000000-0000-4000-8000-00000000000a", "a0000000-0000-4000-8000-00000000000b"]);

/** Generated ids become <uuid> (fixture user/branch ids stay), timestamps keep only the day. */
function normalise(text) {
  return text.replace(UUID, (id) => (FIXED_USER_IDS.has(id.toLowerCase()) ? id : "<uuid>")).replace(TIMESTAMP, "$1");
}

export function compareWorkflowRows() {
  const original = JSON.parse(psql(ORIGINAL_DB_CONTAINER, ROWS_SQL("public")));
  const port = JSON.parse(psql(JEWELOS_DB_CONTAINER, ROWS_SQL("crm")));
  const tables = {};
  for (const table of Object.keys(original)) {
    const a = normalise(JSON.stringify(original[table]));
    const b = normalise(JSON.stringify(port[table]));
    tables[table] = { rows: Array.isArray(original[table]) ? original[table].length : 0, match: a === b, ...(a === b ? {} : { original: a.slice(0, 600), port: b.slice(0, 600) }) };
  }
  const objects = {
    original: Number(psql(ORIGINAL_DB_CONTAINER, "select count(*) from storage.objects where bucket_id = 'crm-documents' and name like '%parity-proof.png';")),
    port: Number(psql(JEWELOS_DB_CONTAINER, "select count(*) from storage.objects where bucket_id = 'crm-legacy-documents' and name like '%parity-proof.png';")),
  };
  const audit = psql(JEWELOS_DB_CONTAINER, `
select coalesce(json_agg(json_build_object('action', action, 'changed_columns', new_value -> 'changed_columns') order by action), '[]')
from public.audit_logs where module = 'crm' and actor_user_id = '0d000000-0000-4000-8000-000000000003'
  and created_at > now() - interval '30 minutes';`);
  const auditText = psql(JEWELOS_DB_CONTAINER, "select coalesce(string_agg(new_value::text, ' '), '') from public.audit_logs where module = 'crm' and created_at > now() - interval '30 minutes';");
  return {
    tables,
    storageObjects: objects,
    jewelosAudit: JSON.parse(audit),
    auditHasNoCustomerValues: !/Parity Workflow|9100000777|Pune|Parity workflow/.test(auditText),
  };
}
