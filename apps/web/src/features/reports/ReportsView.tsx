import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {hasPermission,REPORT_CATALOG,parseReportFilters,reportStatusOptions,reportsForRole,type ReportDefinition,type ReportFilters} from "@jewelos/core";
import {CalendarRange,Download,FileSpreadsheet,RefreshCw,RotateCcw,Square,X} from "lucide-react";
import {useAuth} from "@/auth/AuthContext";
import {Button} from "@/components/ui";
import {EmptyMessage,ErrorPanel,LoadingPanels,PageHeading,PageSurface,Panel,StatusDot} from "@/features/analytics/components";
import {fetchReportingOptions,type ReportingOptions} from "@/features/analytics/api";
import {exportActionsForStatus,type ExportStatus} from "@/features/analytics/presentation";
import {cancelExport,fetchReport,requestExport,retryExport,signedExportUrl,type ReportPayload} from "./api";
import {titleCase} from "@/lib/format";
import {cn} from "@/lib/utils";
import {useTenantRealtimeRefresh} from "@/features/realtime/useTenantRealtimeRefresh";

const istDay=(date:Date)=>date.toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});
const shiftDay=(day:string,days:number)=>{const value=new Date(`${day}T00:00:00+05:30`);value.setDate(value.getDate()+days);return istDay(value);};
const QUICK_RANGES=[{id:"today",label:"Today"},{id:"7",label:"Last 7 days"},{id:"30",label:"Last 30 days"},{id:"month",label:"This month"}] as const;
type QuickRange=(typeof QUICK_RANGES)[number]["id"];
function quickRange(id:QuickRange,today:string=istDay(new Date())){if(id==="today")return {from:today,to:today};if(id==="7")return {from:shiftDay(today,-6),to:today};if(id==="month")return {from:`${today.slice(0,7)}-01`,to:today};return {from:shiftDay(today,-29),to:today};}
function activeQuickRange(filters:ReportFilters):QuickRange|null{return QUICK_RANGES.find((range)=>{const value=quickRange(range.id);return value.from===filters.from&&value.to===filters.to;})?.id??null;}

