"use client";
import { FilterPanel } from '@/components/filter-panel';
import { FollowupPager } from '@/components/followup-pager';
import { FollowupHistory } from '@/components/followup-history';
import { MoreActions } from '@/components/more-actions';
import { CallButton } from '@/components/call-button';
import { useFollowupControls } from '@/crm-port/use-followup-controls';
import type { FollowupPaging } from '@/crm-port/followup-page';

import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useMemo, useState } from "react";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { createClient } from "@/lib/supabase/client";
import { displayDate } from "@/lib/clients";
import { formatPhone } from "@/lib/phone";
import { followupSaveError, isDoneFollowup, queueTabMatches } from "@/lib/followup-logic";
import { byDate, byNumberDesc, byText, sortQueue, type Compare } from "@/lib/queue-sort";
import { normalizeRosterValue, OFF_ROSTER, rosterFilterMatches } from "@/lib/roster";
export type ReferralContext={relationship:string|null;best_time_to_call?:string|null|undefined;given_by_client_code:string|null;given_by_household_code:string|null;given_by_referral_code:string|null;referred_client_code:string|null};
export type ReferralItem={referral_context?:ReferralContext|null|undefined;id:string;status:string;next_followup_date:string|null;remark:string|null;referred_client_id?:string|null;converted_client_id:string|null;followup_count:number;crm_name:string;assigned_doer:string|null;given_by_client_id:string|null;given_by_name:string;referral_name:string;referral_number:string;salesperson:string;history:string;history_count:number;action_point:string|null;created_at?:string|null;branch_id?:string|null};
const TABS=[["today","TODAY FOLLOW UP"],["pending","ALL PENDING"],["inprocess","INPROCESS"],["done","ALL DONE"],["converted","CONVERTED TO CLIENT"]] as const;
const STATUSES=["PENDING","FOLLOW REQUIRED","CALL NOT PICKED","NOT ANSWERED","CALL CONNECTED","YES INTERESTED","INTERESTED - NEED FOLLOW UP","VISIT PLANNED","WHATSAPP SENT","CONVERTED TO CLIENT","ALREADY PURCHASED FROM MK JEWELS","NOT INTERESTED","NO REQUIREMENT AT THE MOMENT","WRONG NUMBER","DO NOT CALL"];
const RESPONSES=["CONNECTED","CALL NOT PICKED","NOT ANSWERED","WRONG NUMBER","WHATSAPP SENT"];
const doer=(x:ReferralItem)=>x.assigned_doer||x.crm_name;
// Owner request 2026-10-08: sort options. Newest first is the default, so a referral just logged from a walk-in is on top.
const SORTS:readonly (readonly [string,string,Compare<ReferralItem>])[]=[
  ["newest","NEWEST ADDED FIRST",byDate(x=>x.created_at,"desc")],
  ["oldest","OLDEST ADDED FIRST",byDate(x=>x.created_at,"asc")],
  ["next_soonest","NEXT FOLLOW UP: SOONEST",byDate(x=>x.next_followup_date,"asc")],
  ["next_latest","NEXT FOLLOW UP: LATEST",byDate(x=>x.next_followup_date,"desc")],
  ["referral","REFERRAL NAME A-Z",byText(x=>x.referral_name)],
  ["given_by","GIVEN BY CLIENT A-Z",byText(x=>x.given_by_name)],
  ["crm","CRM/DOER A-Z",byText(doer)],
  ["followups","MOST FOLLOW-UPS",byNumberDesc(x=>x.followup_count)],
];
type RpcClient={rpc:(name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>};
function businessDate(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;}
// Owner decision 2026-10-08: TODAY FOLLOW UP includes overdue referrals, as on Not Bought (the original showed only those due exactly today).
function matches(x:ReferralItem,tab:string,today:string){return queueTabMatches(x,tab,today,Boolean(x.converted_client_id));}
// The three identity columns; the Given view leads with the referrer, Received with the person introduced.
function referralCells(x:ReferralItem,view:"received"|"given",branchName:Map<string,string>){
  const ctx=x.referral_context;
  const relation=ctx?.relationship?` (${ctx.relationship})`:"";
  const doerCell=<td key="doer" data-label="CRM/DOER" data-secondary="true" className="p-3 font-semibold">{doer(x)||"—"}</td>;
  const codes=[ctx?.given_by_client_code,ctx?.given_by_household_code,ctx?.given_by_referral_code].filter(Boolean).join(" · ");
  // Given view leads with the referrer: one line says whom they referred (phones show only this; codes are in Details).
  const givenCell=<td key="given" data-label="Given by client" data-secondary={view==="given"?undefined:"true"} className="p-3">{x.given_by_client_id?<Link className="font-semibold text-amber-800 underline" href={`/clients/${x.given_by_client_id}`}>{x.given_by_name}</Link>:<span className="font-semibold">{x.given_by_name||"Not recorded"}</span>}
    {view==="given"?<div className="crm-row-sub">Referred {x.referral_name}{relation}</div>:null}
    <div className={`mt-1 font-mono text-[11px] text-stone-600${view==="given"?" crm-hide-phone":""}`}>{codes||"Client ID not recorded"}</div><div className="mt-1 crm-hide-phone"><span className="rounded bg-stone-100 px-1">HIST: {x.history_count}</span></div></td>;
  const linked=x.referred_client_id||x.converted_client_id;
  // Received view leads with the person introduced: who referred them, in one line.
  const referralCell=<td key="referral" data-label="Referral name" data-secondary={view==="given"?"true":undefined} className="p-3"><div className="font-semibold">{linked?<Link href={`/clients/${linked}`}>{x.referral_name}</Link>:x.referral_name}</div>
    {view==="received"?<div className="crm-row-sub">Referred by {x.given_by_name||"Not recorded"}{relation}</div>:null}
    <div className="mt-1 text-stone-600 crm-hide-phone">RELATION: {ctx?.relationship||"Not recorded"}{ctx?.best_time_to_call?` · BEST TIME: ${ctx.best_time_to_call}`:""}</div><div className="mt-1 font-mono text-[11px] text-stone-600 crm-hide-phone">{ctx?.referred_client_code??"Not yet a client (pending referral)"}</div>{x.created_at&&<div className="mt-1 text-stone-500 crm-hide-phone">ADDED {displayDate(x.created_at)}{x.branch_id&&branchName.get(x.branch_id)?` · ${branchName.get(x.branch_id)}`:""}</div>}</td>;
  return view==="given"?[givenCell,referralCell,doerCell]:[doerCell,givenCell,referralCell];
}
/** view: received = the people introduced (inbound calling); given = the clients who introduced them. embedded = shown inside Client Database. */
export function ReferralQueue({items,enteredByName,rosterNames=[],branches=[],paging,view="received",embedded=false}:{items:ReferralItem[];role:string;branchId:string|null;enteredByName:string;rosterNames?:string[];branches?:{id:string;name:string}[];paging?:FollowupPaging;view?:"received"|"given";embedded?:boolean}){
  const [expanded,setExpanded]=useState<string|null>(null);
  const router=useRouter();
  const {filters:{tab,crm,search,status,branch,sort},change,preload}=useFollowupControls('referral',paging,view==="given"?'given_by':'newest');
  const[open,setOpen]=useState<string|null>(null),[message,setMessage]=useState(''),[syncing,setSyncing]=useState(false);
  const today=businessDate();
  const roster=useMemo(()=>new Set(rosterNames.map(normalizeRosterValue)),[rosterNames]);
  const hasOffRoster=paging?.hasOffRoster??items.some(x=>!roster.has(normalizeRosterValue(doer(x))));
  const statuses=useMemo(()=>paging?.statuses??[...new Set(items.map(x=>x.status))].sort(),[items,paging]);
  const branchName=useMemo(()=>new Map(branches.map(b=>[b.id,b.name])),[branches]);
  const filtered=useMemo(()=>items.filter(x=>{const digits=search.replace(/\D/g,"");const text=`${x.given_by_name} ${x.referral_name} ${x.referral_number} ${x.assigned_doer??""} ${x.crm_name} ${x.status} ${x.remark??""}`.toLowerCase();return rosterFilterMatches(doer(x),crm,roster)&&(!status||x.status===status)&&(!branch||x.branch_id===branch)&&(!search||text.includes(search.toLowerCase())||(digits!==""&&x.referral_number.replace(/\D/g,"").includes(digits)))}),[items,crm,roster,status,branch,search]);
  const counts=useMemo(()=>paging?.counts??Object.fromEntries(TABS.map(([key])=>[key,filtered.filter(x=>matches(x,key,today)).length])),[filtered,today,paging]);
  const visible=useMemo(()=>paging?items:sortQueue(filtered.filter(x=>matches(x,tab,today)),(SORTS.find(([key])=>key===sort)??SORTS[0]!)[2]),[filtered,tab,today,sort,paging,items]);
  async function sync(){setSyncing(true);setMessage("");const{data,error}=await(createClient()as unknown as RpcClient).rpc("reconcile_referral_calling_conversions");setSyncing(false);if(error){setMessage("Could not sync Referrals data. Please try again or contact an administrator.");return;}setMessage(`Referrals data synced${typeof data==="number"?`: ${data} conversion(s) detected.`:"."}`);router.refresh();}
  async function save(x:ReferralItem,f:HTMLFormElement){const d=new FormData(f),status=String(d.get("status")),remark=String(d.get("remark")).trim(),next=String(d.get("next_date"));if(!isDoneFollowup(status)&&!next){setMessage("Next Follow Up Date is required.");return;}if(!isDoneFollowup(status)&&!remark){setMessage("Follow Up Remark is required.");return;}const{error}=await(createClient()as unknown as RpcClient).rpc("save_referral_followup",{p_referral_calling_id:x.id,p_followup_status:status,p_call_response:String(d.get("call_response")),p_next_followup_date:next||null,p_remark:remark||null,p_entered_by:enteredByName,p_request_key:crypto.randomUUID()});if(error){setMessage(followupSaveError(error.message,"Could not save this referral follow-up. Check the required fields and try again."));return;}setOpen(null);setMessage("Referral follow-up saved.");router.refresh();}
  return <section className={embedded?"crm-workspace-panel":"mt-6"}><div className="flex flex-wrap items-center justify-between gap-3"><div>{embedded?null:<h1 className="text-3xl font-semibold">REFERRALS CALLING</h1>}</div><MoreActions><button type="button" disabled={syncing} onClick={()=>void sync()}>{syncing?"Syncing…":"Sync referrals data"}</button><button type="button" onClick={()=>router.refresh()}>Refresh</button></MoreActions></div>
    <div className="crm-queue-tabs" aria-label="Follow-up views">{TABS.map(([key,label])=><button key={key} aria-label={label} className={tab===key?"rounded bg-amber-800 px-3 py-2 text-xs font-semibold text-white":"rounded border px-3 py-2 text-xs font-semibold"} onMouseEnter={()=>preload({tab:key})} onFocus={()=>preload({tab:key})} onTouchStart={()=>preload({tab:key})} onClick={()=>change({tab:key})}>{{today:'Today',pending:'Pending',inprocess:'In progress',done:'Done',converted:'Converted'}[key]} ({counts[key]})</button>)}</div>
    <FilterPanel activeCount={[crm,status,branch,search].filter(Boolean).length} onClear={()=>change({crm:'',status:'',branch:'',search:'',sort:view==="given"?'given_by':'newest'})}><div className="crm-filter-grid">
      <select aria-label="CRM/DOER" className="rounded border p-2 text-sm" value={crm} onChange={e=>change({crm:e.target.value})}><option value="">CRM/DOER: ALL</option>{rosterNames.map(n=><option key={n} value={normalizeRosterValue(n)}>{n}</option>)}{hasOffRoster&&<option value={OFF_ROSTER}>NOT IN CURRENT ROSTER</option>}</select>
      <select aria-label="Status" className="rounded border p-2 text-sm" value={status} onChange={e=>change({status:e.target.value})}><option value="">STATUS: ALL</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>
      {branches.length>1&&<select aria-label="Branch" className="rounded border p-2 text-sm" value={branch} onChange={e=>change({branch:e.target.value})}><option value="">BRANCH: ALL</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      <select aria-label="Sort by" className="rounded border p-2 text-sm" value={sort} onChange={e=>change({sort:e.target.value})}>{SORTS.map(([key,label])=><option key={key} value={key}>SORT: {label}</option>)}</select>

    </div></FilterPanel>
    {search ? <p className="crm-search-summary">Results for <strong>{search}</strong> <button type="button" onClick={()=>change({search:''})}>Clear search</button></p> : null}<p className="crm-flat-meta mt-2">{visible.length} of {paging?.total??items.length}{tab==="today"?" · new referrals are due the next business day":""}</p>
    {message&&<p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}<div className={embedded?"mt-4 overflow-x-auto":"mt-5 overflow-x-auto rounded border bg-white"}><table className="crm-record-table w-full text-left text-xs"><thead className="bg-stone-100 uppercase text-stone-600"><tr>{(view==="given"?["GIVEN BY CLIENT","REFERRAL NAME","CRM/DOER","REFERRAL NUMBER","SALESPERSON","STATUS","NEXT FOLLOW UP","LAST REMARK","CONVERTED CLIENT","ACTION"]:["CRM/DOER","GIVEN BY CLIENT","REFERRAL NAME","REFERRAL NUMBER","SALESPERSON","STATUS","NEXT FOLLOW UP","LAST REMARK","CONVERTED CLIENT","ACTION"]).map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{visible.map(x=><tr className={`border-t align-top ${expanded===x.id?'is-expanded':''}`} key={x.id}>{referralCells(x,view,branchName)}<td data-label="Referral number" className="p-3">{formatPhone(x.referral_number)}{x.referral_number?<div className="mt-1"><CallButton phone={x.referral_number} /></div>:null}</td><td data-label="Salesperson" data-secondary="true" className="p-3">{x.salesperson||"—"}</td><td data-label="Status" className="p-3">{x.status}</td><td data-label="Next follow up" className="p-3">{displayDate(x.next_followup_date)}</td><td data-label="Last remark" data-secondary="true" className="max-w-48 whitespace-pre-wrap p-3">{x.remark||"—"}</td><td data-label="Converted client" data-secondary="true" className="p-3">{x.converted_client_id?<Link className="text-amber-800 underline" href={`/clients/${x.converted_client_id}`}>OPEN CLIENT</Link>:"NO"}</td><td data-label="Action" className="p-3"><div className="crm-record-actions"><button type="button" className="crm-record-details" aria-label={expanded===x.id?"Hide record details":"Show record details"} aria-expanded={expanded===x.id} onClick={()=>setExpanded(expanded===x.id?null:x.id)}>{expanded===x.id?"Less":"Details"}</button><button className="rounded border px-2 py-1" onClick={()=>setOpen(open===x.id?null:x.id)}>FOLLOW UP FORM</button><button className="rounded border px-2 py-1" onClick={()=>setOpen(open===`${x.id}:history`?null:`${x.id}:history`)}>VIEW HISTORY</button></div>{open===x.id&&<form className="mt-2 grid min-w-56 gap-2" onSubmit={e=>{e.preventDefault();void save(x,e.currentTarget)}}><label>FOLLOW UP STATUS<select aria-label="Follow Up Status" name="status" defaultValue={STATUSES.find(s=>s===x.status.trim().toUpperCase())??"PENDING"} className="mt-1 w-full rounded border p-1">{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label><label>CALL RESPONSE<select aria-label="Call Response" name="call_response" defaultValue="CONNECTED" className="mt-1 w-full rounded border p-1">{RESPONSES.map(s=><option key={s}>{s}</option>)}</select></label><label>NEXT FOLLOW UP DATE<input aria-label="Next Follow Up Date" name="next_date" type="date" defaultValue={x.next_followup_date??""} className="mt-1 w-full rounded border p-1" /></label><label>ENTERED BY<input aria-label="Entered By" value={enteredByName} readOnly className="mt-1 w-full rounded border bg-stone-50 p-1" /></label><label>FOLLOW UP REMARK<textarea aria-label="Follow Up Remark" name="remark" defaultValue="" maxLength={2000} className="mt-1 w-full rounded border p-1" /></label><div className="rounded bg-stone-50 p-2 text-xs"><span className="font-semibold">ACTION POINT: </span>{x.action_point||"—"}</div><button className="rounded bg-amber-800 p-1 text-white">SAVE FOLLOW UP</button></form>}{open===`${x.id}:history`&&(paging?<FollowupHistory key={x.id} kind="referral" id={x.id}/>:<p className="mt-2 max-w-48 whitespace-pre-wrap">{x.history||"NO HISTORY YET."}</p>)}</td></tr>)}{!visible.length&&<tr><td colSpan={10} className="p-5 text-sm text-stone-600">NO REFERRALS FOUND.</td></tr>}</tbody></table></div>{paging&&<FollowupPager kind="referral" paging={paging}/>}</section>;
}
