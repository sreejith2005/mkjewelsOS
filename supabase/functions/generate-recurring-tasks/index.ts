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
  const { data: templates, error: templatesError } = await admin
    .from("task_templates")
    .select("id,tenant_id,branch_id,department_id,recurrence_rule,schedule_kind,starts_on,default_assignee_type,default_assignee_user_id,default_assignee_role")
    .in("task_type", ["checklist", "delegation"])
    .eq("is_active", true);
  if (templatesError) return json(500, { error: "Unable to load task templates" });

  let eligible = 0;
  let created = 0;
  let alreadyExists = 0;
  const failures: Array<{ template_id: string; error: string }> = [];

  for (const template of templates ?? []) {
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

    let profilesQuery = admin
      .from("user_profiles")
      .select("id")
      .eq("tenant_id", template.tenant_id);
    if (template.branch_id) profilesQuery = profilesQuery.eq("branch_id", template.branch_id);
    if (template.department_id) profilesQuery = profilesQuery.eq("department_id", template.department_id);
    if (template.default_assignee_type === "specific_user") {
      profilesQuery = profilesQuery.eq("id", template.default_assignee_user_id);
    } else {
      profilesQuery = profilesQuery.eq("user_role", template.default_assignee_role);
    }
    const { data: assignees, error: assigneeError } = await profilesQuery;
    if (assigneeError || !assignees?.length) {
      failures.push({ template_id: template.id, error: "No eligible default assignee" });
      continue;
    }

    const { data: taskId, error: createError } = await admin.rpc("create_recurring_todo_instance", {
      p_template_id: template.id,
      p_target_date: targetDate,
      p_original_assignee_ids: assignees.map((profile) => profile.id),
    });
    if (createError) failures.push({ template_id: template.id, error: "Instance creation failed" });
    else if (taskId) created += 1;
    else alreadyExists += 1;
  }

  return json(failures.length > 0 ? 207 : 200, {
    target_date: targetDate,
    templates_checked: templates?.length ?? 0,
    templates_eligible: eligible,
    instances_created: created,
    instances_already_existed: alreadyExists,
    failures,
  });
});