function initialParams(definition:ReportDefinition){const defaults=quickRange("30");const params=new URLSearchParams(window.location.search);if(!params.get("from"))params.set("from",defaults.from);if(!params.get("to"))params.set("to",defaults.to);if(!params.get("page"))params.set("page","1");if(!params.get("page_size"))params.set("page_size","25");try{return parseReportFilters(params,definition);}catch{return parseReportFilters({...defaults,page:"1",page_size:"25"},definition);}}
function writeUrl(report:string,filters:ReportFilters){const params=new URLSearchParams({report});for(const [key,value] of Object.entries(filters))if(value!==undefined)params.set(key,String(value));window.history.replaceState({},"",`${window.location.pathname}?${params}`);}
function renderCell(value:unknown){if(value===null||value===undefined||value==="")return "—";if(typeof value==="boolean")return value?"Yes":"No";if(typeof value==="number")return Number.isInteger(value)?value.toLocaleString("en-IN"):value.toFixed(1);const text=String(value);if(/^\d{4}-\d{2}-\d{2}T/.test(text))return new Date(text).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});return titleCase(text);}
const STATUS_COLUMN=/(^|_)(status|state)$/;
function statusTone(value:string):"success"|"warning"|"danger"|"neutral"{if(/^(completed|approved|on_time|within_sla|delivered|available|present)$/.test(value))return "success";if(/^(overdue|rejected|failed|breached|blocked|cancelled|expired|absent|failed_terminal)$/.test(value))return "danger";if(/^(pending|in_progress|in_review|queued|processing|at_risk|submitted)$/.test(value))return "warning";return "neutral";}
function Cell({column,value}:{column:string;value:unknown}){if(STATUS_COLUMN.test(column)&&typeof value==="string"&&value)return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-task-muted px-2 py-0.5 text-xs font-medium"><StatusDot tone={statusTone(value)}/>{titleCase(value)}</span>;return <>{renderCell(value)}</>;}

export function ReportsView(){
  const {access,profile}=useAuth();
  const catalog=useMemo(()=>reportsForRole(profile!.user_role),[profile]);
  const requested=new URLSearchParams(window.location.search).get("report");
  const [definition,setDefinition]=useState(()=>catalog.find((item)=>item.key===requested)??catalog[0]!);
  const [filters,setFilters]=useState<ReportFilters>(()=>initialParams(definition));
  const [data,setData]=useState<ReportPayload|null>(null);const [history,setHistory]=useState<ReportPayload|null>(null);
  const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [message,setMessage]=useState<string|null>(null);const [exporting,setExporting]=useState(false);
  const [options,setOptions]=useState<ReportingOptions>({branches:[],departments:[]});
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current+=1;},[]);
  const elevated=["super_admin","admin","manager","hr"].includes(profile!.user_role);
  const canSelectBranch=["super_admin","admin"].includes(profile!.user_role);
  const canExport=definition.exportEligible&&hasPermission(access,"reports.export");
  useEffect(()=>{if(elevated)void fetchReportingOptions().then(setOptions).catch(()=>undefined);},[elevated]);
  const load=useCallback(async(showLoading=true)=>{const request=++generation.current;if(showLoading)setLoading(true);setError(null);try{const [preview,exports]=await Promise.all([fetchReport(definition.key,filters),fetchReport("export_history",{from:shiftDay(istDay(new Date()),-29),to:istDay(new Date()),page:1,page_size:25})]);if(request!==generation.current)return;setData(preview);setHistory(exports);}catch(error){if(request===generation.current)setError(error instanceof Error?error.message:"Report request failed");}finally{if(request===generation.current)setLoading(false);}},[definition,filters]);
  const requestRefresh=useTenantRealtimeRefresh({tenantId:profile?.tenant_id,topics:["tasks","fms","forms","organization","settings"],refresh:()=>load(false)});
  useEffect(()=>{writeUrl(definition.key,filters);void load();},[definition,filters,load]);
  const pending=history?.rows.some((row)=>row.status==="queued"||row.status==="processing")??false;
  useEffect(()=>{if(!pending)return;const timer=window.setInterval(requestRefresh,5000);return()=>window.clearInterval(timer);},[pending,requestRefresh]);
  const changeReport=(key:string)=>{const next=REPORT_CATALOG.find((item)=>item.key===key);if(!next||next.key===definition.key)return;setDefinition(next);setFilters((current)=>parseReportFilters({from:current.from,to:current.to,page:"1",page_size:String(current.page_size)},next));};
  const changeFilters=(patch:Partial<ReportFilters>)=>setFilters((current)=>{const next={...current,page:1,...patch} as Record<string,unknown>;for(const key of Object.keys(next))if(next[key]===""||next[key]===undefined)delete next[key];return next as ReportFilters;});
  const statusOptions=reportStatusOptions(definition.key);
  const doExport=async()=>{setExporting(true);setMessage(null);setError(null);try{await requestExport(definition.key,filters);setMessage("Your CSV is being prepared. It appears under “Your exports” below, usually within a minute.");await load(false);}catch(error){setError(error instanceof Error?error.message:"Export request failed");}finally{setExporting(false);}};
  const lifecycle=async(action:"cancel"|"retry"|"download",id:string)=>{setMessage(null);try{if(action==="cancel")await cancelExport(id);else if(action==="retry")await retryExport(id);else{window.location.assign(await signedExportUrl(id));return;}setMessage(action==="cancel"?"Export cancelled.":"Export queued again.");await load(false);}catch(error){setError(error instanceof Error?error.message:"Export action failed");}};
  const totalPages=Math.max(1,Math.ceil((data?.total??0)/filters.page_size));
  const scopedDepartments=options.departments.filter((item)=>!filters.branch_id||item.branch_id===null||item.branch_id===filters.branch_id);
  const active=activeQuickRange(filters);
  const hasNarrowing=!!(filters.branch_id||filters.department_id||filters.status);
  const reportName=(key:string)=>REPORT_CATALOG.find((item)=>item.key===key)?.name??titleCase(key);

  return <PageSurface>
    <PageHeading title="Reports" description="Pick a report, check the preview, then export it as a CSV file." actions={canExport?<Button disabled={exporting||loading||!data?.total} onClick={()=>void doExport()}><FileSpreadsheet/>{exporting?"Preparing…":"Export CSV"}</Button>:undefined}/>

    <nav aria-label="Reports" className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {catalog.filter((item)=>item.key!=="export_history").map((item)=><button aria-pressed={item.key===definition.key} className={cn("min-h-11 rounded-xl border p-3 text-left transition-colors",item.key===definition.key?"border-gold bg-gold/10 shadow-card":"border-task-border bg-task-bg hover:border-gold/50")} key={item.key} onClick={()=>changeReport(item.key)} type="button">
        <span className="block text-sm font-semibold">{item.name}</span>
        <span className="mt-0.5 block text-xs leading-snug text-task-text-muted">{item.description}</span>
      </button>)}
    </nav>

    <section aria-label="Report filters" className="mb-5 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange aria-hidden className="size-4 text-task-text-muted"/>
        {QUICK_RANGES.map((range)=><button aria-pressed={active===range.id} className={cn("min-h-9 rounded-full px-3 text-xs font-medium",active===range.id?"bg-gold font-semibold text-on-gold":"bg-task-muted text-task-text hover:bg-gold/10")} key={range.id} onClick={()=>changeFilters(quickRange(range.id))} type="button">{range.label}</button>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">From</span><input className="task-field" max={filters.to} onChange={(event)=>{if(event.target.value)changeFilters({from:event.target.value});}} type="date" value={filters.from}/></label>
        <label><span className="mb-1 block text-xs font-medium text-task-text-muted">To</span><input className="task-field" min={filters.from} onChange={(event)=>{if(event.target.value)changeFilters({to:event.target.value});}} type="date" value={filters.to}/></label>
        {canSelectBranch&&definition.filters.includes("branch_id")?<label><span className="mb-1 block text-xs font-medium text-task-text-muted">Branch</span><select className="task-field" onChange={(event)=>changeFilters({branch_id:event.target.value,department_id:""})} value={filters.branch_id??""}><option value="">All branches</option>{options.branches.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
        {elevated&&definition.filters.includes("department_id")?<label><span className="mb-1 block text-xs font-medium text-task-text-muted">Department</span><select className="task-field" onChange={(event)=>changeFilters({department_id:event.target.value})} value={filters.department_id??""}><option value="">All departments</option>{scopedDepartments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
        {definition.filters.includes("status")?<label><span className="mb-1 block text-xs font-medium text-task-text-muted">Status</span>{statusOptions?<select className="task-field" onChange={(event)=>changeFilters({status:event.target.value})} value={filters.status??""}><option value="">All statuses</option>{statusOptions.map((value)=><option key={value} value={value}>{titleCase(value)}</option>)}</select>:<input className="task-field" onChange={(event)=>changeFilters({status:event.target.value.toLowerCase().replace(/\s+/g,"_")})} placeholder="All statuses" value={filters.status??""}/>}</label>:null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-task-text-muted">
        <span>Up to {definition.maxDateRangeDays} days per report. You only see records your role is allowed to see.</span>
        {hasNarrowing?<button className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 font-medium text-task-text hover:bg-task-muted" onClick={()=>changeFilters({branch_id:"",department_id:"",status:""})} type="button"><X className="size-3.5"/>Clear filters</button>:null}
      </div>
    </section>

    {message?<p aria-live="polite" className="mb-4 rounded-xl border border-success/40 bg-task-bg p-3 text-sm text-success">{message}</p>:null}

    {loading&&!data?<LoadingPanels count={2}/>:error?<ErrorPanel message={error} onRetry={()=>void load()}/>:data?<>
      <Panel title={definition.name} description={`${data.total.toLocaleString("en-IN")} row${data.total===1?"":"s"} · ${filters.from} to ${filters.to}${loading?" · updating…":""}`}>
        {data.rows.length===0?<EmptyMessage>No records match these filters. Try a wider date range.</EmptyMessage>:<>
          <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[48rem] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-task-text-muted"><tr>{definition.columns.map((column)=><th className="whitespace-nowrap pb-2 pr-4 font-medium" key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{data.rows.map((row,index)=><tr className="border-t border-task-border even:bg-task-muted/40" key={String(row[definition.columns[0]!.key]??index)}>{definition.columns.map((column)=><td className="max-w-72 truncate py-2.5 pr-4" key={column.key}><Cell column={column.key} value={row[column.key]}/></td>)}</tr>)}</tbody></table></div>
          <div className="grid gap-3 sm:hidden">{data.rows.map((row,index)=><article className="rounded-xl border border-task-border p-3" key={String(row[definition.columns[0]!.key]??index)}>{definition.columns.map((column)=><div className="flex justify-between gap-3 border-b border-task-border py-2 last:border-0" key={column.key}><span className="text-xs text-task-text-muted">{column.label}</span><span className="max-w-[60%] break-words text-right text-sm font-medium"><Cell column={column.key} value={row[column.key]}/></span></div>)}</article>)}</div>
        </>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={filters.page<=1} onClick={()=>changeFilters({page:filters.page-1})} variant="secondary">Previous</Button>
          <span className="text-xs text-task-text-muted">Page {filters.page} of {totalPages}</span>
          <label className="flex items-center gap-2 text-xs text-task-text-muted">Rows<select className="task-field w-20 py-1" onChange={(event)=>changeFilters({page_size:Number(event.target.value)})} value={filters.page_size}>{[10,25,50,100].map((size)=><option key={size}>{size}</option>)}</select></label>
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={filters.page>=totalPages} onClick={()=>changeFilters({page:filters.page+1})} variant="secondary">Next</Button>
        </div>
      </Panel>

      <Panel className="mt-5" title="Your exports" description="CSV files from the last 30 days. Each file is private to you and expires automatically.">
        {!history?.rows.length?<EmptyMessage>No exports yet. Use “Export CSV” above to create one.</EmptyMessage>:<ul className="flex flex-col gap-2">{history.rows.map((row)=>{const status=String(row.status) as ExportStatus;const actions=exportActionsForStatus(status);const progress=Number(row.progress_percent??0);return <li className="rounded-xl border border-task-border p-3 text-sm" key={String(row.export_id)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-medium">{reportName(String(row.report_key))}</p><p className="text-xs text-task-text-muted">Requested {renderCell(row.requested_at)}{status==="completed"?` · ${renderCell(row.row_count)} rows · expires ${renderCell(row.expires_at)}`:""}</p></div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-task-muted px-2 py-0.5 text-xs font-medium"><StatusDot tone={statusTone(status)}/>{status==="queued"?"Waiting":status==="processing"?"Preparing":titleCase(status)}</span>
              {actions.includes("download")?<Button onClick={()=>void lifecycle("download",String(row.export_id))}><Download/>Download</Button>:null}
              {actions.includes("cancel")?<button aria-label="Cancel export" className="flex size-10 items-center justify-center rounded-lg hover:bg-task-muted" onClick={()=>void lifecycle("cancel",String(row.export_id))} type="button"><Square className="size-4"/></button>:null}
              {actions.includes("retry")?<Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={()=>void lifecycle("retry",String(row.export_id))} variant="secondary"><RotateCcw/>Try again</Button>:null}
            </div>
          </div>
          {status==="queued"||status==="processing"?<div aria-label={`Export ${progress}% ready`} className="mt-2 h-1.5 overflow-hidden rounded-full bg-task-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full rounded-full bg-gold transition-[width]" style={{width:`${Math.max(4,progress)}%`}}/></div>:null}
        </li>;})}</ul>}
        <Button className="mt-3 border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={()=>void load(false)} variant="secondary"><RefreshCw/>Refresh</Button>
      </Panel>
    </>:null}
  </PageSurface>;
}
