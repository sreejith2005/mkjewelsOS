/**
 * Ask Kiara Phase 2 local integration test (plan, Phase 2 tests).
 *
 * Runs only with KIARA_LOCAL_STACK=1 against a LOCAL Supabase stack:
 *   KIARA_LOCAL_STACK=1 SUPABASE_URL=http://127.0.0.1:<port> SUPABASE_ANON_KEY=<local anon key> \
 *   KIARA_DB_CONTAINER=supabase_db_<project> \
 *   deno test --allow-env --allow-net --allow-read --allow-run integration.test.ts
 *
 * It applies `integration.fixture.sql` (synthetic tenant, two branches, one user
 * per role) with `docker exec <container> psql`, signs in as each user, runs
 * every Kiara executor exactly as the Edge Function does (caller JWT, anon key,
 * no service role), and asserts the executor returns what the matching section
 * read returns for that same user, and that the Andheri manager never receives
 * a Borivali row through Kiara.
 */
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { validateAccessContext, type AccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { validateSectionControls } from "../../../packages/core/src/settings/sectionAvailability.ts";
import { KIARA_REPORT_KEYS, accessibleKiaraSections, offeredKiaraTools, type KiaraToolSpec } from "../../../packages/core/src/assistant/tools.ts";
import { addLocalDays, kiaraToday, resolveKiaraPeriod } from "../../../packages/core/src/assistant/period.ts";
import { reportsForRole } from "../../../packages/core/src/reports/catalog.ts";
import { createActorClient } from "./actor.ts";
import { executeKiaraTool, type ActorClient } from "./tools/index.ts";
import { DASHBOARD_METRIC_KEYS } from "./tools/dashboard.ts";

const ENABLED = Deno.env.get("KIARA_LOCAL_STACK") === "1";
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CONTAINER = Deno.env.get("KIARA_DB_CONTAINER") ?? "";
const PASSWORD = "kiara-local-test-only";
const TZ = "Asia/Kolkata";
const BORIVALI = /Borivali/;

const USERS = {
  super_admin: "kiara-it-01@example.invalid",
  admin: "kiara-it-02@example.invalid",
  manager_andheri: "kiara-it-03@example.invalid",
  hr: "kiara-it-04@example.invalid",
  staff: "kiara-it-05@example.invalid",
  staff_with_manager_authority: "kiara-it-06@example.invalid",
  staff_borivali: "kiara-it-07@example.invalid",
} as const;
type Who = keyof typeof USERS;

type Session = Readonly<{ who: Who; actor: ActorClient; access: AccessContext; offered: readonly KiaraToolSpec[]; sections: ReturnType<typeof accessibleKiaraSections> }>;

const results: Array<{ who: Who; tool: string; outcome: string }> = [];
const record = (who: Who, tool: string, outcome: string) => results.push({ who, tool, outcome });

async function applyFixture() {
  const sql = await Deno.readTextFile(new URL("./integration.fixture.sql", import.meta.url));
  const child = new Deno.Command("docker", { args: ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], stdin: "piped", stdout: "null", stderr: "piped" }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();
  const status = await child.output();
  if (!status.success) throw new Error(`fixture failed: ${new TextDecoder().decode(status.stderr).slice(0, 400)}`);
}

async function signIn(who: Who): Promise<Session> {
  const anonymous = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anonymous.auth.signInWithPassword({ email: USERS[who], password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${who}`);
  const client = createClient(URL_, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  const actor = createActorClient(client);
  const [accessResult, controlsResult] = await Promise.all([actor.rpc("get_my_access_context"), actor.rpc("get_section_availability")]);
  if (accessResult.error || controlsResult.error) throw new Error(`access context failed for ${who}`);
  const access = validateAccessContext(accessResult.data);
  const controls = validateSectionControls(controlsResult.data);
  return { who, actor, access, offered: offeredKiaraTools(access, controls), sections: accessibleKiaraSections(access, controls) };
}

async function tool(session: Session, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const executed = await executeKiaraTool(name, input, {
    actor: session.actor,
    offered: session.offered,
    accessibleSections: session.sections,
    timeZone: TZ,
    access: session.access,
    now: new Date(),
  });
  const parsed = JSON.parse(executed.content) as Record<string, unknown>;
  assert(!executed.isError, `${session.who} ${name} returned an error: ${executed.content.slice(0, 300)}`);
  return parsed;
}

const offered = (session: Session, name: string) => session.offered.some((spec) => spec.definition.name === name);
const sorted = (values: Array<string | null | undefined>) => values.map((value) => value ?? "").sort();
const untrustedText = (value: unknown) => (value && typeof value === "object" && "untrusted_text" in value ? String((value as { untrusted_text: string }).untrusted_text) : null);
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value as Record<string, unknown>[] : []);
const today = () => kiaraToday(new Date(), TZ);

/** A tool that is not offered must be refused, with nothing read. */
async function expectDenied(session: Session, name: string, input: Record<string, unknown>) {
  const result = await tool(session, name, input);
  assertEquals(result.access, "denied", `${session.who} ${name} should be denied`);
  record(session.who, name, "denied (as the section)");
}

// ---------------------------------------------------------------------------
// Per-tool comparisons: executor result vs the section's own read, same user
// ---------------------------------------------------------------------------

async function checkMyTasks(s: Session) {
  if (!offered(s, "search_my_tasks")) return expectDenied(s, "search_my_tasks", {});
  const result = await tool(s, "search_my_tasks", { status: "all" });
  // The Tasks section's feeds: doer, creator (Delegated), and Watching.
  const me = s.access.profileId;
  const [doer, creator, watched] = await Promise.all([
    s.actor.select("v_task_feed_scope", { columns: "id", filters: [{ op: "eq", column: "assignee_id", value: me }, { op: "neq", column: "task_type", value: "fms" }], limit: 500 }),
    s.actor.select("v_task_feed_scope", { columns: "id", filters: [{ op: "eq", column: "created_by", value: me }, { op: "neq", column: "task_type", value: "fms" }], limit: 500 }),
    s.actor.select("task_watchers", { columns: "task_instance_id", filters: [{ op: "eq", column: "user_profile_id", value: me }], limit: 500 }),
  ]);
  const ids = new Set([...rows(doer.data), ...rows(creator.data)].map((row) => row.id as string).concat(rows(watched.data).map((row) => row.task_instance_id as string)));
  const titles = ids.size ? rows((await s.actor.select("task_instances", { columns: "title", filters: [{ op: "in", column: "id", values: [...ids] }], limit: 500 })).data).map((row) => row.title as string) : [];
  const got = rows(result.tasks).map((task) => untrustedText(task.title));
  assertEquals(sorted(got), sorted(titles), `${s.who} search_my_tasks`);
  if (s.who === "manager_andheri") {
    // Raw task RLS lets a manager read every tenant task; Kiara must not.
    const raw = rows((await s.actor.select("task_instances", { columns: "title", filters: [], limit: 500 })).data);
    assert(raw.some((row) => BORIVALI.test(String(row.title))), "fixture check: raw RLS is wider for managers");
    assert(!got.some((title) => BORIVALI.test(String(title))), "manager received another branch's task");
  }
  record(s.who, "search_my_tasks", `equal (${got.length} own tasks)`);
}

async function checkFms(s: Session) {
  if (!offered(s, "get_fms_work")) return expectDenied(s, "get_fms_work", {});
  const result = await tool(s, "get_fms_work", {});
  const section = await s.actor.select("fms_instance_stages", { columns: "id", filters: [{ op: "contains", column: "assigned_to", values: [s.access.profileId] }, { op: "in", column: "status", values: ["pending", "in_progress", "in_review", "blocked", "overdue"] }], limit: 100 });
  const starters = await s.actor.rpc("get_my_fms_starter_assignments");
  assertEquals(rows(result.stages).length, rows(section.data).length, `${s.who} get_fms_work stages`);
  assertEquals(rows(result.starter_forms).length, rows(starters.data).length, `${s.who} get_fms_work starters`);
  record(s.who, "get_fms_work", `equal (${rows(result.stages).length} stages)`);
}

async function checkNotifications(s: Session) {
  if (!offered(s, "get_my_notifications")) return expectDenied(s, "get_my_notifications", {});
  const result = await tool(s, "get_my_notifications", {});
  const section = await s.actor.select("notifications", { columns: "title", filters: [{ op: "eq", column: "user_profile_id", value: s.access.profileId }], order: [{ column: "created_at", ascending: false }], limit: 20 });
  const unread = await s.actor.select("notifications", { columns: "id", filters: [{ op: "eq", column: "user_profile_id", value: s.access.profileId }, { op: "eq", column: "is_read", value: false }], limit: 1, count: true });
  assertEquals(rows(result.notifications).map((row) => untrustedText(row.title)), rows(section.data).map((row) => row.title as string), `${s.who} notifications`);
  assertEquals(result.unread_count, unread.count, `${s.who} unread count`);
  record(s.who, "get_my_notifications", `equal (${result.unread_count} unread)`);
}

async function checkForms(s: Session) {
  if (!offered(s, "search_forms")) return expectDenied(s, "search_forms", {});
  const result = await tool(s, "search_forms", {});
  const section = await s.actor.select("form_templates", { columns: "name", filters: [{ op: "eq", column: "lifecycle", value: "published" }, { op: "eq", column: "is_active", value: true }], order: [{ column: "name", ascending: true }], limit: 20 });
  assertEquals(rows(result.forms_you_can_fill).map((row) => untrustedText(row.form)), rows(section.data).map((row) => row.name as string), `${s.who} forms`);
  record(s.who, "search_forms", `equal (${rows(result.forms_you_can_fill).length} forms)`);
}

async function checkLeave(s: Session) {
  if (!offered(s, "get_leave")) return expectDenied(s, "get_leave", { scope: "mine" });
  const mine = await tool(s, "get_leave", { scope: "mine" });
  const own = await s.actor.select("leave_requests", { columns: "leave_start", filters: [{ op: "eq", column: "applicant_id", value: s.access.profileId }], limit: 50 });
  assertEquals(rows(mine.requests).length, rows(own.data).length, `${s.who} own leave`);
  const office = await tool(s, "get_leave", { scope: "office", period: "tomorrow" });
  const allowed = s.access.permissions["availability.view_leave_summary"] || s.access.permissions["availability.review_leave"];
  if (!allowed) {
    assertEquals(office.access, "denied");
    record(s.who, "get_leave", `equal own (${rows(mine.requests).length}); office denied`);
    return;
  }
  const tomorrow = addLocalDays(today(), 1);
  const section = await s.actor.select("leave_requests", { columns: "applicant_id", filters: [{ op: "lte", column: "leave_start", value: tomorrow }, { op: "gte", column: "leave_end", value: tomorrow }], limit: 50 });
  assertEquals(rows(office.requests).length, rows(section.data).length, `${s.who} office leave`);
  record(s.who, "get_leave", `equal own (${rows(mine.requests).length}); office tomorrow (${rows(office.requests).length})`);
}

async function checkAvailability(s: Session) {
  if (!offered(s, "get_availability")) return expectDenied(s, "get_availability", {});
  const result = await tool(s, "get_availability", { period: "tomorrow" });
  const tomorrow = addLocalDays(today(), 1);
  const own = await s.actor.select("user_availability", { columns: "date,status", filters: [{ op: "eq", column: "user_profile_id", value: s.access.profileId }, { op: "eq", column: "date", value: tomorrow }], limit: 5 });
  assertEquals(rows(result.your_days).length, rows(own.data).length, `${s.who} own availability`);
  const report = await s.actor.rpc("get_report_data", { p_report_key: "people_availability", p_filters: { preset: "custom", from: tomorrow, to: tomorrow, page: 1, page_size: 50 } });
  const others = result.others as Record<string, unknown>;
  if (report.error) {
    assertEquals(report.error.code, "42501");
    assertEquals(others.access, "denied");
    record(s.who, "get_availability", "own days equal; team denied (People report not open)");
    return;
  }
  const expected = rows((report.data as Record<string, unknown>).rows).map((row) => row.employee_name as string);
  const got = rows(others.people).map((row) => row.name as string);
  assertEquals(sorted(got), sorted(expected), `${s.who} team availability`);
  if (s.who === "manager_andheri") assert(!got.some((name) => BORIVALI.test(name)), "manager received another branch's availability");
  record(s.who, "get_availability", `equal (team ${got.length} rows)`);
}

async function checkDashboard(s: Session) {
  if (!offered(s, "get_dashboard_metrics")) return expectDenied(s, "get_dashboard_metrics", {});
  const result = await tool(s, "get_dashboard_metrics", { period: "this_week" });
  const week = resolveKiaraPeriod("this_week", new Date(), TZ);
  const rpc = await s.actor.rpc("get_dashboard_metrics", { p_context: { preset: "custom", from: week.from, to: week.to } });
  assert(!rpc.error);
  const expected = (rpc.data as Record<string, Record<string, unknown>>).metrics;
  const got = result.metrics as Record<string, unknown>;
  for (const key of DASHBOARD_METRIC_KEYS) if (key in expected) assertEquals(got[key], expected[key], `${s.who} dashboard ${key}`);
  // Dashboard authority widens the Dashboard to the branch; the label must say so.
  if (s.who === "staff_with_manager_authority" || s.who === "manager_andheri") assertEquals(result.scope, "Branch Kiara Andheri");
  if (s.who === "staff" || s.who === "hr") assert(/assigned to the user/.test(String(result.scope)));
  record(s.who, "get_dashboard_metrics", `equal (assigned ${got.tasks_assigned}, overdue ${got.overdue_open}; ${result.scope})`);
}

async function checkProgress(s: Session) {
  if (!offered(s, "get_team_progress")) return expectDenied(s, "get_team_progress", {});
  const result = await tool(s, "get_team_progress", { period: "last_30_days" });
  const range = resolveKiaraPeriod("last_30_days", new Date(), TZ);
  const rpc = await s.actor.rpc("get_employee_task_progress", { p_context: { from: range.from, to: range.to } });
  assert(!rpc.error);
  const expected = rows((rpc.data as Record<string, unknown>).employees).map((row) => `${row.employee_name}:${row.overdue}`);
  const got = rows(result.employees).map((row) => `${row.name}:${row.overdue}`);
  assertEquals(sorted(got), sorted(expected), `${s.who} team progress`);
  const evidence = await s.actor.rpc("get_task_evidence_workspace", { p_filter: { from: range.from, to: range.to, view: "overdue", page: 1, page_size: 10 } });
  assertEquals(rows(result.overdue_tasks).map((row) => untrustedText(row.title)), rows((evidence.data as Record<string, unknown>).tasks).map((row) => row.task_title as string));
  if (s.who === "manager_andheri") {
    assert(!got.some((row) => BORIVALI.test(row)), "manager received another branch's employees");
    assert(!rows(result.overdue_tasks).some((row) => BORIVALI.test(String(untrustedText(row.title)))), "manager received another branch's overdue task");
  }
  record(s.who, "get_team_progress", `equal (${got.length} employees, ${rows(result.overdue_tasks).length} overdue tasks)`);
}

async function checkReports(s: Session) {
  if (!offered(s, "run_report")) {
    await expectDenied(s, "list_reports", {});
    return expectDenied(s, "run_report", { report_key: "task_operations" });
  }
  const list = await tool(s, "list_reports", {});
  assertEquals(rows(list.reports).map((row) => row.report_key), reportsForRole(s.access.baseRole).map((report) => report.key).filter((key) => KIARA_REPORT_KEYS.includes(key)), `${s.who} list_reports`);
  record(s.who, "list_reports", `equal (${rows(list.reports).length} reports, base role ${s.access.baseRole})`);
  const month = resolveKiaraPeriod("this_month", new Date(), TZ);
  const result = await tool(s, "run_report", { report_key: "task_operations", period: "this_month" });
  const rpc = await s.actor.rpc("get_report_data", { p_report_key: "task_operations", p_filters: { preset: "custom", from: month.from, to: month.to, page: 1, page_size: 25 } });
  if (rpc.error) {
    assertEquals(result.access, "denied");
    record(s.who, "run_report", "denied (as Reports)");
    return;
  }
  const expected = rows((rpc.data as Record<string, unknown>).rows).map((row) => row.title as string);
  const got = rows(result.rows).map((row) => untrustedText(row.title));
  assertEquals(got, expected, `${s.who} run_report`);
  if (s.who === "manager_andheri") assert(!got.some((title) => BORIVALI.test(String(title))), "manager received another branch's report row");
  const people = await tool(s, "run_report", { report_key: "people_availability", period: "today" });
  const peopleRpc = await s.actor.rpc("get_report_data", { p_report_key: "people_availability", p_filters: { preset: "custom", from: today(), to: today(), page: 1, page_size: 25 } });
  assertEquals(people.access === "denied", Boolean(peopleRpc.error), `${s.who} people report denial matches`);
  record(s.who, "run_report", `equal (task_operations ${got.length} rows; people_availability ${people.access === "denied" ? "denied" : "allowed"})`);
}

async function checkPeople(s: Session) {
  if (!offered(s, "find_people")) return expectDenied(s, "find_people", { person_name: "KIT" });
  const result = await tool(s, "find_people", { person_name: "KIT" });
  const section = await s.actor.select("user_profiles", { columns: "employee_name", filters: [{ op: "ilike", column: "employee_name", value: "%KIT%" }], order: [{ column: "employee_name", ascending: true }], limit: 20 });
  const got = rows(result.people).map((row) => row.name as string);
  assertEquals(got, rows(section.data).map((row) => row.employee_name as string), `${s.who} find_people`);
  assert(!JSON.stringify(result).match(/9[78]000207|@home\.example|kiara-it-0\d@/), "personal or login contact data leaked");
  if (s.who === "manager_andheri") assert(!got.some((name) => BORIVALI.test(name)), "manager received a person outside their tree");
  record(s.who, "find_people", `equal (${got.length} people)`);
}

async function checkDirectory(s: Session) {
  if (!offered(s, "find_colleague")) return expectDenied(s, "find_colleague", { query: "HR" });
  const result = await tool(s, "find_colleague", { query: "HR Andheri" });
  const rpc = await s.actor.rpc("kiara_directory_lookup", { p_query: "HR Andheri", p_limit: 10 });
  assert(!rpc.error);
  assertEquals(result.people, (rpc.data as Record<string, unknown>).people, `${s.who} find_colleague`);
  assert(!JSON.stringify(result).match(/9[78]000207|example\.invalid|@home\.example/), "contact data leaked from the directory");
  record(s.who, "find_colleague", `equal (${rows(result.people).map((row) => row.name).join(", ")})`);
}

Deno.test({
  name: "Kiara Phase 2 executors match the sections for every role (local stack)",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_), "SUPABASE_URL must be a local stack");
    assert(ANON && CONTAINER, "SUPABASE_ANON_KEY and KIARA_DB_CONTAINER are required");
    await applyFixture();
    for (const who of Object.keys(USERS) as Who[]) {
      const session = await signIn(who);
      for (const check of [checkMyTasks, checkFms, checkNotifications, checkForms, checkLeave, checkAvailability, checkDashboard, checkProgress, checkReports, checkPeople, checkDirectory]) {
        await check(session);
      }
    }
    console.log(JSON.stringify({ kiara_integration: results }, null, 1));
  },
});
