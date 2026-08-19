export type ExportJob = Readonly<{ id:string;tenant_id:string;report_key:string;attempt_number:number;max_rows:number }>;
export type ExportBatch = Readonly<{ rows:readonly Readonly<Record<string,unknown>>[];total:number;cancelled?:boolean }>;
export type CleanupJob = Readonly<{ id:string;object_path:string }>;

export type ExportGateway = Readonly<{
  claim:(limit:number,workerId:string)=>Promise<readonly ExportJob[]>;
  batch:(id:string,offset:number,limit:number)=>Promise<ExportBatch>;
  progress:(id:string,workerId:string,percent:number,rowCount:number)=>Promise<void>;
  upload:(path:string,csv:Blob)=>Promise<void>;
  finish:(id:string,workerId:string,outcome:"completed"|"failed"|"cancelled",path:string|null,rowCount:number|null,errorCode:string|null)=>Promise<string>;
  claimCleanup:(limit:number)=>Promise<readonly CleanupJob[]>;
  remove:(paths:readonly string[])=>Promise<void>;
  markCleaned:(id:string)=>Promise<void>;
}>;

export const responseHeaders={"Access-Control-Allow-Headers":"content-type,x-cron-secret","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Origin":"*","Content-Type":"application/json"} as const;
const FORMULA=/^[=+\-@]/;
const COLUMNS:Readonly<Record<string,readonly string[]>>={
  task_operations:["task_id","title","task_type","priority","status","planned_datetime","assignee_name","checklist_completion"],
  task_completion_delay:["task_id","title","assignee_name","planned_datetime","actual_datetime","on_time","delay_minutes"],
  fms_instances_stages:["instance_id","reference_number","flow_name","instance_status","stage_name","stage_status","planned_datetime","assignee_name"],
  fms_sla:["instance_id","reference_number","stage_name","planned_datetime","actual_datetime","sla_state","delay_minutes"],
  form_submissions_reviews:["submission_id","form_name","status","submitted_at","submitted_by_name","reviewed_at","reviewed_by_name"],
  crm_clients_ownership:["client_id","branch_name","owner_name","status","created_at","profile_complete"],
  crm_walkins:["walkin_id","client_id","branch_name","visit_date","crm_owner_name","buy_status"],
  crm_interactions:["interaction_id","client_id","event_type","subject","outcome","occurred_at","actor_name"],
  crm_followups:["followup_id","client_id","subject","due_date","status","assignee_name","completed_at"],
  people_availability:["profile_id","employee_name","branch_name","department_name","working_status","date","availability_status"],
  people_task_performance:["profile_id","employee_name","tasks_assigned","tasks_completed","completion_rate","on_time_completed","overdue_open","average_delay_minutes"],
  notification_delivery_health:["channel","status","delivery_count","retry_count","latest_attempt_at"],
};

export function csvCell(value:unknown):string {
  if(value===null||value===undefined)return "";
  let text=typeof value==="string"?value:String(value);
  if(FORMULA.test(text))text=`'${text}`;
  return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
}
export function safeFilename(reportKey:string,date=new Date()):string {return `${reportKey.replace(/[^a-z0-9_-]/g,"-")}-${date.toISOString().slice(0,10)}.csv`;}
export function encodeRows(columns:readonly string[],rows:readonly Readonly<Record<string,unknown>>[],includeHeader:boolean):string {
  const lines:string[]=[]; if(includeHeader)lines.push(columns.map(csvCell).join(",")); for(const row of rows)lines.push(columns.map((column)=>csvCell(row[column])).join(",")); return `${lines.join("\r\n")}\r\n`;
}
function json(status:number,body:Readonly<Record<string,unknown>>):Response{return new Response(JSON.stringify(body),{status,headers:responseHeaders});}

export async function processExportJob(gateway:ExportGateway,job:ExportJob,workerId:string,batchSize=500):Promise<"completed"|"failed"|"cancelled"> {
  const columns=COLUMNS[job.report_key]; if(!columns){await gateway.finish(job.id,workerId,"failed",null,null,"unknown_report_key");return "failed";}
  const chunks:BlobPart[]=[new Uint8Array([0xef,0xbb,0xbf])]; let offset=0; let total=0;
  try {
    while(offset<job.max_rows){
      const batch=await gateway.batch(job.id,offset,Math.min(batchSize,job.max_rows-offset));
      if(batch.cancelled){await gateway.finish(job.id,workerId,"cancelled",null,null,null);return "cancelled";}
      if(offset===0)total=Math.min(batch.total,job.max_rows);
      if(batch.rows.length===0)break;
      chunks.push(encodeRows(columns,batch.rows,offset===0)); offset+=batch.rows.length;
      await gateway.progress(job.id,workerId,Math.min(99,Math.floor((offset/Math.max(total,1))*100)),offset);
      if(batch.rows.length<batchSize||offset>=total)break;
    }
    if(offset===0)chunks.push(encodeRows(columns,[],true));
    const path=`${job.tenant_id}/${job.id}/${safeFilename(job.report_key)}`;
    await gateway.upload(path,new Blob(chunks,{type:"text/csv;charset=utf-8"}));
    const state=await gateway.finish(job.id,workerId,"completed",path,offset,null);
    if(state==="cancelled"){await gateway.remove([path]);return "cancelled";}
    return "completed";
  }catch{await gateway.finish(job.id,workerId,"failed",null,null,"export_processing_failed");return "failed";}
}

export async function processBatch(gateway:ExportGateway,batchSize:number,workerId:string){
  const jobs=await gateway.claim(batchSize,workerId);const counts={claimed:jobs.length,completed:0,failed:0,cancelled:0,expired_cleaned:0};
  for(const job of jobs){const state=await processExportJob(gateway,job,workerId);counts[state]+=1;}
  const cleanup=await gateway.claimCleanup(batchSize); if(cleanup.length){await gateway.remove(cleanup.map((item)=>item.object_path));for(const item of cleanup)await gateway.markCleaned(item.id);counts.expired_cleaned=cleanup.length;}
  return counts;
}

export async function handleExportRequest(request:Request,secret:string|undefined,gateway:ExportGateway|null,workerId:string=crypto.randomUUID()):Promise<Response>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:responseHeaders});
  if(request.method!=="POST")return json(405,{error:"Method not allowed"});
  if(!secret||!gateway)return json(500,{error:"Function secrets are not configured"});
  if(request.headers.get("x-cron-secret")!==secret)return json(401,{error:"Scheduler authorization required"});
  let batchSize=5;try{const body=request.headers.get("content-length")==="0"?{}:await request.json() as {batch_size?:unknown};if(body.batch_size!==undefined){if(!Number.isInteger(body.batch_size)||(body.batch_size as number)<1||(body.batch_size as number)>20)return json(400,{error:"batch_size must be an integer from 1 to 20"});batchSize=body.batch_size as number;}}catch{return json(400,{error:"Invalid request"});}
  try{return json(200,await processBatch(gateway,batchSize,workerId));}catch{return json(500,{error:"Export processing failed"});}
}
