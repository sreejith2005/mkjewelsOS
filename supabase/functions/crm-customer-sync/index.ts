import { createClient } from "@supabase/supabase-js";
import { handleCustomerSync, type CustomerSyncDeps, type CustomerDeliveryEvent, type CustomerMappingRegistration } from "./worker.ts";

function dependencies(): CustomerSyncDeps {
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const receiveUrl=Deno.env.get("CRM_SYNC_RECEIVE_URL"),secret=Deno.env.get("CRM_SYNC_OUTBOUND_SECRET");
 const admin=url&&key ? createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
 return { secret:Deno.env.get("CRM_STAFF_SYNC_CRON_SECRET"),gateway:admin ? {
  async claim(limit) { const {data,error}=await admin.rpc("crm_sync_claim_customer_events",{p_limit:limit});if(error)throw new Error("claim_failed");return (data ?? []) as CustomerDeliveryEvent[]; },
  async finish(id,lease,result,errorCode) {const {data,error}=await admin.rpc("crm_sync_finish_customer_event",{p_id:id,p_lease:lease,p_result:result,p_error:errorCode});if(error)throw new Error("finish_failed");return data as Awaited<ReturnType<NonNullable<CustomerSyncDeps["gateway"]>["finish"]>>;},
  async claimMappings(limit) { const {data,error}=await admin.rpc("crm_sync_claim_customer_mappings",{p_limit:limit});if(error)throw new Error("mapping_claim_failed");return (data ?? []) as CustomerMappingRegistration[]; },
  async recordMapping(id,outcome) { const {data,error}=await admin.rpc("crm_sync_record_customer_mapping",{p_mapping_id:id,p_outcome:outcome});if(error)throw new Error("mapping_record_failed");return typeof data==="number"?data:0; }
 } : null,receiver:receiveUrl&&secret ? { async post(body) {
  const response=await fetch(receiveUrl,{method:"POST",headers:{"Content-Type":"application/json","x-crm-sync-secret":secret},body:JSON.stringify(body),signal:AbortSignal.timeout(25_000)});
  let parsed:unknown=null;try{parsed=await response.json();}catch{/* Missing/malformed result is retryable. */}return {status:response.status,body:parsed};
 }} : null };
}
Deno.serve(request=>handleCustomerSync(request,dependencies()));
