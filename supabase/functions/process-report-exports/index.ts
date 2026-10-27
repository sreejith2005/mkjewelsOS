import {createClient} from "@supabase/supabase-js";
import {handleExportRequest,type ExportBatch,type ExportGateway,type ExportJob,type CleanupJob} from "./worker.ts";

function gateway(url:string,key:string):ExportGateway{
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  return {
    async claim(limit,workerId){const {data,error}=await admin.rpc("claim_report_exports",{p_limit:limit,p_worker_id:workerId,p_lease_minutes:10});if(error)throw new Error("claim_failed");return (data??[]) as ExportJob[];},
    async batch(id,offset,limit){const {data,error}=await admin.rpc("get_report_export_batch",{p_export_id:id,p_offset:offset,p_limit:limit});if(error)throw new Error("batch_failed");
      if(data&&typeof data==="object"&&"remote" in data){
        const receiveUrl=Deno.env.get("CRM_SYNC_RECEIVE_URL"),secret=Deno.env.get("CRM_SYNC_OUTBOUND_SECRET");
        if(!receiveUrl||!secret)throw new Error("customer_export_not_configured");
        const response=await fetch(receiveUrl,{method:"POST",headers:{"Content-Type":"application/json","x-crm-sync-secret":secret},body:JSON.stringify({kind:"customer.export",...data.remote}),signal:AbortSignal.timeout(25_000)});
        if(!response.ok)throw new Error("customer_export_failed");
        const batch:unknown=await response.json();if(!batch||typeof batch!=="object"||!("rows" in batch)||!Array.isArray(batch.rows)||!("total" in batch)||typeof batch.total!=="number")throw new Error("invalid_customer_export_batch");
        const localRows=Array.isArray(data.localRows)?data.localRows:[];
        const localTotal=typeof data.localTotal==="number"?data.localTotal:0;
        const remaining=typeof data.remaining==="number"?data.remaining:limit;
        return {...batch,rows:[...localRows,...batch.rows.slice(0,remaining)],total:localTotal+batch.total} as ExportBatch;
      }return data as ExportBatch;},
    async progress(id,workerId,percent,rowCount){const {error}=await admin.rpc("update_report_export_progress",{p_export_id:id,p_worker_id:workerId,p_progress:percent,p_row_count:rowCount});if(error)throw new Error("progress_failed");},
    async upload(path,csv){const {error}=await admin.storage.from("report-exports").upload(path,csv,{contentType:"text/csv;charset=utf-8",upsert:false});if(error)throw new Error("upload_failed");},
    async finish(id,workerId,outcome,path,rowCount,errorCode){const {data,error}=await admin.rpc("finish_report_export",{p_export_id:id,p_worker_id:workerId,p_outcome:outcome,p_object_path:path,p_row_count:rowCount,p_error_code:errorCode});if(error)throw new Error("finish_failed");return data as string;},
    async claimCleanup(limit){const {data,error}=await admin.rpc("claim_report_export_cleanup",{p_limit:limit});if(error)throw new Error("cleanup_claim_failed");return (data??[]) as CleanupJob[];},
    async remove(paths){if(paths.length===0)return;const {error}=await admin.storage.from("report-exports").remove([...paths]);if(error)throw new Error("cleanup_remove_failed");},
    async markCleaned(id){const {error}=await admin.rpc("mark_report_export_cleaned",{p_export_id:id});if(error)throw new Error("cleanup_mark_failed");},
  };
}
Deno.serve((request)=>{const secret=Deno.env.get("REPORT_EXPORT_CRON_SECRET");const url=Deno.env.get("SUPABASE_URL");const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");return handleExportRequest(request,secret,url&&key?gateway(url,key):null);});
