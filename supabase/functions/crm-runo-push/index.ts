import { createClient } from "@supabase/supabase-js";
import { handleRunoPush, type RunoGateway, type RunoLead } from "./worker.ts";

// Secrets: RUNO_API_KEY (function secret); CRM_RUNO_API_URL is optional and only for local
// stubs. SUPABASE_URL and SUPABASE_ANON_KEY are provided by the Edge runtime. The gateway
// is the CALLER's client (their JWT, RLS on schema crm); service_role is never used here.
function callerGateway(request: Request): RunoGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !token) return null;
  const db = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "crm" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    async authUserId() {
      const { data } = await db.auth.getUser(token);
      return data.user?.id ?? null;
    },
    async lead(leadId) {
      const { data } = await db.from("leads").select("id,phone_number,name,field_values,created_by").eq("id", leadId).single();
      return (data as RunoLead | null) ?? null;
    },
    async runoFields() {
      const { data } = await db.from("lead_form_fields").select("field_key,runo_field_name").eq("is_runo_synced", true);
      return data ?? [];
    },
    async crmUserId() {
      const { data } = await db.rpc("current_crm_user_id");
      return (data as string | null) ?? null;
    },
    async crmRole() {
      const { data } = await db.rpc("get_my_profile");
      return (data as Array<{ role: string | null }> | null)?.[0]?.role ?? null;
    },
    async updateLead(leadId, patch) {
      await db.from("leads").update(patch).eq("id", leadId);
    },
  };
}

Deno.serve((request) =>
  handleRunoPush(request, {
    runoKey: Deno.env.get("RUNO_API_KEY"),
    runoUrl: Deno.env.get("CRM_RUNO_API_URL"),
    gateway: callerGateway(request),
  })
);
