import { createClient } from "@supabase/supabase-js";
import {
  shouldGenerateRecurringTask,
} from "../../../packages/core/src/recurrence.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

type RequestBody = { date?: unknown };
type TemplateRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  department_id: string | null;
  recurrence_rule: string | null;
  schedule_kind: string;
  starts_on: string | null;
  default_assignee_type: string;
  default_assignee_user_id: string | null;
  default_assignee_role: string | null;
};
type ProfileRow = { id: string; tenant_id: string; branch_id: string | null; department_id: string | null; user_role: string };
// PostgREST's hosted max_rows is 1,000; a full page means another may follow.
const PAGE_SIZE = 1000;
const CREATE_CONCURRENCY = 20;

async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Page read failed");
    rows.push(...(data ?? []) as T[]);
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function kolkataToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validateDate(value: unknown): string {
  if (value === undefined) return kolkataToday();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("date is invalid");
  }
  return value;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const cronSecret = Deno.env.get("RECURRING_TASKS_CRON_SECRET");
  if (!cronSecret) return json(500, { error: "Function secrets are not configured" });
  if (request.headers.get("x-cron-secret") !== cronSecret) {
    return json(401, { error: "Scheduler authorization required" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Function secrets are not configured" });

  let targetDate: string;
  try {
    const body = request.headers.get("content-length") === "0"
      ? {} as RequestBody
      : await request.json() as RequestBody;
    targetDate = validateDate(body.date);
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : "Invalid request" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // The scheduler waits 30 seconds, so the run must not make two round trips per
  // template. Read templates, profiles and today's occurrences once (in ordered
  // pages: PostgREST caps one response at 1,000 rows), then call the database
  // only for templates still missing today's occurrence, several at a time.
  // create_recurring_todo_instance stays the authority on every decision.
  let templates: TemplateRow[]; let profiles: ProfileRow[]; let existing: Array<{ task_template_id: string | null }>;
  try {
    [templates, profiles, existing] = await Promise.all([
      readAllPages<TemplateRow>((from, to) => admin.from("task_templates")
        .select("id,tenant_id,branch_id,department_id,recurrence_rule,schedule_kind,starts_on,default_assignee_type,default_assignee_user_id,default_assignee_role")
        .in("task_type", ["checklist", "delegation"]).eq("is_active", true).order("id").range(from, to)),
      readAllPages<ProfileRow>((from, to) => admin.from("user_profiles")
        .select("id,tenant_id,branch_id,department_id,user_role").order("id").range(from, to)),
      readAllPages<{ task_template_id: string | null }>((from, to) => admin.from("task_instances")
        .select("task_template_id").eq("scheduled_date", targetDate).eq("on_demand", false)
        .not("task_template_id", "is", null).order("id").range(from, to)),
    ]);
  } catch {
    return json(500, { error: "Unable to load task templates" });
  }
  const alreadyGenerated = new Set(existing.map((row) => row.task_template_id));

  let eligible = 0;
  let created = 0;
  let alreadyExists = 0;
  const failures: Array<{ template_id: string; error: string }> = [];
  const pending: Array<{ template: TemplateRow; assigneeIds: string[] }> = [];

  for (const template of templates) {
    if (template.schedule_kind === "as_required") continue;
    if (template.starts_on && targetDate < template.starts_on) continue;
    if (template.schedule_kind === "one_time" && template.starts_on !== targetDate) continue;
    if (!template.recurrence_rule) continue;
    try {
      if (template.schedule_kind !== "one_time" && !shouldGenerateRecurringTask(template.recurrence_rule, targetDate, template.starts_on ?? undefined)) continue;
    } catch {
      failures.push({ template_id: template.id, error: "Invalid recurrence rule" });
      continue;
    }
    eligible += 1;
    if (alreadyGenerated.has(template.id)) {
      alreadyExists += 1;
      continue;
    }

    const assigneeIds = profiles.filter((profile) => profile.tenant_id === template.tenant_id
      && (!template.branch_id || profile.branch_id === template.branch_id)
      && (!template.department_id || profile.department_id === template.department_id)
      && (template.default_assignee_type === "specific_user"
        ? profile.id === template.default_assignee_user_id
        : profile.user_role === template.default_assignee_role)).map((profile) => profile.id);
    if (assigneeIds.length === 0) {
      failures.push({ template_id: template.id, error: "No eligible default assignee" });
      continue;
    }
    pending.push({ template, assigneeIds });
  }

  for (let index = 0; index < pending.length; index += CREATE_CONCURRENCY) {
    await Promise.all(pending.slice(index, index + CREATE_CONCURRENCY).map(async ({ template, assigneeIds }) => {
      const { data: taskId, error: createError } = await admin.rpc("create_recurring_todo_instance", {
        p_template_id: template.id,
        p_target_date: targetDate,
        p_original_assignee_ids: assigneeIds,
      });
      if (createError) failures.push({ template_id: template.id, error: "Instance creation failed" });
      else if (taskId) created += 1;
      else alreadyExists += 1;
    }));
  }

  return json(failures.length > 0 ? 207 : 200, {
    target_date: targetDate,
    templates_checked: templates.length,
    templates_eligible: eligible,
    instances_created: created,
    instances_already_existed: alreadyExists,
    failures,
  });
});
