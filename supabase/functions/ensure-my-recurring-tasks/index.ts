import { createClient } from "@supabase/supabase-js";
import { ensureMyRecurringTasks, type DueRecurringTemplate } from "./worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { headers: corsHeaders, status });
}

function kolkataToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Kolkata", year: "numeric" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });
  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return response(401, { error: "Authentication required" });

  const actorClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { authorization } } });
  const { data: userData, error: userError } = await actorClient.auth.getUser();
  if (userError || !userData.user) return response(401, { error: "Authentication required" });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("id,tenant_id,user_role")
    .eq("auth_user_id", userData.user.id)
    .eq("account_status", "active")
    .eq("is_login_enabled", true)
    .maybeSingle();
  if (profileError || !profile) return response(403, { error: "Active profile required" });

  try {
    const outcome = await ensureMyRecurringTasks({
      create: async (templateId) => {
        const { data, error } = await admin.rpc("create_recurring_todo_instance", { p_original_assignee_ids: [profile.id], p_target_date: kolkataToday(), p_template_id: templateId });
        if (error) throw new Error("Recurring task generation failed");
        return data;
      },
      listTemplates: async () => {
        const { data, error } = await admin.from("task_templates")
          .select("id,recurrence_rule,schedule_kind,starts_on")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_active", true)
          .in("task_type", ["checklist", "delegation"])
          .not("recurrence_rule", "is", null)
          .neq("schedule_kind", "as_required")
          .or(`default_assignee_user_id.eq.${profile.id},default_assignee_role.eq.${profile.user_role}`);
        if (error) throw new Error("Recurring schedules unavailable");
        return (data ?? []) as DueRecurringTemplate[];
      },
    }, kolkataToday());
    return response(200, outcome);
  } catch {
    return response(500, { error: "Unable to prepare recurring tasks" });
  }
});
