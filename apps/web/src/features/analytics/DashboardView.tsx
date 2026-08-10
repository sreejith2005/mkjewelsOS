import {useEffect,useMemo,useState} from "react";
import {METRIC_CATALOG,formatMetric,type MetricDefinition} from "@jewelos/core";
import {RefreshCw} from "lucide-react";
import {Button} from "@/components/ui";
import {useAuth} from "@/auth/AuthContext";
import {fetchDashboardMetrics,fetchReportingOptions,type ReportingOptions} from "./api";
import {ErrorPanel,LoadingPanels,PageHeading,PageSurface,Panel} from "./components";
import {useAsyncData} from "./useAsyncData";
import {titleCase} from "@/lib/format";

const ranges=[["today","Today"],["this_week","This week"],["this_month","This month"],["last_7_days","Last 7 days"],["last_30_days","Last 30 days"],["custom","Custom"]] as const;
const isoToday=()=>new Date().toISOString().slice(0,10);
const query=()=>new URLSearchParams(window.location.search);
function defaultRange(fallback:string){return query().get("range")??fallback;}
function setQuery(values:Record<string,string>){const params=query();for(const [key,value] of Object.entries(values)){if(value)params.set(key,value);else params.delete(key);}window.history.replaceState({},"",`${window.location.pathname}?${params}`);}

function MetricCard({definition,value,previous}:{definition:MetricDefinition;value:number|null;previous:number|null|undefined}){
  const label=formatMetric({key:definition.key,value},definition);
  const comparable=definition.comparable&&value!==null&&previous!==null&&previous!==undefined;
  const delta=comparable?value-previous:null;
  return <article className="min-h-32 border-b border-r border-task-border bg-task-bg p-4"><p className="text-xs font-medium text-task-text-muted">{definition.displayName}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{label}</p>{delta!==null?<p className={delta>0?"mt-2 text-xs text-success":delta<0?"mt-2 text-xs text-task-overdue":"mt-2 text-xs text-task-text-muted"}>{delta>0?"+":""}{definition.format==="percentage"?`${delta.toFixed(1)} pp`:Math.round(delta).toLocaleString("en-IN")} vs previous equal period</p>:<p className="mt-2 text-xs text-task-text-muted">{definition.comparable?"Previous period unavailable":"Current state"}</p>}<details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-task-accent">Definition</summary><p className="mt-2 text-xs leading-relaxed text-task-text-muted">{definition.definition}</p></details></article>;
}

function Trend({points}:{points:Array<{local_date:string;completed:number}>}){
  const max=Math.max(1,...points.map((point)=>point.completed));const width=620,height=180,pad=28;
  const coords=points.map((point,index)=>({x:points.length===1?width/2:pad+index*(width-pad*2)/(points.length-1),y:height-pad-(point.completed/max)*(height-pad*2),...point}));
  const path=coords.map((point,index)=>`${index===0?"M":"L"}${point.x},${point.y}`).join(" ");
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]"><div className="min-w-0 overflow-x-auto text-task-accent"><svg aria-label="Task completion trend with directly labelled daily values" className="h-52 min-w-[38rem] w-full" role="img" viewBox={`0 0 ${width} ${height}`}><path className="stroke-task-border" d={`M${pad},${height-pad} H${width-pad}`} fill="none"/><path d={path} fill="none" stroke="currentColor" strokeWidth="3"/>{coords.map((point)=><g key={point.local_date}><circle className="fill-task-bg stroke-task-accent" cx={point.x} cy={point.y} r="4" strokeWidth="3"/><text className="fill-task-text text-[10px]" textAnchor="middle" x={point.x} y={point.y-10}>{point.completed}</text><text className="fill-task-text-muted text-[9px]" textAnchor="middle" x={point.x} y={height-8}>{point.local_date.slice(5)}</text></g>)}</svg></div><div className="overflow-hidden rounded-lg border border-task-border"><table className="w-full text-left text-xs"><thead className="bg-task-muted"><tr><th className="p-2 font-medium">Date</th><th className="p-2 text-right font-medium">Completed</th></tr></thead><tbody>{points.map((point)=><tr className="border-t border-task-border" key={point.local_date}><td className="p-2">{point.local_date}</td><td className="p-2 text-right font-semibold tabular-nums">{point.completed}</td></tr>)}</tbody></table></div></div>;
}

