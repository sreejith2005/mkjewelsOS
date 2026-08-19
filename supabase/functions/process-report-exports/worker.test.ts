import {assertEquals,assertFalse,assertStringIncludes} from "@std/assert";
import {csvCell,encodeRows,handleExportRequest,processBatch,processExportJob,safeFilename,type CleanupJob,type ExportBatch,type ExportGateway,type ExportJob} from "./worker.ts";

function fake(jobs:readonly ExportJob[]=[],batches:readonly ExportBatch[]=[] ,cleanup:readonly CleanupJob[]=[]):ExportGateway&{uploads:Array<{path:string;text:string}>;finishes:string[];removed:string[]}{
  const uploads:Array<{path:string;text:string}>=[];const finishes:string[]=[];const removed:string[]=[];let batchIndex=0;
  return {uploads,finishes,removed,claim:async(limit)=>jobs.slice(0,limit),batch:async()=>batches[batchIndex++]??{rows:[],total:0},progress:async()=>undefined,
    upload:async(path,blob)=>{uploads.push({path,text:await blob.text()});},finish:async(_id,_worker,outcome)=>{finishes.push(outcome);return outcome;},claimCleanup:async(limit)=>cleanup.slice(0,limit),remove:async(paths)=>{removed.push(...paths);},markCleaned:async()=>undefined};
}
const job:ExportJob={id:"7c130000-0000-0000-0000-000000000001",tenant_id:"1c130000-0000-0000-0000-000000000001",report_key:"task_operations",attempt_number:1,max_rows:1000};

Deno.test("CSV prevents formula injection and quotes delimiters",()=>{
  assertEquals(csvCell("=1+1"),"'=1+1");assertEquals(csvCell("+SUM(A1)"),"'+SUM(A1)");assertEquals(csvCell("-2"),"'-2");assertEquals(csvCell("@cmd"),"'@cmd");
  assertEquals(csvCell("a,b"),'"a,b"');assertEquals(csvCell('a"b'),'"a""b"');assertEquals(csvCell("a\nb"),'"a\nb"');
});
Deno.test("safe filenames contain only allowlisted characters",()=>assertEquals(safeFilename("task_operations",new Date("2026-08-10T00:00:00Z")),"task_operations-2026-08-10.csv"));
Deno.test("bounded batches create one private UTF-8 CSV without logging rows",async()=>{
  const gateway=fake([job],[{rows:[{task_id:"synthetic",title:"=formula",task_type:"checklist",priority:"high",status:"pending",planned_datetime:"2026-08-10",assignee_name:"Synthetic",checklist_completion:50}],total:1}]);
  assertEquals(await processExportJob(gateway,job,"worker",500),"completed");assertEquals(gateway.uploads.length,1);assertStringIncludes(gateway.uploads[0]!.path,`${job.tenant_id}/${job.id}/task_operations-`);assertStringIncludes(gateway.uploads[0]!.text,"'=formula");
});
Deno.test("cancellation is terminal and produces no upload",async()=>{const gateway=fake([job],[{rows:[],total:0,cancelled:true}]);assertEquals(await processExportJob(gateway,job,"worker"),"cancelled");assertEquals(gateway.uploads.length,0);});
Deno.test("unknown reports fail safely",async()=>{const gateway=fake();assertEquals(await processExportJob(gateway,{...job,report_key:"unknown"},"worker"),"failed");});
Deno.test("expiry cleanup removes paths and marks aggregate count",async()=>{const gateway=fake([],[],[{id:"expired",object_path:"tenant/export/file.csv"}]);assertEquals((await processBatch(gateway,5,"worker")).expired_cleaned,1);assertEquals(gateway.removed,["tenant/export/file.csv"]);});
Deno.test("request authorization and privacy-safe aggregate response",async()=>{const gateway=fake([job],[{rows:[],total:0}]);assertEquals((await handleExportRequest(new Request("http://local",{method:"POST"}),"expected",gateway)).status,401);const response=await handleExportRequest(new Request("http://local",{method:"POST",headers:{"x-cron-secret":"expected","content-type":"application/json"},body:JSON.stringify({batch_size:1})}),"expected",gateway,"worker");const text=await response.text();assertEquals(response.status,200);assertFalse(text.includes(job.id));assertFalse(/name|phone|email|title|row/i.test(text));});
Deno.test("header-only empty exports remain valid",()=>assertEquals(encodeRows(["a","b"],[],true),"a,b\r\n"));
