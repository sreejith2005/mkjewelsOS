import {INSIGHTS_GROUPS,INSIGHTS_TABS,type InsightsFilter} from "./insightsTypes";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys=["version","tab","preset","from","to","groupBy","branch_id","department_id","designation_id","user_profile_id","category_id","flow_id","stage_id","task_type","priority","status","source"];
export const INSIGHTS_RANGES=[{id:"today",name:"Today"},{id:"this_week",name:"This week"},{id:"this_month",name:"This month"},{id:"last_7_days",name:"Last 7 days"},{id:"last_30_days",name:"Last 30 days"},{id:"this_quarter",name:"This quarter"},{id:"this_year",name:"This year"},{id:"custom",name:"Custom dates"}];
export function parseInsightsFilter(input:unknown):InsightsFilter {
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid filters");
  const o=input as Record<string,unknown>;
  if(Object.keys(o).some(k=>!keys.includes(k)))throw new Error("Unknown filter");
  if(o.version!==undefined&&o.version!==1&&o.version!=="1")throw new Error("Unsupported filter version");
  const result:InsightsFilter={version:1,tab:"overview",preset:"this_month",groupBy:"department"};
  if(o.tab!==undefined){if(!INSIGHTS_TABS.some(x=>x===o.tab))throw new Error("Invalid tab");result.tab=o.tab as InsightsFilter["tab"];}
  if(o.groupBy!==undefined){if(!INSIGHTS_GROUPS.some(x=>x===o.groupBy))throw new Error("Invalid grouping");result.groupBy=o.groupBy as InsightsFilter["groupBy"];}
  if(o.preset!==undefined){if(!INSIGHTS_RANGES.some(x=>x.id===o.preset))throw new Error("Invalid period");result.preset=String(o.preset);}
  for(const key of ["branch_id","department_id","designation_id","user_profile_id","category_id","flow_id","stage_id"] as const){if(o[key]){if(typeof o[key]!=="string"||!uuid.test(o[key]))throw new Error("Invalid scope");result[key]=o[key];}}
  for(const key of ["task_type","priority","status","source"] as const){if(o[key]){if(typeof o[key]!=="string"||!/^[a-z_]{1,40}$/.test(o[key]))throw new Error("Invalid work filter");result[key]=o[key];}}
  for(const key of ["from","to"] as const){if(o[key]){if(typeof o[key]!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(o[key])||new Date(`${o[key]}T12:00:00Z`).toISOString().slice(0,10)!==o[key])throw new Error("Invalid date");result[key]=o[key];}}
  if(result.preset==="custom"&&(!result.from||!result.to))throw new Error("Choose both dates");
  if(result.from&&result.to){const days=(Date.parse(result.to)-Date.parse(result.from))/86400000+1;if(days<1||days>366)throw new Error("Choose 1 to 366 days");}
  return result;
}
export function encodeInsightsSearch(filter:InsightsFilter):string {const p=new URLSearchParams();for(const [k,v] of Object.entries(parseInsightsFilter(filter)))if(v!==undefined)p.set(k,String(v));return p.toString();}
export function decodeInsightsSearch(search:string):InsightsFilter {const p=new URLSearchParams(search);const o:Record<string,string>={};for(const k of keys){const v=p.get(k);if(v)o[k]=v;}try{return parseInsightsFilter(o);}catch{return parseInsightsFilter({});}}
