import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {businessReports,crmReportFilters,hasPermission,jewelosReportFilters,parseReportFilters,PURCHASE_CLASSES,REPORT_CATEGORIES,reportDisplayName,reportStatusOptions,reportVariants,type ReportDefinition,type ReportFilterKey,type ReportFilters} from "@jewelos/core";
import {createCrmReportReader,type CrmReportOptions,type CrmReportCustomer} from "@jewelos/crm-ui/analytics";
import {supabase} from "@jewelos/api-client";
import {CalendarRange,Download,FileSpreadsheet,Info,RefreshCw,RotateCcw,Search,Square,X} from "lucide-react";
import {useAuth} from "@/auth/AuthContext";
import {Button} from "@/components/ui";
import {EmptyMessage,ErrorPanel,LoadingPanels,PageHeading,PageSurface,Panel,StatusDot} from "@/features/analytics/components";
import {fetchReportingOptions,type ReportingOptions} from "@/features/analytics/api";
import {exportActionsForStatus,type ExportStatus} from "@/features/analytics/presentation";
import {crmProjectConfig} from "@/lib/crmProject";
import {titleCase} from "@/lib/format";
import {cn} from "@/lib/utils";
import {useTenantRealtimeRefresh} from "@/features/realtime/useTenantRealtimeRefresh";
import {cancelExport,fetchReport,fetchReportFilterOptions,requestCrmExport,requestExport,retryExport,signedExportUrl,type ReportFilterOptions,type ReportPayload} from "./api";
import {reportCellText,ReportTable,serverColumns} from "./ReportTable";

const istDay=(date:Date)=>date.toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});
const shiftDay=(day:string,days:number)=>{const value=new Date(`${day}T00:00:00+05:30`);value.setDate(value.getDate()+days);return istDay(value);};
const QUICK_RANGES=[{id:"today",label:"Today"},{id:"7",label:"Last 7 days"},{id:"30",label:"Last 30 days"},{id:"month",label:"This month"}] as const;
type QuickRange=(typeof QUICK_RANGES)[number]["id"];
function quickRange(id:QuickRange,today:string=istDay(new Date())){if(id==="today")return {from:today,to:today};if(id==="7")return {from:shiftDay(today,-6),to:today};if(id==="month")return {from:`${today.slice(0,7)}-01`,to:today};return {from:shiftDay(today,-29),to:today};}
function activeQuickRange(filters:ReportFilters):QuickRange|null{return QUICK_RANGES.find((range)=>{const value=quickRange(range.id);return value.from===filters.from&&value.to===filters.to;})?.id??null;}

/** Filters for a report: the given values first, then the report's default range. */
function startingFilters(definition:ReportDefinition,source:URLSearchParams|Record<string,string>):ReportFilters{
  const params=new URLSearchParams(source instanceof URLSearchParams?source:Object.entries(source));
  if(!params.get("page"))params.set("page","1");if(!params.get("page_size"))params.set("page_size","25");
  if(!definition.dateOptional&&(!params.get("from")||!params.get("to"))){const defaults=quickRange("30");params.set("from",defaults.from);params.set("to",defaults.to);}
  try{return parseReportFilters(params,definition);}catch{const fallback:Record<string,string>={page:"1",page_size:"25"};if(!definition.dateOptional)Object.assign(fallback,quickRange("30"));return parseReportFilters(fallback,definition);}
}
function writeUrl(report:string,filters:ReportFilters){const params=new URLSearchParams({report});for(const [key,value] of Object.entries(filters))if(value!==undefined&&value!=="")params.set(key,String(value));window.history.replaceState({},"",`${window.location.pathname}?${params}`);}

