import { useEffect,useState } from "react";
import { supabase } from "@jewelos/api-client";
import { customerReasonText,customerSyncStatus,type StatusTone } from "@jewelos/core";

type SyncStatus={instance:string;state:string;clientId:string|null;pending:number;reason:string|null};
const toneClass:Record<StatusTone,string>={neutral:"text-task-text-muted",pending:"text-task-text-muted",success:"text-success",warning:"text-gold-secondary",danger:"text-danger"};

export function readFmsCustomerSyncStatus(instance:string,value:unknown):SyncStatus|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 if(typeof row.state!=="string")return null;
 return {instance,state:row.state,clientId:typeof row.clientId==="string"?row.clientId:null,pending:typeof row.pendingUpdates==="number"?row.pendingUpdates:0,reason:typeof row.reason==="string"?row.reason:null};
}

/**
 * Customer link for an FMS workflow (0356). Optional metadata: it never blocks the work, shows a
 * neutral state while CRM sync is pending, and links the CRM profile only for people with CRM
 * access (the RPC withholds the customer id otherwise). Workflows without customer mapping show nothing.
 */
export function FmsCustomerLink({instanceId}:{instanceId:string}) {
 const [status,setStatus]=useState<SyncStatus|null>(null);
 useEffect(()=>{let active=true;void(async()=>{try{const {data,error}=await supabase.rpc("get_fms_customer_sync_status",{p_instance_id:instanceId});if(active)setStatus(error?null:readFmsCustomerSyncStatus(instanceId,data));}catch{if(active)setStatus(null);}})();return()=>{active=false;};},[instanceId]);
 if(!status||status.instance!==instanceId||status.state==="not_configured")return null;
 const text=customerSyncStatus(status.state);const reason=status.state==="linked"?null:customerReasonText(status.reason);
 return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gold/20 px-3 py-2 text-sm" data-testid="fms-customer-link">
  <span className={`font-semibold ${toneClass[text.tone]}`}>{text.label}</span>
  {status.state==="linked"&&status.pending>0?<span className="text-task-text-muted">· {status.pending} update{status.pending===1?"":"s"} still sending</span>:null}
  {reason?<span className="text-task-text-muted">· Waiting because {reason}. Your work is saved.</span>:null}
  {status.clientId?<a className="inline-flex min-h-11 items-center font-semibold text-gold-secondary underline" href={`/crm/clients/${encodeURIComponent(status.clientId)}`}>Open CRM customer profile</a>:null}
 </div>;
}
