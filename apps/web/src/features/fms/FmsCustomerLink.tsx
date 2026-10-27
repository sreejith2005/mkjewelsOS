import { useEffect,useState } from "react";
import { supabase } from "@jewelos/api-client";
/** Optional customer metadata never blocks authorized workflow work. The RPC checks both sections. */
export function FmsCustomerLink({instanceId}:{instanceId:string}) {
 const [client,setClient]=useState<{instance:string;id:string}|null>(null);
 useEffect(()=>{let active=true;void(async()=>{try{const {data,error}=await supabase.rpc("get_fms_customer_link",{p_instance_id:instanceId});if(active)setClient(!error&&typeof data==="string"?{instance:instanceId,id:data}:null);}catch{if(active)setClient(null);}})();return()=>{active=false;};},[instanceId]);
 return client?.instance===instanceId?<a className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary underline" href={`/crm/clients/${encodeURIComponent(client.id)}`}>Open related customer profile</a>:null;
}
