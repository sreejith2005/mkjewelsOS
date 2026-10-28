import { createClient } from "@/lib/supabase/client";

import type { Json } from "@/lib/supabase/database.types";



export type CustomerIntegrationFunctions = {
 preview_customer_reconciliation:{Args:{p_event_ids:string[]};Returns:Json};
 browse_crm_records_page:{Args:{p_filters?:Json;p_offset?:number;p_limit?:number};Returns:Json};

 get_customer_workflow_history:{Args:{p_client:string;p_before?:string|null;p_before_id?:string|null;p_limit?:number};Returns:Json};

 customer_integration_review_queue:{Args:Record<never,never>;Returns:Json};

 configure_customer_source:{Args:{p_tenant:string;p_enabled:boolean};Returns:undefined};

 approve_customer_mapping:{Args:{p_mapping_id:string;p_digest:string};Returns:undefined};

 review_customer_identity:{Args:{p_event_id:string;p_client:string;p_reason:string};Returns:undefined};

 create_customer_from_event_review:{Args:{p_event_id:string;p_name:string;p_reason:string};Returns:string};

 reject_customer_event:{Args:{p_event_id:string;p_reason:string};Returns:undefined};

 verify_customer_external_identity:{Args:{p_tenant:string;p_scope:string;p_kind:string;p_value:string;p_client:string;p_reason:string};Returns:undefined};

 get_customer_commercial_summary:{Args:{p_client:string};Returns:Json};

};

export type CustomerWorkflowEvent={id:string;at:string;actorId:string|null;sourceActorId:string|null;channel:string;kind:string;workflow:Record<string,Json|undefined>;provenance:Record<string,Json|undefined>;answers:{key:string;label:string;original:Json;labels:string[]}[]};

export function customerObject(value:Json|undefined):Record<string,Json|undefined>{return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}

export async function customerHistory(clientId:string,before?:{at:string;id:string}):Promise<CustomerWorkflowEvent[]> {

 const {data,error}=await createClient().rpc("get_customer_workflow_history",{p_client:clientId,p_limit:25,...(before?{p_before:before.at,p_before_id:before.id}:{})});if(error)throw new Error(error.message);

 if(!Array.isArray(data))throw new Error("Invalid customer history response");

 return data.map(raw=>{const row=customerObject(raw);if(typeof row.event_id!=="string"||typeof row.occurred_at!=="string")throw new Error("Invalid customer event identity");

  const answers=Array.isArray(row.answers)?row.answers.map(value=>{const answer=customerObject(value);return {key:typeof answer.fieldKey==="string"?answer.fieldKey:"",label:typeof answer.label==="string"?answer.label:"Saved answer",original:answer.original??null,labels:Array.isArray(answer.optionLabels)?answer.optionLabels.filter((v):v is string=>typeof v==="string"):[]};}):[];

  return {id:row.event_id,at:row.occurred_at,actorId:typeof row.actor_id==="string"?row.actor_id:null,sourceActorId:typeof row.source_actor_id==="string"?row.source_actor_id:null,channel:String(row.channel??""),kind:String(row.kind??""),workflow:customerObject(row.workflow),provenance:customerObject(row.provenance),answers};

 });

}



export async function customerCommercial(clientId:string):Promise<{classification:string;first:string|null;latest:string|null}>{

 const {data,error}=await createClient().rpc("get_customer_commercial_summary",{p_client:clientId});if(error)throw new Error(error.message);const row=customerObject(data);

 return {classification:typeof row.classification==="string"?row.classification:"Unknown",first:typeof row.firstVerifiedPurchase==="string"?row.firstVerifiedPurchase:null,latest:typeof row.latestVerifiedPurchase==="string"?row.latestVerifiedPurchase:null};

}
