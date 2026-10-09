import {useCallback,useMemo} from "react";
import {createCrmManagementReader} from "@jewelos/crm-ui/analytics";
import {supabase} from "@jewelos/api-client";
import type {InsightsFilter} from "@jewelos/core";
import {crmProjectConfig} from "@/lib/crmProject";
import {useInsightsRequest} from "./useInsightsState";
import {InsightsSummary} from "./InsightsSummary";
import {Panel,ErrorPanel} from "../components";
export function CrmSummary({filter}:{filter:InsightsFilter}){
 const unsupported=!!(filter.department_id||filter.designation_id||filter.user_profile_id);const reader=useMemo(()=>crmProjectConfig.url&&crmProjectConfig.anonKey?createCrmManagementReader({jewelos:supabase,crmProject:crmProjectConfig}):null,[]);
 const loader=useCallback(async()=>{if(unsupported)throw new Error("Unsupported scope");if(!reader)throw new Error("CRM not configured");const context:Record<string,string|number>={version:1,preset:filter.preset,tab:"visits",groupBy:"branch"};if(filter.from)context.from=filter.from;if(filter.to)context.to=filter.to;if(filter.branch_id){const branches=await reader.branches();const mapped=branches.find(b=>b.jewelosBranchId===filter.branch_id);if(!mapped)throw new Error("Branch mapping unavailable");context.branch_id=mapped.id;}return {payload:await reader.summary(context),context};},[reader,JSON.stringify(filter),unsupported]);
 const {data,error,loading,retry}=useInsightsRequest(loader,JSON.stringify(filter));
 const path=(metric?:string)=>{const params=new URLSearchParams();for(const [k,v] of Object.entries(data?.context??{}))params.set(k,String(v));if(metric)params.set("metric",metric);return `/crm/dashboard?${params}`;};
 if(unsupported)return <Panel title="CRM scope differs"><p className="text-sm">CRM has its own staff attribution and branch rules. Clear the department, designation, and employee filters to see the CRM summary, or use the CRM dashboard's own filters.</p></Panel>;
 return <div className="space-y-4"><Panel title="Client and follow-up health" description="Read from the CRM project through your existing login bridge. Internal task filters do not apply to CRM."><a className="inline-flex min-h-11 items-center text-sm font-medium text-task-accent" href={path()}>Open CRM analysis  &rarr;</a></Panel>{loading&&!data?<p role="status">Loading CRM summary...</p>:null}{error?<ErrorPanel message={error} onRetry={()=>void retry()}/>:null}{data?<><InsightsSummary metrics={data.payload.metrics.filter(m=>["visits","purchases","purchase_rate","open_followups","overdue_followups"].includes(m.key))} onOpen={metric=>{window.history.pushState({},"",path(metric));window.dispatchEvent(new PopStateEvent("popstate"));}}/><p className="text-xs text-task-text-muted">CRM updated {new Date(data.payload.generatedAt).toLocaleTimeString("en-IN",{timeZone:data.payload.timezone})}. CRM unavailable states do not affect internal analytics.</p></>:null}</div>;
}
