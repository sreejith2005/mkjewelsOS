// Port of sreejith-crm/web-app/app/api/leads/[leadId]/runo/route.ts.
// Same authorisation rule (the lead's creator or a super admin), same outbound Runo request,
// same response mapping, same runo_* columns written on the lead. Differences, all identity or
// hosting related: the lead id arrives in the JSON body ({ "leadId": "<uuid>" }) instead of the
// URL; "the creator" is the caller's CRM user id resolved through the JewelOS identity bridge
// (crm.current_crm_user_id()) instead of the Auth user id; every database call runs as the
// caller (RLS applies), never as service_role.
export const RUNO_ALLOCATION_URL = "https://api.runo.in/v1/crm/allocation";

export type RunoLead = Readonly<{
  id: string;
  phone_number: string;
  name: string | null;
  field_values: Record<string, unknown> | null;
  created_by: string | null;
}>;

export type RunoLeadUpdate = Readonly<{ runo_pushed: boolean; runo_push_error: string | null; runo_customer_id?: string | null }>;

export type RunoGateway = Readonly<{
  /** The verified caller's Auth user id, or null when the token is missing or invalid. */
  authUserId: () => Promise<string | null>;
  /** The lead as the caller sees it under crm RLS, or null when it is not visible. */
  lead: (leadId: string) => Promise<RunoLead | null>;
  runoFields: () => Promise<ReadonlyArray<Readonly<{ field_key: string; runo_field_name: string | null }>>>;
  /** crm.current_crm_user_id() for the caller. */
  crmUserId: () => Promise<string | null>;
  /** crm.get_my_profile()[0].role for the caller. */
  crmRole: () => Promise<string | null>;
  updateLead: (leadId: string, patch: RunoLeadUpdate) => Promise<void>;
}>;

export type RunoDeps = Readonly<{
  runoKey: string | undefined;
  runoUrl?: string;
  fetcher?: typeof fetch;
  gateway: RunoGateway | null;
}>;

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export async function handleRunoPush(request: Request, deps: RunoDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const gateway = deps.gateway;
  if (!gateway) return json({ error: "Not authorized" }, 403);

  let leadId: unknown;
  try {
    leadId = ((await request.json()) as { leadId?: unknown } | null)?.leadId;
  } catch {
    leadId = undefined;
  }
  if (typeof leadId !== "string" || !leadId) return json({ error: "Not authorized" }, 403);

  const [userId, lead, fields, crmUserId, role] = await Promise.all([
    gateway.authUserId(), gateway.lead(leadId), gateway.runoFields(), gateway.crmUserId(), gateway.crmRole(),
  ]);
  if (!userId || !lead || (lead.created_by !== crmUserId && role !== "super_admin")) {
    return json({ error: "Not authorized" }, 403);
  }

  const key = deps.runoKey;
  if (!key) {
    await gateway.updateLead(leadId, { runo_pushed: false, runo_push_error: "RUNO_API_KEY is not configured" });
    return json({ error: "Runo is not configured" }, 503);
  }

  const fieldValues = lead.field_values ?? {};
  const userFields = fields.flatMap((field) => {
    const value = field.field_key === "mobile_no" ? lead.phone_number : field.field_key === "name" ? lead.name : fieldValues[field.field_key];
    return field.runo_field_name && value !== null && value !== undefined && String(value).trim()
      ? [{ name: field.runo_field_name, value: String(value) }]
      : [];
  });

  try {
    const response = await (deps.fetcher ?? fetch)(deps.runoUrl || RUNO_ALLOCATION_URL, {
      method: "POST",
      headers: { "Auth-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ customer: { name: lead.name ?? "", phoneNumber: `+91${lead.phone_number}` }, userFields }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      await gateway.updateLead(leadId, { runo_pushed: false, runo_push_error: `Runo request failed (${response.status})` });
      return json({ error: "Runo request failed" }, 502);
    }
    const customerId = payload && typeof payload === "object" && "id" in payload && typeof (payload as { id: unknown }).id === "string"
      ? (payload as { id: string }).id
      : null;
    await gateway.updateLead(leadId, { runo_pushed: true, runo_push_error: null, runo_customer_id: customerId });
    return json({ ok: true }, 200);
  } catch {
    await gateway.updateLead(leadId, { runo_pushed: false, runo_push_error: "Runo network request failed" });
    return json({ error: "Runo network request failed" }, 502);
  }
}
