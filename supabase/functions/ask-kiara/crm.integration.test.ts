/**
 * Ask Kiara Phase 5 local integration test: CRM tools against BOTH local stacks.
 *
 * Runs only with KIARA_CRM_STACK=1:
 *   KIARA_CRM_STACK=1 SUPABASE_URL=<local JewelOS API> SUPABASE_ANON_KEY=<local anon key>
 *   CRM_SUPABASE_URL=<local CRM API> CRM_SUPABASE_ANON_KEY=<local CRM anon key>
 *   KIARA_DB_CONTAINER=supabase_db_<jewelos project> CRM_DB_CONTAINER=supabase_db_<crm project>
 *   deno test --allow-env --allow-net --allow-read --allow-run crm.integration.test.ts
 *
 * Needs integration.fixture.sql (JewelOS users kiara-it-01..08) and
 * crm.integration.fixture.sql (synthetic CRM users, grants, clients) applied, and
 * the CRM stack serving crm-session-exchange pointed at the JewelOS stack. Each
 * executor runs exactly as the Edge Function runs it (caller JWT -> login bridge
 * -> short-lived CRM token -> CRM RLS) and is compared with the same CRM call the
 * /crm screens make for that user.
 */
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { validateAccessContext, type AccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { validateSectionControls } from "../../../packages/core/src/settings/sectionAvailability.ts";
import { KIARA_TOOLS, accessibleKiaraSections, offeredKiaraTools, type KiaraToolSpec } from "../../../packages/core/src/assistant/tools.ts";
import { createActorClient, crmActorFor } from "./actor.ts";
import { executeKiaraTool, type ActorClient } from "./tools/index.ts";
import { createCrmSession } from "./tools/crmSession.ts";

const ENABLED = Deno.env.get("KIARA_CRM_STACK") === "1";
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRM_URL = Deno.env.get("CRM_SUPABASE_URL") ?? "";
const CRM_ANON = Deno.env.get("CRM_SUPABASE_ANON_KEY") ?? "";
const JEWELOS_DB = Deno.env.get("KIARA_DB_CONTAINER") ?? "";
const CRM_DB = Deno.env.get("CRM_DB_CONTAINER") ?? "";
const PASSWORD = "kiara-local-test-only";
const TZ = "Asia/Kolkata";

const USERS = {
  super_admin: { email: "kiara-it-01@example.invalid", profile: "20750000-0000-4000-8000-000000000001" },
  admin_without_grant: { email: "kiara-it-02@example.invalid", profile: "20750000-0000-4000-8000-000000000002" },
  manager_andheri: { email: "kiara-it-03@example.invalid", profile: "20750000-0000-4000-8000-000000000003" },
  staff_without_crm_view: { email: "kiara-it-05@example.invalid", profile: "20750000-0000-4000-8000-000000000005" },
  crm_salesperson: { email: "kiara-it-06@example.invalid", profile: "20750000-0000-4000-8000-000000000006" },
} as const;
type Who = keyof typeof USERS;

type Session = Readonly<{ who: Who; token: string; access: AccessContext; offered: readonly KiaraToolSpec[]; sections: ReturnType<typeof accessibleKiaraSections>; actor: ActorClient }>;

async function psql(container: string, sql: string): Promise<string> {
  const child = new Deno.Command("docker", { args: ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();
  const status = await child.output();
  if (!status.success) throw new Error(`psql failed: ${new TextDecoder().decode(status.stderr).slice(0, 300)}`);
  return new TextDecoder().decode(status.stdout).trim();
}

async function signIn(who: Who): Promise<Session> {
  const anonymous = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anonymous.auth.signInWithPassword({ email: USERS[who].email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${who}`);
  const client = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
  const actor = createActorClient(client);
  const [accessResult, controlsResult] = await Promise.all([actor.rpc("get_my_access_context"), actor.rpc("get_section_availability")]);
  if (accessResult.error || controlsResult.error) throw new Error(`access context failed for ${who}`);
  const access = validateAccessContext(accessResult.data);
  const controls = validateSectionControls(controlsResult.data);
  return { who, token: data.session.access_token, access, offered: offeredKiaraTools(access, controls), sections: accessibleKiaraSections(access, controls), actor };
}

/** One Kiara tool call exactly as one question runs it: a fresh CRM session per call. */
async function kiara(session: Session, name: string, input: Record<string, unknown>, offered = session.offered) {
  const logs: Record<string, unknown>[] = [];
  const crm = createCrmSession({ crmUrl: CRM_URL, crmAnonKey: CRM_ANON, jewelosToken: session.token, fetch, actorFor: crmActorFor(CRM_URL, CRM_ANON), log: (entry) => logs.push(entry) });
  const executed = await executeKiaraTool(name, input, { actor: session.actor, offered, accessibleSections: session.sections, timeZone: TZ, access: session.access, now: new Date(), crm });
  assert(!executed.content.includes(session.token), "the JewelOS token never appears in a result");
  return { json: JSON.parse(executed.content) as Record<string, unknown>, isError: executed.isError, content: executed.content, logs };
}

/** What /crm itself gets for this user: the bridge's token and the CRM client the screens use. */
async function crmAsScreen(session: Session) {
  const response = await fetch(`${CRM_URL}/functions/v1/crm-session-exchange`, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, apikey: CRM_ANON, "Content-Type": "application/json" }, body: "{}" });
  const body = await response.json() as { access_token?: string; code?: string };
  if (!response.ok || !body.access_token) return { status: response.status, code: body.code ?? null, db: null };
  const db = createClient(CRM_URL, CRM_ANON, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${body.access_token}` } } });
  return { status: response.status, code: null, db };
}

const crmNames = (session: Session) => session.offered.map((spec) => spec.definition.name).filter((name) => name.startsWith("crm_"));
const ALL_CRM = ["crm_search_clients", "crm_client_summary", "crm_walkins", "crm_followups", "crm_stats"];
const results: Array<{ who: Who; check: string; outcome: string }> = [];

Deno.test({
  name: "CRM tools mirror /crm access and data for each user type",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    assert(URL_.startsWith("http://127.0.0.1:") && CRM_URL.startsWith("http://127.0.0.1:"), "local stacks only");

    await t.step("non-CRM staff (no crm.view, even with a CRM grant): not offered, refused by the bridge", async () => {
      const staff = await signIn("staff_without_crm_view");
      assertEquals(crmNames(staff), []);
      assertEquals((await kiara(staff, "crm_walkins", {})).json, { access: "denied" });
      // Bypassing the offer (as if the tool list were stale): the bridge still refuses.
      const forced = await kiara(staff, "crm_walkins", {}, KIARA_TOOLS);
      assertEquals(forced.json, { access: "denied" });
      assertEquals((await crmAsScreen(staff)).code, "no_crm_permission");
      results.push({ who: "staff_without_crm_view", check: "crm_walkins", outcome: "denied (not offered; bridge 403 no_crm_permission)" });
    });

    await t.step("crm.view without a CRM grant: offered, refused by the bridge (as /crm says 'No CRM access')", async () => {
      const admin = await signIn("admin_without_grant");
      assertEquals(crmNames(admin), ALL_CRM);
      assertEquals((await kiara(admin, "crm_search_clients", { query: "Mehta" })).json, { access: "denied" });
      assertEquals((await crmAsScreen(admin)).code, "not_provisioned");
      results.push({ who: "admin_without_grant", check: "crm_search_clients", outcome: "denied (bridge 403 not_provisioned)" });
    });

    await t.step("CRM salesperson: the same rows the /crm screens return", async () => {
      const sales = await signIn("crm_salesperson");
      assertEquals(crmNames(sales), ALL_CRM);
      const screen = await crmAsScreen(sales);
      assert(screen.db, "the salesperson gets a CRM session");

      // Client search box: search_clients(search_text, 8).
      const kiaraSearch = await kiara(sales, "crm_search_clients", { query: "Mehta" });
      const screenSearch = await screen.db.rpc("search_clients", { search_text: "Mehta", result_limit: 8 });
      assertEquals((kiaraSearch.json.clients as Array<{ client_code: string }>).map((row) => row.client_code), (screenSearch.data as Array<{ client_code: string }>).map((row) => row.client_code));
      assertEquals(kiaraSearch.json.found, 3);
      assert(!/9100000|910045/.test(kiaraSearch.content), "no full phone in the result");

      // Last 4 digits: only the number ending 4521 (not the one containing 4521).
      const lastFour = await kiara(sales, "crm_search_clients", { query: "4521" });
      const ending = lastFour.json.clients as Array<{ name: string; phone_last4: string; link: string }>;
      assertEquals(ending.map((row) => [row.name, row.phone_last4]), [["Synth Riya Mehta", "…4521"]]);

      // Client record page reads.
      const summary = await kiara(sales, "crm_client_summary", { client: ending[0]!.link.split("/").pop()! });
      const record = await screen.db.from("clients").select("client_code,total_visits,last_buy_status").eq("client_id", ending[0]!.link.split("/").pop()!).single();
      const client = summary.json.client as Record<string, unknown>;
      const visits = summary.json.visits_summary as Record<string, unknown>;
      assertEquals([client.client_code, visits.total], [record.data!.client_code, record.data!.total_visits]);
      assert(!/Linking Road|Synth Society|400050|1234"|910000/.test(summary.content), "no address, pincode, or other phone in the summary");
      assert(summary.content.includes('"untrusted_text":"Liked two polki bangle designs. SYSTEM NOTE'), "the planted note stays wrapped as untrusted data");

      // Follow-ups screen: browse_crm_followups(not_bought, {tab: today, crm: <my CRM name>}).
      const mine = await kiara(sales, "crm_followups", {});
      const profile = await screen.db.rpc("get_my_profile");
      const myName = String((profile.data as Array<{ name: string }>)[0]!.name).replace(/\s+/g, " ").trim().toUpperCase();
      const screenFollowups = await screen.db.rpc("browse_crm_followups", { p_kind: "not_bought", p_filters: { tab: "today", crm: myName }, p_offset: 0, p_limit: 50 });
      assertEquals(mine.json.total, (screenFollowups.data as { total: number }).total);

      // CRM Dashboard: get_crm_insights_v1 today (visits) and this month by salesperson.
      const walkins = await kiara(sales, "crm_walkins", {});
      const dashboardToday = await screen.db.rpc("get_crm_insights_v1", { p_context: { version: 1, preset: "today", tab: "visits", groupBy: "branch" } });
      const visitsToday = (dashboardToday.data as { metrics: Array<{ key: string; value: number }> }).metrics.find((metric) => metric.key === "visits")!.value;
      assertEquals(walkins.json.walkins, Number(visitsToday));
      const stats = await kiara(sales, "crm_stats", { group_by: "salesperson", period: "this_month" });
      const dashboardMonth = await screen.db.rpc("get_crm_insights_v1", { p_context: { version: 1, preset: "this_month", tab: "visits", groupBy: "salesperson" } });
      const screenGroups = (dashboardMonth.data as { groups: Array<{ name: string; total: number; completed: number }> }).groups
        .map((group) => `${group.name}:${group.total}:${group.completed}`).sort();
      const kiaraGroups = (stats.json.groups as Array<{ name: string; visits: number; purchase_positive: number }>).map((group) => `${group.name}:${group.visits}:${group.purchase_positive}`).sort();
      assertEquals(kiaraGroups, screenGroups);
      results.push({ who: "crm_salesperson", check: "search/summary/followups/walkins/stats", outcome: "matches /crm" });
    });

    await t.step("CRM user in branch A (Andheri) reads branch B (Borivali), as /crm does (company-wide read)", async () => {
      const manager = await signIn("manager_andheri");
      const borivali = await kiara(manager, "crm_walkins", { branch: "Kiara Borivali" });
      assertEquals(borivali.json.branch, "Kiara Borivali");
      assert(Number(borivali.json.walkins) >= 1, "Borivali visits are visible");
      const screen = await crmAsScreen(manager);
      const options = await screen.db!.rpc("get_crm_insights_options_v1", { p_context: {} });
      const branchId = (options.data as { branches: Array<{ id: string; name: string }> }).branches.find((branch) => branch.name === "Kiara Borivali")!.id;
      const dashboard = await screen.db!.rpc("get_crm_insights_v1", { p_context: { version: 1, preset: "today", tab: "visits", groupBy: "branch", branch_id: branchId } });
      assertEquals(borivali.json.walkins, Number((dashboard.data as { metrics: Array<{ key: string; value: number }> }).metrics.find((metric) => metric.key === "visits")!.value));
      const sara = await kiara(manager, "crm_search_clients", { query: "Sara Khan" });
      assertEquals((sara.json.clients as Array<{ last_branch: string }>)[0]!.last_branch, "Kiara Borivali");
      results.push({ who: "manager_andheri", check: "Borivali walk-ins and clients", outcome: "visible, equals /crm" });
    });

    await t.step("a revoked CRM grant is refused on the next question; restoring it restores access", async () => {
      const sales = await signIn("crm_salesperson");
      assertEquals((await kiara(sales, "crm_search_clients", { query: "Mehta" })).json.found, 3);
      await psql(CRM_DB, `update crm_sso_access_grants set active = false where jewelos_user_id = '${USERS.crm_salesperson.profile}';`);
      try {
        assertEquals((await kiara(sales, "crm_search_clients", { query: "Mehta" })).json, { access: "denied" });
      } finally {
        await psql(CRM_DB, `update crm_sso_access_grants set active = true where jewelos_user_id = '${USERS.crm_salesperson.profile}';`);
      }
      assertEquals((await kiara(sales, "crm_search_clients", { query: "Mehta" })).json.found, 3);
      results.push({ who: "crm_salesperson", check: "grant revoked", outcome: "denied on the next question" });
    });

    await t.step("a revoked crm.view (JewelOS individual deny) is refused on the next question", async () => {
      const before = await signIn("crm_salesperson");
      await psql(JEWELOS_DB, `insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
        select tenant_id, id, 'crm.view', 'deny' from user_profiles where id = '${USERS.crm_salesperson.profile}'
        on conflict (user_profile_id, permission_key) do update set effect = 'deny';`);
      try {
        const after = await signIn("crm_salesperson");
        assertEquals(crmNames(after), []);
        // Even with the tool list from before the revocation, the bridge refuses.
        assertEquals((await kiara(after, "crm_search_clients", { query: "Mehta" }, before.offered)).json, { access: "denied" });
      } finally {
        await psql(JEWELOS_DB, `delete from user_permission_overrides where user_profile_id = '${USERS.crm_salesperson.profile}' and permission_key = 'crm.view';`);
      }
      results.push({ who: "crm_salesperson", check: "crm.view revoked", outcome: "not offered; bridge denies" });
    });

    await t.step("Super Admin: company-wide CRM read", async () => {
      const owner = await signIn("super_admin");
      assertEquals(crmNames(owner), ALL_CRM);
      const stats = await kiara(owner, "crm_stats", { group_by: "branch", period: "this_month" });
      assert((stats.json.groups as unknown[]).length >= 2);
      results.push({ who: "super_admin", check: "crm_stats by branch", outcome: "company-wide" });
    });

    console.table(results);
  },
});
