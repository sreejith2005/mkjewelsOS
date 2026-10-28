import { secretMatches } from "../crm-staff-sync/worker.ts";

export type CustomerDeliveryEvent = { id: string; lease_token: string; mapping_id: string; mapping_digest: string; descriptor: Record<string, unknown>; payload: Record<string, unknown> & { eventId: string } };
type DeliveryResult = Record<string, unknown> & { outcome?: string };
export type CustomerSyncDeps = {
 secret: string | undefined;
 gateway: null | { claim(limit: number): Promise<readonly CustomerDeliveryEvent[]>; finish(id: string, lease: string, result: DeliveryResult | null, error: string | null): Promise<"delivered" | "review" | "retry" | "dead" | "rejected"> };
 receiver: null | { post(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> };
};
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function json(status: number, body: Record<string, unknown>): Response { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export async function handleCustomerSync(request: Request, deps: CustomerSyncDeps): Promise<Response> {
 if (request.method !== "POST") return new Response(null,{status:405,headers:{Allow:"POST"}});
 if (!deps.secret || !deps.gateway || !deps.receiver) return json(503,{error:"Customer sync is not configured"});
 if (!secretMatches(request.headers.get("x-cron-secret"),deps.secret)) return json(401,{error:"Scheduler authorization required"});
 const counts = { claimed:0,delivered:0,review:0,retry:0,dead:0,rejected:0 };
 try {
  for(let batch=0;batch<2;batch++) {
   const events = await deps.gateway.claim(10);if(!events.length)break;counts.claimed+=events.length;
   let failure: string | null = null;let results: unknown[]=[];
   try {
    const mappings = new Map(events.map(e=>[e.mapping_id,{mapping_id:e.mapping_id,descriptor:e.descriptor,digest:e.mapping_digest}]));
    const registration=await deps.receiver.post({kind:"customer.mappings",mappings:[...mappings.values()]});
    if(registration.status!==200) failure=`mapping_http_${registration.status}`;
    else if (!Array.isArray(record(registration.body)?.results) || [...mappings.keys()].some(id => !(record(registration.body)?.results as unknown[]).some(value => record(value)?.mapping_id===id && record(value)?.ok===true))) failure="mapping_registration_failed";
    else {
     const response=await deps.receiver.post({kind:"customer.events",events:events.map(e=>({event_id:e.payload.eventId,payload:e.payload}))});
     if(response.status!==200)failure=`http_${response.status}`;
     const received=record(response.body)?.results;if(Array.isArray(received))results=received;
    }
   } catch { failure="network"; }
   for(const event of events) {
    const result=record(results.find(value=>record(value)?.event_id===event.payload.eventId));
    let error=failure;let accepted: DeliveryResult | null=null;
    if(!error) {
     if(!result)error="no_result";
     else if(result.ok!==true)error="apply_failed";
     else if(result.outcome==="retry")error="dependency_pending";
     else if(!["accepted","duplicate","review","mapping_unapproved","source_unapproved","rejected"].includes(String(result.outcome)))error="invalid_result";
     else if(["accepted","duplicate"].includes(String(result.outcome)) && typeof result.client_id!=="string")error="invalid_ack";
     else accepted=result;
    }
    counts[await deps.gateway.finish(event.id,event.lease_token,accepted,error)]+=1;
   }
   if(failure || events.length<10)break;
  }
  return json(200,counts);
 } catch { return json(500,{error:"Customer delivery failed"}); }
}
