"use client";
import { useEffect,useRef,useState } from "react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { customerHistory,customerCommercial,type CustomerWorkflowEvent } from "@/lib/customer-integration";
import { HistoryValue,RecentHistory,historyDate } from "@/components/profile-history-display";
export function CustomerWorkflows({clientId,actorNames={}}:{clientId:string;actorNames?:Record<string,string>}) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState<CustomerWorkflowEvent[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[more,setMore]=useState(true);
 const generation=useRef(0);
 const [commercial,setCommercial]=useState<{clientId:string;classification:string;first:string|null;latest:string|null}|null>(null);
 useEffect(()=>{if(!open)return;let active=true;void customerCommercial(clientId).then(value=>{if(active)setCommercial({...value,clientId});}).catch(()=>{if(active)setCommercial(null);});return()=>{active=false;};},[clientId,open]);
 useEffect(()=>{generation.current++;setRows([]);setError("");setMore(true);if(!open)return;let active=true;setLoading(true);void customerHistory(clientId).then(items=>{if(active){setRows(items);setMore(items.length===25);}}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"Unable to load FMS journeys");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[clientId,open]);
 async function older(){const last=rows.at(-1),requestGeneration=generation.current;if(!last||loading)return;setLoading(true);setError("");try{const items=await customerHistory(clientId,{at:last.at,id:last.id});if(requestGeneration===generation.current){setRows(current=>[...current,...items]);setMore(items.length===25);}}catch(caught){if(requestGeneration===generation.current)setError(caught instanceof Error?caught.message:"Unable to load older events");}finally{if(requestGeneration===generation.current)setLoading(false);}}
 return <details className="crm-customer-journeys" onToggle={event=>setOpen(event.currentTarget.open)}><summary>FMS Journeys &amp; Collected Answers</summary>{open?<div>
  {commercial?.clientId===clientId?<p>Commercial classification: {commercial.classification}{commercial.first?` · First verified purchase: ${historyDate(commercial.first,true)}`:""}{commercial.latest?` · Latest verified purchase: ${historyDate(commercial.latest,true)}`:""}</p>:null}
  {error?<p role="alert">{error}</p>:null}{!rows.length&&!loading&&!error?<p>No synchronized FMS contributions yet.</p>:null}
  <RecentHistory noun="FMS contributions">{rows.map(row=>{const instance=row.workflow.instanceId,visit=row.workflow.instanceStageId;return <details key={row.id} className="crm-customer-event"><summary><span>{String(row.workflow.stageName??"Customer enquiry")}</span><time dateTime={row.at}>{historyDate(row.at,true)}</time><span>{row.channel}</span></summary><div>
   <p>Completed or submitted by: {typeof row.workflow.actorName==="string"?row.workflow.actorName:row.actorId?actorNames[row.actorId]??row.actorId:row.sourceActorId??"Historical employee"}</p>
   <p>Assigned employees: {Array.isArray(row.workflow.assignedEmployees)?row.workflow.assignedEmployees.map(value=>value&&typeof value==="object"&&!Array.isArray(value)?String(value.name??value.id??""):"").join(", "):Array.isArray(row.workflow.assignedUserIds)?row.workflow.assignedUserIds.join(", "):"Not recorded"}</p>
   <p>Workflow: {String(row.workflow.referenceNumber??row.workflow.instanceId??"Standalone form")} · {row.kind}</p>
   {typeof instance==="string"?<a href={fmsAssignedWorkPath({kind:"stage",instanceId:instance,instanceStageId:typeof visit==="string"?visit:null})}>Open workflow work</a>:null}
   <p className="text-xs">Form version: {String(row.provenance.formVersion??"Historical")} · Mapping version: {String(row.provenance.mappingVersion??"Historical")} · Submission: {String(row.provenance.submissionId??"Stage event")}</p>
   <dl>{row.answers.map(answer=><div className="crm-customer-answer" key={answer.key}><dt>{answer.label}</dt><dd>{answer.labels.length?<><p>{answer.labels.join(", ")}</p><details><summary>Original saved value</summary><HistoryValue value={answer.original}/></details></>:<HistoryValue value={answer.original}/>}</dd></div>)}</dl>
  </div></details>;})}</RecentHistory>
  {loading?<p role="status">Loading FMS contributions…</p>:null}{rows.length>0&&more?<button type="button" disabled={loading} onClick={()=>void older()}>Show older FMS contributions</button>:null}
 </div>:null}</details>;
}
