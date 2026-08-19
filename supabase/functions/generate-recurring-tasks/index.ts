import { createClient } from "@supabase/supabase-js";
import {
  resolveRecurringAssignment,
  shouldGenerateRecurringTask,
  type RecurringAssignment,
  type RecurringAvailabilityProfile,
} from "../../../packages/core/src/recurrence.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

type RequestBody = { date?: unknown };
type Profile = RecurringAvailabilityProfile;

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
    .select("id,tenant_id,branch_id,department_id,recurrence_rule,default_assignee_type,default_assignee_user_id,default_assignee_role")
    .eq("task_type", "checklist")
    .eq("is_active", true);
  if (templatesError) return json(500, { error: "Unable to load task templates" });

  let eligible = 0;
  let created = 0;
  let alreadyExists = 0;
  const failures: Array<{ template_id: string; error: string }> = [];

  for (const template of templates ?? []) {
    if (!template.recurrence_rule) continue;
    try {
      if (!shouldGenerateRecurringTask(template.recurrence_rule, targetDate)) continue;
    } catch {
      failures.push({ template_id: template.id, error: "Invalid recurrence rule" });
      continue;
    }
    eligible += 1;

    let profilesQuery = admin
      .from("user_profiles")
      .select("id,buddy_id,week_off,working_status")
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

    const originalProfiles = assignees as Profile[];
    const relatedIds = Array.from(new Set(originalProfiles.flatMap((profile) =>
      profile.buddy_id ? [profile.id, profile.buddy_id] : [profile.id]
    )));
    const [{ data: relatedProfiles, error: relatedError }, { data: availability, error: availabilityError }] = await Promise.all([
      admin.from("user_profiles").select("id,buddy_id,week_off,working_status")
        .eq("tenant_id", template.tenant_id).in("id", relatedIds),
      admin.from("user_availability").select("user_profile_id,status")
        .eq("tenant_id", template.tenant_id).eq("date", targetDate).in("user_profile_id", relatedIds),
    ]);
    if (relatedError || availabilityError) {
      failures.push({ template_id: template.id, error: "Unable to resolve availability" });
      continue;
    }
    const profileById = new Map((relatedProfiles as Profile[] | null ?? []).map((profile) => [profile.id, profile]));
    const statusByUser = new Map((availability ?? []).map((row) => [row.user_profile_id, row.status]));
    const assignments: RecurringAssignment[] = originalProfiles.map((original) =>
      resolveRecurringAssignment(
        original,
        original.buddy_id ? profileById.get(original.buddy_id) : undefined,
        statusByUser,
        targetDate,
      ));

    const { data: taskId, error: createError } = await admin.rpc("create_recurring_task_instance", {
      p_template_id: template.id,
      p_target_date: targetDate,
      p_assignments: assignments,
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
