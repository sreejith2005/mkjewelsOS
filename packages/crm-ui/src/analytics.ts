import type {JewelosClient} from "@jewelos/api-client";
import {parseInsightsPayload,type InsightsPayload} from "@jewelos/core";
import {createCrmProjectClient,crmTokenSource,type CrmProjectConfig} from "./crm-port/crm-project";
export function createCrmManagementReader(options:{jewelos:JewelosClient;crmProject:CrmProjectConfig}){
 const source=crmTokenSource({config:options.crmProject,jewelosAccessToken:async()=>{const {data,error}=await options.jewelos.auth.getSession();if(error)throw error;return data.session?.access_token??null;}});
 const client=createCrmProjectClient({config:options.crmProject,source});
 return {async summary(context:Record<string,string|number>):Promise<InsightsPayload>{const {data,error}=await client.rpc("get_crm_insights_v1",{p_context:context});if(error)throw error;return parseInsightsPayload(data);},
 async branches():Promise<Array<{id:string;name:string;jewelosBranchId:string|null}>>{const {data,error}=await client.rpc("get_crm_insights_options_v1");if(error)throw error;if(!data||typeof data!=="object"||Array.isArray(data)||!Array.isArray(data.branches))throw new Error("CRM branch mapping unavailable");return data.branches.map(b=>{if(!b||typeof b!=="object"||Array.isArray(b)||typeof b.id!=="string"||typeof b.name!=="string"||(b.jewelos_branch_id!==null&&typeof b.jewelos_branch_id!=="string"))throw new Error("Invalid branch mapping");return{id:b.id,name:b.name,jewelosBranchId:b.jewelos_branch_id};});}};
}

export type CrmReportCell=string|number|boolean|null;
export type CrmReportPage={rows:Array<Record<string,CrmReportCell>>;total:number;summary?:Record<string,number>};
export type CrmReportOption={id:string;name:string};
export type CrmReportOptions={branches:CrmReportOption[];employees:CrmReportOption[];crmNames:CrmReportOption[];sources:CrmReportOption[]};
export type CrmReportCustomer={client_id:string;customer_id:string;name:string;phone:string|null};
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const options=(value:unknown):CrmReportOption[]=>Array.isArray(value)?value.flatMap(raw=>{const item=record(raw);return item&&typeof item.id==="string"&&typeof item.name==="string"?[{id:item.id,name:item.name}]:[];}):[];
const cell=(value:unknown):CrmReportCell=>value===null||typeof value==="string"||typeof value==="number"||typeof value==="boolean"?value:value===undefined?null:JSON.stringify(value);

/** Business Reports 2.0: CRM-owned reports, read as the signed-in user through the login bridge. */
export function createCrmReportReader(options_:{jewelos:JewelosClient;crmProject:CrmProjectConfig}){
 const source=crmTokenSource({config:options_.crmProject,jewelosAccessToken:async()=>{const {data,error}=await options_.jewelos.auth.getSession();if(error)throw error;return data.session?.access_token??null;}});
 const client=createCrmProjectClient({config:options_.crmProject,source});
 return {
  async report(key:string,filters:Record<string,string>,offset:number,limit:number):Promise<CrmReportPage>{
   const {data,error}=await client.rpc("get_crm_business_report",{p_key:key,p_filters:filters,p_offset:offset,p_limit:limit});if(error)throw error;
   const payload=record(data);if(!payload||!Array.isArray(payload.rows)||typeof payload.total!=="number")throw new Error("Invalid CRM report");
   const rows=payload.rows.map(raw=>{const row=record(raw)??{};return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,cell(v)]));});
   const summary=record(payload.summary);
   return {rows,total:payload.total,...(summary?{summary:Object.fromEntries(Object.entries(summary).filter(([,v])=>typeof v==="number")) as Record<string,number>}:{})};
  },
  async options():Promise<CrmReportOptions>{const {data,error}=await client.rpc("get_crm_business_report_options");if(error)throw error;const payload=record(data)??{};return {branches:options(payload.branches),employees:options(payload.employees),crmNames:options(payload.crmNames),sources:options(payload.sources)};},
  async customers(search:string):Promise<CrmReportCustomer[]>{const {data,error}=await client.rpc("find_crm_report_customers",{p_search:search});if(error)throw error;return Array.isArray(data)?data.flatMap(raw=>{const item=record(raw);return item&&typeof item.client_id==="string"&&typeof item.customer_id==="string"&&typeof item.name==="string"?[{client_id:item.client_id,customer_id:item.customer_id,name:item.name,phone:typeof item.phone==="string"?item.phone:null}]:[];}):[];},
 };
}
