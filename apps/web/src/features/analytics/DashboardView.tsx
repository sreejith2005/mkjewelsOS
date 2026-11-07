import {lazy,Suspense,useEffect,useState} from "react";
import {hasPermission} from "@jewelos/core";
import {useAuth} from "@/auth/AuthContext";
import {PerformanceDashboard} from "./performance/PerformanceDashboard";
const ManagementDashboard=lazy(()=>import("./insights/ManagementDashboard").then(m=>({default:m.ManagementDashboard})));
const CrmSummary=lazy(()=>import("./insights/CrmSummary").then(m=>({default:m.CrmSummary})));

export type DashboardSection="performance"|"insights";
/** Keys only a Management insights link carries. Such a link (or a saved view) still opens insights. */
const INSIGHTS_ONLY_KEYS=["metric","group","groupBy","preset","tab","designation_id","category_id","stage_id","task_type","priority","status","source"];

export function dashboardSectionFromSearch(search:string):DashboardSection{
 const params=new URLSearchParams(search);
 const view=params.get("view");
 if(view==="insights")return "insights";
 if(view==="performance")return "performance";
 return INSIGHTS_ONLY_KEYS.some(key=>params.has(key))?"insights":"performance";
}

/**
 * Dashboard opens on Employee Task Performance. Management insights is unchanged and loads only
 * when its tab is chosen, so its broad request can never hold up the first screen.
 */
export function DashboardView(){
 const {access}=useAuth();
 const [section,setSection]=useState<DashboardSection>(()=>dashboardSectionFromSearch(window.location.search));
 useEffect(()=>{const restore=()=>setSection(dashboardSectionFromSearch(window.location.search));window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);},[]);
 const choose=(next:DashboardSection)=>{if(next===section)return;window.history.pushState({},"",`${window.location.pathname}?view=${next}`);setSection(next);};
 const crmAllowed=!!access&&hasPermission(access,"crm.view");
 return <section className="-m-4 min-h-screen bg-task-muted p-4 text-task-text sm:-m-6 sm:p-6"><div className="w-full min-w-0 space-y-4">
  <nav aria-label="Dashboard sections" className="flex gap-1 border-b border-task-border">
   {([["performance","Employee performance"],["insights","Management insights"]] as const).map(([id,label])=><button aria-current={section===id?"page":undefined} className={`-mb-px min-h-11 border-b-2 px-4 text-sm transition-colors ${section===id?"border-task-accent font-semibold text-task-text":"border-transparent text-task-text-muted hover:text-task-text"}`} key={id} onClick={()=>choose(id)} type="button">{label}</button>)}
  </nav>
  {section==="performance"?<PerformanceDashboard onOpenInsights={()=>choose("insights")}/>:<Suspense fallback={<div className="skeleton h-64 rounded-2xl" role="status" aria-label="Loading management insights"/>}><div className="[&>section]:m-0 [&>section]:min-h-0 [&>section]:bg-transparent [&>section]:p-0 sm:[&>section]:m-0 sm:[&>section]:p-0"><ManagementDashboard crmAllowed={crmAllowed} renderCrmSummary={filter=><Suspense fallback={<p>Loading CRM summary…</p>}><CrmSummary filter={filter}/></Suspense>}/></div></Suspense>}
 </div></section>;
}
