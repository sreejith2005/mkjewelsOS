import type {InsightsPayload,InsightsDetailPage,InsightsOptions,DashboardSavedView} from "./insightsTypes";
import {parseInsightsFilter} from "./insightsFilters";
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v);
const nullable=(v:unknown)=>v===null||num(v);
const modules=["tasks","workflows","forms","people","crm"];
export function parseInsightsPayload(v:unknown):InsightsPayload {
 if(!object(v)||v.version!==1||!["generatedAt","timezone","from","to","scopeLabel","groupBasis"].every(k=>typeof v[k]==="string")||!object(v.moduleStates)||!modules.every(k=>typeof (v.moduleStates as Record<string,unknown>)[k]==="boolean")||!num(v.missingDeadline))throw new Error("Invalid dashboard response");
 if(!Array.isArray(v.metrics)||!v.metrics.every(m=>object(m)&&typeof m.key==="string"&&typeof m.label==="string"&&modules.includes(String(m.module))&&["cohort","period","current"].includes(String(m.basis))&&[m.value,m.previous,m.numerator,m.denominator].every(nullable)))throw new Error("Invalid dashboard metrics");
 if(!Array.isArray(v.groups)||!v.groups.every(g=>object(g)&&typeof g.id==="string"&&typeof g.name==="string"&&[g.total,g.completed,g.open,g.overdue,g.on_time].every(num)))throw new Error("Invalid comparisons");
 if(!Array.isArray(v.trend)||!v.trend.every(p=>object(p)&&typeof p.date==="string"&&num(p.due)&&num(p.completed)))throw new Error("Invalid trend");
 // All rendered properties have been checked at the server-response boundary.
 return v as InsightsPayload;
}
export function parseInsightsDetailPage(v:unknown):InsightsDetailPage {
 if(!object(v)||![v.total,v.offset,v.limit].every(num)||!Array.isArray(v.rows)||!v.rows.every(r=>object(r)&&["id","title","status"].every(k=>typeof r[k]==="string")&&modules.includes(String(r.module))&&(r.due===null||typeof r.due==="string")&&(r.completed===null||typeof r.completed==="string")&&["task_id","instance_id","stage_id","starter_id","form_id","client_id","employee_id"].every(k=>r[k]===undefined||r[k]===null||typeof r[k]==="string")))throw new Error("Invalid record response");
 const rows=v.rows.map(row=>{const clean={...row as Record<string,unknown>};for(const k of ["task_id","instance_id","stage_id","starter_id","form_id","client_id","employee_id"])if(clean[k]===null)delete clean[k];return clean;});
 return {...v,rows} as InsightsDetailPage;
}
export function parseInsightsOptions(v:unknown):InsightsOptions {
 if(!object(v)||!["branches","departments","designations","employees","categories","flows","taskTypes","sources"].every(k=>Array.isArray(v[k])&&(v[k] as unknown[]).every(x=>object(x)&&typeof x.id==="string"&&typeof x.name==="string")))throw new Error("Invalid filter options");
 if(v.stages!==undefined&&(!Array.isArray(v.stages)||!v.stages.every(x=>object(x)&&typeof x.id==="string"&&typeof x.name==="string")))throw new Error("Invalid stage options");
 return v as InsightsOptions;
}
export function parseSavedView(v:unknown):DashboardSavedView {
 if(!object(v)||typeof v.id!=="string"||typeof v.name!=="string"||!num(v.record_version)||!object(v.config)||v.config.version!==1||!Array.isArray(v.config.sections)||!v.config.sections.every(s=>typeof s==="string"&&["attention","trend","comparison","modules"].includes(s)))throw new Error("Invalid saved view");
 return {id:v.id,name:v.name,record_version:v.record_version as number,config:{version:1,filter:parseInsightsFilter(v.config.filter),sections:v.config.sections as string[]}};
}
