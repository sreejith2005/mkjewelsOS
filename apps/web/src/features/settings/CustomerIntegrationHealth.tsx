import { useState } from "react";
import { supabase } from "@jewelos/api-client";
import { customerSetupStatus,type Json,type StatusTone } from "@jewelos/core";
import { Button,Notice } from "@/components/ui";
const object=(value:Json|undefined):Record<string,Json|undefined>=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
const list=(value:Json|undefined):Json[]=>Array.isArray(value)?value:[];
const toneClass:Record<StatusTone,string>={neutral:"text-task-text-muted",pending:"text-task-text",success:"text-success",warning:"text-gold-secondary",danger:"text-danger"};
const when=(value:Json|undefined)=>typeof value==="string"?new Date(value).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):"Never";
const count=(value:Json|undefined)=>typeof value==="number"?value:Number(value??0)||0;

/**
 * Settings → Customer Integration (0354 + 0356). One view of every customer-relevant form: its
 * setup state, what actually reached the CRM, and the next action. Counts and short opaque
 * references only, never customer values.
 */
export function CustomerIntegrationHealth() {
 const [overview,setOverview]=useState<Record<string,Json|undefined>|null>(null),[data,setData]=useState<Record<string,Json|undefined>>({}),[selected,setSelected]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
 async function load(){setLoading(true);setError("");try{
  const [summary,health]=await Promise.all([supabase.rpc("customer_integration_overview"),supabase.rpc("customer_integration_health")]);
  if(summary.error)throw summary.error;if(health.error)throw health.error;setOverview(object(summary.data));setData(object(health.data));
 }catch(caught){setError(caught instanceof Error?caught.message:"Integration health unavailable");}finally{setLoading(false);}}
 async function retry(){if(!selected.length||loading)return;setLoading(true);setError("");try{const response=await supabase.rpc("retry_customer_events",{p_ids:selected});if(response.error)throw response.error;setSelected([]);await load();}catch(caught){setError(caught instanceof Error?caught.message:"Retry failed");}finally{setLoading(false);}}
 const forms=list(overview?.forms).map(object),connections=object(overview?.connections),worker=object(overview?.worker);
 const roster=object(connections.rosterToCrm),walkins=object(connections.crmWalkinsToTasks);
 return <details className="rounded-xl border border-task-border bg-task-bg p-4 text-task-text" onToggle={event=>{if(event.currentTarget.open&&!overview&&!loading)void load();}}>
  <summary className="min-h-11 cursor-pointer content-center font-semibold">Customer Integration</summary>
  <div className="space-y-4 pt-3">
   <p className="text-sm text-task-text-muted">How Forms and FMS work reaches the CRM. Set up a customer form in Form Builder → Customer Data Integration; a CRM super admin approves it in CRM → Dashboard → Customer Integration Administration. After approval, submissions link on their own. Completed FMS work stays complete while the CRM sync waits.</p>
   <Button disabled={loading} onClick={()=>void load()} type="button" variant="secondary">{loading?"Loading…":"Refresh"}</Button>
   {error?<Notice tone="danger">{error}</Notice>:null}
   {overview?<>
    <section aria-label="Forms to CRM" className="space-y-2">
     <h3 className="font-semibold">Forms → CRM</h3>
     {forms.length?<ul className="space-y-2">{forms.map(form=>{const setup=customerSetupStatus(String(form.setup));const delivery=object(form.delivery);const uncaptured=count(form.uncaptured);const delayed=count(delivery.delayed);
      const issues=[count(delivery.waitingAuthorization)?`${count(delivery.waitingAuthorization)} waiting for CRM authorization`:"",count(delivery.identityReview)?`${count(delivery.identityReview)} awaiting identity review`:"",count(delivery.failed)?`${count(delivery.failed)} failed`:"",delayed?`${delayed} older than 15 minutes`:"",uncaptured?`${uncaptured} submitted but not captured`:""].filter(Boolean);
      return <li className="rounded-lg border border-task-border p-3 text-sm" key={String(form.familyId)}>
       <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{String(form.name)} <span className="font-normal text-task-text-muted">v{String(form.templateVersion)}{form.channel?` · ${String(form.channel)}`:""}</span></span><span className={`font-semibold ${toneClass[setup.tone]}`}>{setup.label}</span></p>
       <p className="text-task-text-muted">Linked to CRM: {count(delivery.linked)} · Sending: {count(delivery.queued)} · Last linked: {when(delivery.lastLinkedAt)}{delivery.lastSourceRef?` · Last submission ref ${String(delivery.lastSourceRef)}`:""}{delivery.lastClientRef?` → customer ref ${String(delivery.lastClientRef)}`:""} · Submissions in 90 days: {count(form.submissions90d)}</p>
       {issues.length?<p className="text-danger">{issues.join(" · ")}</p>:null}
       {setup.action?<p className="text-task-text-muted">Next step: {setup.action}</p>:null}
      </li>;})}</ul>:<p className="text-sm text-task-text-muted">No customer forms yet.</p>}
    </section>
    <section aria-label="Other connections" className="space-y-1 text-sm">
     <h3 className="font-semibold">Other connections</h3>
     <p>Delivery worker: last run {when(worker.lastRun)}{count(worker.failedLastDay)?` · ${count(worker.failedLastDay)} failed runs today`:""}</p>
     <p>Users → CRM roster: {count(roster.pending)} pending{count(roster.failed)?`, ${count(roster.failed)} failed`:""} · last delivered {when(roster.lastDelivered)}</p>
     <p>CRM walk-ins → Tasks: {count(walkins.received)} received · last {when(walkins.lastReceived)}</p>
     <p>FMS workflows linked to a CRM customer: {count(connections.customerWorkflowLinks)}</p>
    </section>
   </>:null}
   <details className="text-sm"><summary className="min-h-11 cursor-pointer content-center">Undelivered customer events ({count(data.pending)+count(data.review)+count(data.failed)})</summary>
    <p className="text-task-text-muted">Events waiting for approval or identity review resume on their own. Retry only failed events after fixing the cause.</p>
    <div className="space-y-2">{list(data.events).map(value=>{const event=object(value);if(typeof event.id!=="string")return null;const id=event.id;return <label className="flex min-h-11 items-center gap-2 break-all" key={id}><input checked={selected.includes(id)} onChange={change=>setSelected(current=>change.target.checked?[...current,id]:current.filter(value=>value!==id))} type="checkbox"/><span>{id.slice(0,8)} · {String(event.status)} · {String(event.last_error??"Waiting")} · {when(event.created_at)}</span></label>;})}</div>
    <Button disabled={loading||!selected.length} onClick={()=>void retry()} type="button">Retry selected customer events</Button>
   </details>
  </div>
 </details>;
}