export function DashboardView(){
  const {profile,branch,preferences}=useAuth();
  const [range,setRange]=useState(()=>defaultRange(preferences.dashboard_range));
  const [customFrom,setCustomFrom]=useState(()=>query().get("from")??isoToday());
  const [customTo,setCustomTo]=useState(()=>query().get("to")??isoToday());
  const [branchId,setBranchId]=useState(()=>query().get("branch_id")??"");
  const [departmentId,setDepartmentId]=useState(()=>query().get("department_id")??"");
  const [options,setOptions]=useState<ReportingOptions>({branches:[],departments:[]});
  const elevated=["super_admin","admin","manager","hr"].includes(profile!.user_role);
  const canSelectBranch=["super_admin","admin"].includes(profile!.user_role);
  useEffect(()=>{if(elevated)void fetchReportingOptions().then(setOptions);},[elevated]);
  const context=useMemo(()=>({preset:range,...(range==="custom"?{from:customFrom,to:customTo}:{}),...(branchId?{branch_id:branchId}:{}),...(departmentId?{department_id:departmentId}:{})}),[range,customFrom,customTo,branchId,departmentId]);
  const {data,error,loading,retry}=useAsyncData(()=>fetchDashboardMetrics(context),[range,customFrom,customTo,branchId,departmentId]);
  const definitions=useMemo(()=>METRIC_CATALOG.filter((item)=>item.roles.includes(profile!.user_role)&&data&&Object.hasOwn(data.metrics,item.key)),[data,profile]);
  const update=(values:Record<string,string>)=>{setQuery(values);};
  const changeRange=(value:string)=>{setRange(value);update({range:value,from:value==="custom"?customFrom:"",to:value==="custom"?customTo:""});};
  const scopedDepartments=options.departments.filter((item)=>!branchId||item.branch_id===null||item.branch_id===branchId);
  return <PageSurface>
    <PageHeading title="Analytics Dashboard" description="Live, server-scoped operational measures with transparent formulas." actions={<Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={()=>void retry()} variant="secondary"><RefreshCw/>Refresh</Button>}/>
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-task-border bg-task-bg p-3">
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Dashboard date range">{ranges.map(([value,label])=><button aria-pressed={range===value} className={range===value?"min-h-10 shrink-0 rounded-lg bg-gold px-3 text-sm font-semibold text-obsidian":"min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-task-text-muted hover:bg-task-muted"} key={value} onClick={()=>changeRange(value)} type="button">{label}</button>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {range==="custom"?<><label><span className="mb-1 block text-xs font-medium text-task-text-muted">From</span><input className="task-field" onChange={(event)=>{setCustomFrom(event.target.value);update({from:event.target.value});}} type="date" value={customFrom}/></label><label><span className="mb-1 block text-xs font-medium text-task-text-muted">To</span><input className="task-field" onChange={(event)=>{setCustomTo(event.target.value);update({to:event.target.value});}} type="date" value={customTo}/></label></>:null}
        {canSelectBranch?<label><span className="mb-1 block text-xs font-medium text-task-text-muted">Branch context</span><select className="task-field" onChange={(event)=>{setBranchId(event.target.value);setDepartmentId("");update({branch_id:event.target.value,department_id:""});}} value={branchId}><option value="">All authorized branches</option>{options.branches.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
        {elevated?<label><span className="mb-1 block text-xs font-medium text-task-text-muted">Department context</span><select className="task-field" onChange={(event)=>{setDepartmentId(event.target.value);update({department_id:event.target.value});}} value={departmentId}><option value="">All authorized departments</option>{scopedDepartments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
      </div>
      <p className="text-xs text-task-text-muted">Reporting context (read-only): {branch?.name} · {titleCase(profile?.user_role??"")} · tenant timezone {data?.context.timezone??"loading"}. Filters never change your assigned branch or department.</p>
    </div>
    {loading?<LoadingPanels count={8}/>:error?<ErrorPanel message={error} onRetry={retry}/>:data?<>
      <div className="mb-4 overflow-hidden rounded-xl border-l border-t border-task-border"><div className="grid sm:grid-cols-2 xl:grid-cols-4">{definitions.map((definition)=><MetricCard definition={definition} key={definition.key} previous={data.previous[definition.key]} value={data.metrics[definition.key]??null}/>)}</div></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,.6fr)]"><Panel title="Task completion trend" description="Daily completed tasks; values are visible in both chart and table.">{data.task_completion_trend.length?<Trend points={data.task_completion_trend}/>:<p className="py-10 text-center text-sm text-task-text-muted">No completed tasks in this range.</p>}</Panel><Panel title="Task status distribution" description="Directly labelled counts; no hover required."><div className="flex flex-col gap-4">{Object.entries(data.task_status_distribution).length?Object.entries(data.task_status_distribution).map(([status,count])=>{const total=Object.values(data.task_status_distribution).reduce((sum,value)=>sum+value,0);return <div key={status}><div className="mb-1 flex justify-between gap-3 text-xs"><span>{titleCase(status)}</span><span className="font-semibold tabular-nums">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-task-muted"><div className={status==="completed"?"h-full bg-success":status==="overdue"?"h-full bg-task-overdue":"h-full bg-warning"} style={{width:`${total?count/total*100:0}%`}}/></div></div>}):<p className="py-10 text-center text-sm text-task-text-muted">No task data in this range.</p>}</div></Panel></div>
      <p className="mt-4 text-xs text-task-text-muted">Live · generated {new Date(data.generated_at).toLocaleString("en-IN")} · inclusive local start and exclusive local end.</p>
    </>:null}
  </PageSurface>;
}
