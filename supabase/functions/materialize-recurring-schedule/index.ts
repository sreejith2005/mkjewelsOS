import { createClient } from "@supabase/supabase-js";
import { materializeRecurringSchedule, type ImmediateRecurringTemplate } from "./worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { headers: corsHeaders, status });
}

function kolkataToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Kolkata", year: "numeric" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function templateIdFrom(request: Request): Promise<string | null> {
  try {
    const body = await request.json() as { template_id?: unknown };
    return typeof body.template_id === "string" && UUID_PATTERN.test(body.template_id) ? body.template_id : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });

  const templateId = await templateIdFrom(request);
  if (!templateId) return response(400, { error: "A valid schedule is required" });

  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return response(401, { error: "Authentication required" });

  const actorClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { authorization } },
  });
  const { data: userData, error: userError } = await actorClient.auth.getUser();
  if (userError || !userData.user) return response(401, { error: "Authentication required" });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("id,tenant_id,branch_id,user_role")
    .eq("auth_user_id", userData.user.id)
    .eq("account_status", "active")
    .eq("is_login_enabled", true)
    .maybeSingle();
  if (profileError || !profile || !["super_admin", "admin", "manager"].includes(profile.user_role)) {
    return response(403, { error: "Schedule management is not permitted" });
  }

  const { data: template, error: templateError } = await admin.from("task_templates")
    .select("id,branch_id,recurrence_rule,schedule_kind,starts_on")
    .eq("id", templateId)
    .eq("tenant_id", profile.tenant_id)
    .eq("is_active", true)
    .in("task_type", ["checklist", "delegation"])
    .maybeSingle();
  if (templateError || !template || (profile.user_role === "manager" && template.branch_id !== profile.branch_id)) {
    return response(404, { error: "Schedule not available" });
  }

  try {
    const outcome = await materializeRecurringSchedule({
      create: async (dueTemplateId) => {
        const { data, error } = await actorClient.rpc("run_recurring_todo_template_now_with_audit", {
          p_target_date: kolkataToday(),
          p_template_id: dueTemplateId,
        });
        if (error) throw new Error("Immediate schedule materialization failed");
        return data;
      },
    }, template as ImmediateRecurringTemplate, kolkataToday());
    return response(200, outcome);
  } catch {
    return response(500, { error: "Unable to prepare the recurring task" });
  }
});