const WORK_KINDS=[["all","Tasks and FMS steps"],["task","Regular tasks"],["fms","FMS steps"]] as const;
const EMPLOYEE_LABEL:Readonly<Record<string,string>>={customer_report_master:"Salesperson",customer_report_leads:"Registered by",customer_report_sources:"Registered by",customer_report_followups:"Owner",customer_report_crm_staff:"Employee",customer_report_sales:"Salesperson"};
const STATUS_LABEL:Readonly<Record<string,string>>={customer_report_followups:"Follow-up status",fms_workflow_summary:"Status or outcome",fms_stage_visits:"Status or timing",work_register:"Status or timing",people_availability:"Availability",form_answers:"Review status"};
const field="task-field";
const chip=(selected:boolean)=>cn("min-h-9 rounded-full px-3 text-xs font-medium",selected?"bg-gold font-semibold text-on-gold":"bg-task-muted text-task-text hover:bg-gold/10");
function Labelled({label,children}:{label:string;children:ReactNode}){return <label className="min-w-0"><span className="mb-1 block text-xs font-medium text-task-text-muted">{label}</span>{children}</label>;}
type FilterPatch=Partial<Record<keyof ReportFilters,string|number|undefined>>;

export function ReportsView(){
  const {access,profile}=useAuth();
  const role=profile!.user_role;
  const crmReader=useMemo(()=>crmProjectConfig.url&&crmProjectConfig.anonKey?createCrmReportReader({jewelos:supabase,crmProject:crmProjectConfig}):null,[]);
  const catalog=useMemo(()=>businessReports(role,(key)=>hasPermission(access,key)).filter((item)=>item.source!=="crm"||crmReader!==null),[role,access,crmReader]);
  const [definition,setDefinition]=useState<ReportDefinition|undefined>(()=>{const requested=new URLSearchParams(window.location.search).get("report");return catalog.find((item)=>item.key===requested)??catalog[0];});
  const [filters,setFilters]=useState<ReportFilters>(()=>definition?startingFilters(definition,new URLSearchParams(window.location.search)):{page:1,page_size:25});
  const [data,setData]=useState<ReportPayload|null>(null);const [history,setHistory]=useState<ReportPayload|null>(null);
  const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [message,setMessage]=useState<string|null>(null);const [exporting,setExporting]=useState(false);
  const [places,setPlaces]=useState<ReportingOptions>({branches:[],departments:[]});
  const [choices,setChoices]=useState<ReportFilterOptions>({forms:[],flows:[],stages:[],employees:[]});
  const [crmChoices,setCrmChoices]=useState<CrmReportOptions|null>(null);
  const [searchText,setSearchText]=useState(filters.search??"");
  const [customerSearch,setCustomerSearch]=useState("");const [customers,setCustomers]=useState<CrmReportCustomer[]>([]);const [customer,setCustomer]=useState<CrmReportCustomer|null>(null);
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current+=1;},[]);
  const elevated=["super_admin","admin","manager","hr"].includes(role);
  const canSelectBranch=["super_admin","admin"].includes(role);
  const isCrm=definition?.source==="crm";
  const needsCustomer=definition?.key==="customer_report_journey";
  const canExport=!!definition?.exportEligible&&hasPermission(access,"reports.export");

  useEffect(()=>{if(elevated)void fetchReportingOptions().then(setPlaces).catch(()=>undefined);},[elevated]);
  useEffect(()=>{if(!definition||isCrm)return;void fetchReportFilterOptions(filters.flow_family_id).then(setChoices).catch(()=>undefined);},[definition,isCrm,filters.flow_family_id]);
  useEffect(()=>{if(!isCrm||!crmReader||crmChoices)return;void crmReader.options().then(setCrmChoices).catch(()=>undefined);},[isCrm,crmReader,crmChoices]);
  useEffect(()=>{if(!needsCustomer||!crmReader||customerSearch.trim().length<2){setCustomers([]);return;}const timer=window.setTimeout(()=>{void crmReader.customers(customerSearch.trim()).then(setCustomers).catch(()=>setCustomers([]));},300);return()=>window.clearTimeout(timer);},[customerSearch,crmReader,needsCustomer]);

  const load=useCallback(async(showLoading=true)=>{
    if(!definition)return;
    const request=++generation.current;if(showLoading)setLoading(true);setError(null);
    try{
      const today=istDay(new Date());
      const offset=(filters.page-1)*filters.page_size;
      const preview:Promise<ReportPayload>=definition.source==="crm"
        ?(needsCustomer&&!filters.client_id||!crmReader?Promise.resolve({report_key:definition.key,rows:[],total:0}):crmReader.report(definition.key,crmReportFilters(filters),offset,filters.page_size).then((page)=>({report_key:definition.key,...page})))
        :fetchReport(definition.key,jewelosReportFilters(filters));
      const [rows,exports]=await Promise.all([preview,fetchReport("export_history",jewelosReportFilters({from:shiftDay(today,-29),to:today,page:1,page_size:25}))]);
      if(request!==generation.current)return;setData(rows);setHistory(exports);
    }catch(caught){if(request===generation.current)setError(caught instanceof Error?caught.message:"Report request failed");}
    finally{if(request===generation.current)setLoading(false);}
  },[definition,filters,crmReader,needsCustomer]);
  const requestRefresh=useTenantRealtimeRefresh({tenantId:profile?.tenant_id,topics:["tasks","fms","forms","organization","settings"],refresh:()=>load(false)});
  useEffect(()=>{if(!definition)return;writeUrl(definition.key,filters);void load();},[definition,filters,load]);
  const pending=history?.rows.some((row)=>row.status==="queued"||row.status==="processing")??false;
  useEffect(()=>{if(!pending)return;const timer=window.setInterval(requestRefresh,5000);return()=>window.clearInterval(timer);},[pending,requestRefresh]);

  const changeReport=(next:ReportDefinition|undefined)=>{if(!next||next.key===definition?.key)return;setDefinition(next);setData(null);setSearchText("");setCustomer(null);setCustomerSearch("");
    setFilters((current)=>startingFilters(next,{...(current.from&&current.to?{from:current.from,to:current.to}:{}),...(next.family&&next.family===definition?.family?Object.fromEntries(Object.entries(current).filter(([key,value])=>next.filters.includes(key as ReportFilterKey)&&value!==undefined).map(([key,value])=>[key,String(value)])):{}),page_size:String(current.page_size)}));};
  const changeFilters=(patch:FilterPatch)=>setFilters((current)=>{const next={...current,page:1,...patch} as Record<string,unknown>;for(const key of Object.keys(next))if(next[key]===""||next[key]===undefined)delete next[key];return next as ReportFilters;});
  const doExport=async()=>{if(!definition)return;setExporting(true);setMessage(null);setError(null);try{
    if(definition.source==="crm"){await requestCrmExport(definition.key,crmReportFilters(filters));setMessage("Your CSV is being prepared and appears under “Your exports” below. Customer exports need CRM administrator access; without it the file shows as failed.");}
    else{await requestExport(definition.key,jewelosReportFilters(filters));setMessage("Your CSV is being prepared. It appears under “Your exports” below, usually within a minute.");}
    await load(false);}catch(caught){setError(caught instanceof Error?caught.message:"Export request failed");}finally{setExporting(false);}};
  const lifecycle=async(action:"cancel"|"retry"|"download",id:string)=>{setMessage(null);try{if(action==="cancel")await cancelExport(id);else if(action==="retry")await retryExport(id);else{window.location.assign(await signedExportUrl(id));return;}setMessage(action==="cancel"?"Export cancelled.":"Export queued again.");await load(false);}catch(caught){setError(caught instanceof Error?caught.message:"Export action failed");}};

  if(!definition)return <PageSurface><PageHeading title="Reports" description="Business reports and CSV exports."/><EmptyMessage>No reports are available for your access. Ask an administrator if you need one.</EmptyMessage></PageSurface>;

  const has=(key:ReportFilterKey)=>definition.filters.includes(key);
  const category=definition.category??"operations";
  // One card per report family (the FMS journey's two modes share a card).
  const cards=catalog.filter((item,index)=>item.category===category&&(!item.family||catalog.findIndex((other)=>other.family===item.family)===index));
  const variants=reportVariants(definition).filter((item)=>catalog.includes(item));
  const columns=data?.columns?.length?serverColumns(data.columns):definition.columns;
  const totalPages=Math.max(1,Math.ceil((data?.total??0)/filters.page_size));
  const scopedDepartments=places.departments.filter((item)=>!filters.branch_id||item.branch_id===null||item.branch_id===filters.branch_id);
  const active=activeQuickRange(filters);
  const statusOptions=reportStatusOptions(definition.key);
  const employeeChoices=isCrm?(crmChoices?.employees??[]):choices.employees;
  const narrowing=(Object.keys(filters) as (keyof ReportFilters)[]).some((key)=>!["from","to","page","page_size","client_id"].includes(key)&&filters[key]!==undefined);
  const range=filters.from&&filters.to?`${filters.from} to ${filters.to}`:"all dates";
  const summary=definition.summary?.filter((item)=>data?.summary?.[item.key]!==undefined)??[];
  const exportDisabled=exporting||loading||!data?.total||(needsCustomer&&!filters.client_id);

  return <PageSurface>
    <PageHeading title="Reports" description="Choose a report, check the preview, then export every matching record as a CSV file." actions={canExport?<Button disabled={exportDisabled} onClick={()=>void doExport()}><FileSpreadsheet/>{exporting?"Preparing…":"Export CSV"}</Button>:undefined}/>

    {/* Desktop: the report catalogue is a rail beside the report, so choosing and reading happen side by side. */}
    <div className="mx-auto max-w-[120rem] xl:grid xl:grid-cols-[17.5rem_minmax(0,1fr)] xl:items-start xl:gap-5">
    <aside aria-label="Report catalogue" className="xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
    <nav aria-label="Report categories" className="mb-3 flex gap-2 overflow-x-auto pb-1 xl:flex-wrap xl:overflow-visible">
      {REPORT_CATEGORIES.filter((item)=>catalog.some((report)=>report.category===item.id)).map((item)=><button aria-pressed={item.id===category} className={cn("min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold",item.id===category?"bg-gold text-on-gold":"bg-task-bg text-task-text hover:bg-gold/10")} key={item.id} onClick={()=>changeReport(catalog.find((report)=>report.category===item.id))} title={item.description} type="button">{item.name}</button>)}
    </nav>
    <nav aria-label="Reports" className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
      {cards.map((item)=>{const selected=item.key===definition.key||(!!item.family&&item.family===definition.family);return <button aria-pressed={selected} className={cn("min-h-11 rounded-xl border p-3 text-left transition-colors",selected?"border-gold bg-gold/10 shadow-card":"border-task-border bg-task-bg hover:border-gold/50")} key={item.key} onClick={()=>changeReport(item)} type="button">
        <span className="block text-sm font-semibold">{item.name}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-task-text-muted" title={item.description}>{item.description}</span>
      </button>;})}
    </nav>
    </aside>
    <div className="min-w-0">

    <section aria-label="Report filters" className="mb-5 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
      {variants.length>1?<div aria-label="Report view" className="mb-3 inline-flex rounded-full bg-task-muted p-1" role="group">{variants.map((item)=><button aria-pressed={item.key===definition.key} className={cn("min-h-9 rounded-full px-3 text-xs font-semibold",item.key===definition.key?"bg-task-bg shadow-card":"text-task-text-muted")} key={item.key} onClick={()=>changeReport(item)} type="button">{item.variantLabel}</button>)}</div>:null}
      {has("client_id")?<div className="mb-3">
        {filters.client_id?<div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/50 bg-gold/10 p-3 text-sm"><span className="font-semibold">{customer?`${customer.name} · ${customer.customer_id}`:"Selected customer"}</span>{customer?.phone?<span className="text-task-text-muted">{customer.phone}</span>:null}<button className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium hover:bg-task-muted" onClick={()=>{setCustomer(null);changeFilters({client_id:undefined});}} type="button"><X className="size-3.5"/>Change customer</button></div>
        :<Labelled label="Customer (name, MKC ID, phone or Instagram ID)"><span className="relative block"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted"/><input className={cn(field,"pl-9")} onChange={(event)=>setCustomerSearch(event.target.value)} placeholder="Type at least 2 characters" value={customerSearch}/></span></Labelled>}
        {!filters.client_id&&customers.length?<ul className="mt-2 flex flex-col gap-1">{customers.map((item)=><li key={item.client_id}><button className="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-lg border border-task-border px-3 text-left text-sm hover:border-gold/50" onClick={()=>{setCustomer(item);changeFilters({client_id:item.client_id});}} type="button"><span className="font-medium">{item.name}</span><span className="text-xs text-task-text-muted">{item.customer_id}{item.phone?` · ${item.phone}`:""}</span></button></li>)}</ul>
          :!filters.client_id&&customerSearch.trim().length>=2?<p className="mt-2 text-xs text-task-text-muted">No matching customer yet.</p>:null}
      </div>:null}
      {has("from")?<div className="flex flex-wrap items-center gap-2">
        <CalendarRange aria-hidden className="size-4 text-task-text-muted"/><span className="text-xs font-medium text-task-text-muted">{definition.dateLabel??"Date"}</span>
        {definition.dateOptional?<button aria-pressed={!filters.from} className={chip(!filters.from)} onClick={()=>changeFilters({from:undefined,to:undefined})} type="button">All dates</button>:null}
        {QUICK_RANGES.map((item)=><button aria-pressed={active===item.id} className={chip(active===item.id)} key={item.id} onClick={()=>changeFilters(quickRange(item.id))} type="button">{item.label}</button>)}
      </div>:null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        {has("from")?<><Labelled label="From"><input className={field} max={filters.to} onChange={(event)=>changeFilters({from:event.target.value||undefined,...(!filters.to&&event.target.value?{to:event.target.value}:{})})} type="date" value={filters.from??""}/></Labelled>
          <Labelled label="To"><input className={field} min={filters.from} onChange={(event)=>changeFilters({to:event.target.value||undefined,...(!filters.from&&event.target.value?{from:event.target.value}:{})})} type="date" value={filters.to??""}/></Labelled></>:null}
        {has("form_family_id")?<Labelled label="Form"><select className={field} onChange={(event)=>changeFilters({form_family_id:event.target.value})} value={filters.form_family_id??""}><option value="">All forms</option>{choices.forms.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("flow_family_id")?<Labelled label="FMS workflow"><select className={field} onChange={(event)=>changeFilters({flow_family_id:event.target.value,stage_key:undefined})} value={filters.flow_family_id??""}><option value="">All workflows</option>{choices.flows.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("stage_key")&&filters.flow_family_id?<Labelled label="Stage"><select className={field} onChange={(event)=>changeFilters({stage_key:event.target.value})} value={filters.stage_key??""}><option value="">All stages</option>{choices.stages.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("work_kind")?<Labelled label="Task type"><select className={field} onChange={(event)=>changeFilters({work_kind:event.target.value==="all"?undefined:event.target.value})} value={filters.work_kind??"all"}>{WORK_KINDS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Labelled>:null}
        {canSelectBranch&&has("branch_id")?<Labelled label="Branch"><select className={field} onChange={(event)=>changeFilters({branch_id:event.target.value,department_id:undefined})} value={filters.branch_id??""}><option value="">All branches</option>{places.branches.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {elevated&&has("department_id")?<Labelled label="Department"><select className={field} onChange={(event)=>changeFilters({department_id:event.target.value})} value={filters.department_id??""}><option value="">All departments</option>{scopedDepartments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {elevated&&has("user_profile_id")?<Labelled label="Employee"><select className={field} onChange={(event)=>changeFilters({user_profile_id:event.target.value})} value={filters.user_profile_id??""}><option value="">All employees</option>{employeeChoices.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("crm_branch_id")?<Labelled label="Branch"><select className={field} onChange={(event)=>changeFilters({crm_branch_id:event.target.value})} value={filters.crm_branch_id??""}><option value="">All branches</option>{(crmChoices?.branches??[]).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("crm_employee_id")?<Labelled label={EMPLOYEE_LABEL[definition.key]??"Employee"}><select className={field} onChange={(event)=>changeFilters({crm_employee_id:event.target.value})} value={filters.crm_employee_id??""}><option value="">Everyone</option>{employeeChoices.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("crm_name")?<Labelled label={definition.key==="customer_report_master"?"Assigned CRM":"CRM named on visits"}><select className={field} onChange={(event)=>changeFilters({crm_name:event.target.value})} value={filters.crm_name??""}><option value="">Any CRM</option>{(crmChoices?.crmNames??[]).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("source")?<Labelled label="Source"><select className={field} onChange={(event)=>changeFilters({source:event.target.value})} value={filters.source??""}><option value="">All sources</option>{(crmChoices?.sources??[]).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Labelled>:null}
        {has("customer_type")?<Labelled label="Lead or client"><select className={field} onChange={(event)=>changeFilters({customer_type:event.target.value})} value={filters.customer_type??""}><option value="">Leads and clients</option><option value="lead">Leads</option><option value="client">Clients</option></select></Labelled>:null}
        {has("purchase_class")?<Labelled label="Purchase status"><select className={field} onChange={(event)=>changeFilters({purchase_class:event.target.value})} value={filters.purchase_class??""}><option value="">Any</option>{PURCHASE_CLASSES.map((item)=><option key={item} value={item}>{item}</option>)}</select></Labelled>:null}
        {has("status")&&statusOptions?<Labelled label={STATUS_LABEL[definition.key]??"Status"}><select className={field} onChange={(event)=>changeFilters({status:event.target.value})} value={filters.status??""}><option value="">{definition.key==="customer_report_followups"?"Open":"All"}</option>{statusOptions.filter((value)=>!(definition.key==="customer_report_followups"&&value==="open")).map((value)=><option key={value} value={value}>{titleCase(value)}</option>)}</select></Labelled>:null}
        {has("search")?<Labelled label="Search"><input className={field} enterKeyHint="search" onBlur={()=>{if((filters.search??"")!==searchText.trim())changeFilters({search:searchText.trim()||undefined});}} onChange={(event)=>setSearchText(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();changeFilters({search:searchText.trim()||undefined});}}} placeholder={isCrm?"Name, MKC ID or phone":"Name, reference or answer"} value={searchText}/></Labelled>:null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-task-text-muted">
        <span>{isCrm?"Read from the CRM through your JewelOS login.":"You only see records your role is allowed to see."}{has("from")?` Up to ${definition.maxDateRangeDays} days.`:""}</span>
        {narrowing?<button className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 font-medium text-task-text hover:bg-task-muted" onClick={()=>{setSearchText("");setFilters((current)=>startingFilters(definition,{...(current.from&&current.to?{from:current.from,to:current.to}:{}),...(current.client_id?{client_id:current.client_id}:{}),page_size:String(current.page_size)}));}} type="button"><X className="size-3.5"/>Clear filters</button>:null}
      </div>
    </section>

    {message?<p aria-live="polite" className="mb-4 rounded-xl border border-success/40 bg-task-bg p-3 text-sm text-success">{message}</p>:null}

    {loading&&!data?<LoadingPanels count={2}/>:error?<ErrorPanel message={error} onRetry={()=>void load()}/>:data?<>
      {summary.length?<div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{summary.map((item)=><div className="rounded-xl border border-task-border bg-task-bg p-3" key={item.key}><p className="text-xs text-task-text-muted">{item.label}</p><p className="mt-1 font-display text-xl font-semibold">{(data.summary?.[item.key]??0).toLocaleString("en-IN")}</p></div>)}</div>:null}
      <Panel title={definition.variantLabel?`${definition.name} · ${definition.variantLabel}`:definition.name} description={`${definition.description} ${data.total.toLocaleString("en-IN")} record${data.total===1?"":"s"} · ${range}${loading?" · updating…":""}`}>
        {data.rows.length===0?<EmptyMessage>{needsCustomer&&!filters.client_id?"Search for a customer above to see their full history.":definition.dateOptional?"No records match these filters.":"No records match these filters. Try a wider date range or clear a filter."}</EmptyMessage>
          :<ReportTable columns={columns} rows={data.rows}/>}
        {data.total>filters.page_size||filters.page>1?<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={filters.page<=1} onClick={()=>changeFilters({page:filters.page-1})} variant="secondary">Previous</Button>
          <span className="text-xs text-task-text-muted">Page {filters.page} of {totalPages}</span>
          <label className="flex items-center gap-2 text-xs text-task-text-muted">Rows<select className="task-field w-20 py-1" onChange={(event)=>changeFilters({page_size:Number(event.target.value)})} value={filters.page_size}>{[10,25,50,100].map((size)=><option key={size}>{size}</option>)}</select></label>
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={filters.page>=totalPages} onClick={()=>changeFilters({page:filters.page+1})} variant="secondary">Next</Button>
        </div>:null}
        {definition.key==="form_answers"&&!filters.form_family_id&&data.rows.length?<p className="mt-3 text-xs text-task-text-muted">Choose one form above to see and export one column per question.</p>:null}
        {definition.notes?.length?<details className="mt-4 rounded-xl bg-task-muted/60 p-3 text-xs text-task-text-muted"><summary className="flex min-h-9 cursor-pointer items-center gap-1.5 font-medium text-task-text"><Info className="size-3.5"/>How these numbers are counted</summary><ul className="mt-2 list-disc space-y-1 pl-5">{definition.notes.map((note)=><li key={note}>{note}</li>)}</ul></details>:null}
      </Panel>

      <Panel className="mt-5" title="Your exports" description="CSV files from the last 30 days. Each file is private to you and expires automatically.">
        {!history?.rows.length?<EmptyMessage>No exports yet. Use “Export CSV” above to create one.</EmptyMessage>:<ul className="flex flex-col gap-2">{history.rows.map((row)=>{const status=String(row.status) as ExportStatus;const actions=exportActionsForStatus(status);const progress=Number(row.progress_percent??0);return <li className="rounded-xl border border-task-border p-3 text-sm" key={String(row.export_id)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-medium">{reportDisplayName(String(row.report_key))}</p><p className="text-xs text-task-text-muted">Requested {reportCellText(typeof row.requested_at==="string"?row.requested_at:null,"instant")}{status==="completed"?` · ${reportCellText(typeof row.row_count==="number"?row.row_count:null,"number")} rows · expires ${reportCellText(typeof row.expires_at==="string"?row.expires_at:null,"instant")}`:""}</p></div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-task-muted px-2 py-0.5 text-xs font-medium"><StatusDot tone={status==="completed"?"success":status==="failed"||status==="expired"?"danger":status==="queued"||status==="processing"?"warning":"neutral"}/>{status==="queued"?"Waiting":status==="processing"?"Preparing":titleCase(status)}</span>
              {actions.includes("download")?<Button onClick={()=>void lifecycle("download",String(row.export_id))}><Download/>Download</Button>:null}
              {actions.includes("cancel")?<button aria-label="Cancel export" className="flex size-10 items-center justify-center rounded-lg hover:bg-task-muted" onClick={()=>void lifecycle("cancel",String(row.export_id))} type="button"><Square className="size-4"/></button>:null}
              {actions.includes("retry")?<Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={()=>void lifecycle("retry",String(row.export_id))} variant="secondary"><RotateCcw/>Try again</Button>:null}
            </div>
          </div>
          {status==="queued"||status==="processing"?<div aria-label={`Export ${progress}% ready`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="mt-2 h-1.5 overflow-hidden rounded-full bg-task-muted" role="progressbar"><div className="h-full rounded-full bg-gold transition-[width]" style={{width:`${Math.max(4,progress)}%`}}/></div>:null}
        </li>;})}</ul>}
        <Button className="mt-3 border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={()=>void load(false)} variant="secondary"><RefreshCw/>Refresh</Button>
      </Panel>
    </>:null}
    </div>
    </div>
  </PageSurface>;
}
