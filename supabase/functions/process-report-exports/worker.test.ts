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
Deno.test("empty customer reports retain the reviewed question headers and order",async()=>{
 const gateway=fake([],[{rows:[],total:0,columns:[{key:"answer_b",label:"Original budget"},{key:"answer_a",label:"Original name"}]}]);
 assertEquals(await processExportJob(gateway,{...job,report_key:"customer_answers"},"worker"),"completed");
 assertEquals(gateway.uploads[0]!.text,"Original budget,Original name\r\n");
});
Deno.test("customer exports preserve phone text, nested answers, IST and reviewed layout headers",async()=>{
 const gateway=fake([],[{rows:[{source_id:"s",phone:"+919876543210",occurred_at:"2026-10-01T00:00:00Z",details:{original:false,budget:0}}],total:1}]);
 assertEquals(await processExportJob(gateway,{...job,report_key:"customer_master"},"worker"),"completed");
 assertStringIncludes(gateway.uploads[0]!.text,"Customer phone");
 assertStringIncludes(gateway.uploads[0]!.text,"'+919876543210");
 assertStringIncludes(gateway.uploads[0]!.text,"2026-10-01 05:30:00 IST");
 assertStringIncludes(gateway.uploads[0]!.text,'""original"":false');
});
Deno.test("business reports export labelled headers, IST times, Yes/No and phones as text",async()=>{
 const gateway=fake([],[{rows:[{followup_type:"Lead follow-up",customer_id:"MKC-1001",name:"=Synthetic",phone:"+91 9876543210",branch:"Main",status:"open",due_date:"2026-11-03",overdue:true,attempts:2,created_at:"2026-11-01T18:45:00Z"}],total:1}]);
 assertEquals(await processExportJob(gateway,{...job,report_key:"customer_report_followups"},"worker"),"completed");
 const text=gateway.uploads[0]!.text;
 assertStringIncludes(text,"Type,Customer ID,Name,Phone,Branch,Status,Due date,Overdue,Attempts");
 assertStringIncludes(text,"Created (IST)");
 assertStringIncludes(text,'"=""+91 9876543210"""');
 assertStringIncludes(text,"'=Synthetic");
 assertStringIncludes(text,",Yes,2,");
 assertStringIncludes(text,"2026-11-02 00:15");
});
Deno.test("one form's question columns from the server become the CSV headers",async()=>{
 const columns=[{key:"form_name",label:"Form"},{key:"q:customer_name",label:"Customer Name"},{key:"q:customer_number",label:"Customer Number",phone:true},{key:"submitted_at",label:"Submitted (Asia/Kolkata)",instant:true}];
 const gateway=fake([],[{rows:[{form_name:"Walk-in enquiry","q:customer_name":"Asha","q:customer_number":"9876543210",submitted_at:"2026-11-02T04:30:00Z"},{form_name:"Walk-in enquiry","q:customer_name":"Ravi",submitted_at:"2026-11-02T05:00:00Z"}],total:2,columns}]);
 assertEquals(await processExportJob(gateway,{...job,report_key:"form_answers"},"worker"),"completed");
 assertEquals(gateway.uploads[0]!.text,'Form,Customer Name,Customer Number,Submitted (Asia/Kolkata)\r\nWalk-in enquiry,Asha,"=""9876543210""",2026-11-02 10:00\r\nWalk-in enquiry,Ravi,,2026-11-02 10:30\r\n');
});
Deno.test("an export fails rather than mixing two different column layouts",async()=>{
 const gateway=fake([],[{rows:[{a:1}],total:2,columns:[{key:"a",label:"A"}]},{rows:[{a:2}],total:2,columns:[{key:"b",label:"B"}]}]);
 assertEquals(await processExportJob(gateway,{...job,report_key:"form_answers"},"worker",1),"failed");
});
